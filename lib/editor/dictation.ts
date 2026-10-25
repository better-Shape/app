/**
 * Microphone dictation.
 *
 * The backend (`src-tauri/src/core/mic.rs`) runs a `System.Speech` recognizer in a
 * child PowerShell and reads line-delimited recognized text back as
 * `dictation-text`, or a reason on `dictation-error`. It takes audio one WAV path at a
 * time through `dictation_push`, and the page is responsible for recording it: the
 * recognizer reads a file off its own stdin, so it never touches the microphone itself.
 *
 * `System.Speech.SetInputToWaveFile` wants RIFF/WAVE PCM. `MediaRecorder` would hand us
 * webm/opus instead, so capture is done with an `AudioContext` and the samples are encoded
 * here. The resampler and the WAV writer are pure so they can be tested without a device.
 */

/** Sample rate the recognizer is happiest with, and the one System.Speech defaults to. */
export const DICTATION_SAMPLE_RATE = 16_000;

/** Upper bound on retained PCM capture duration so unattended sessions cannot exhaust renderer memory. */
export const MAX_DICTATION_BUFFER_SECONDS = 300;

/**
 * Resample to 16 kHz with linear interpolation.
 *
 * The recognizer resamples internally anyway; doing it here keeps the payload small and,
 * more importantly, keeps the format it sees to the one it was built for.
 */
export function resampleTo16k(samples: Float32Array, fromRate: number): Float32Array {
    if (fromRate === DICTATION_SAMPLE_RATE || fromRate <= 0 || samples.length === 0) {
        return samples;
    }
    const ratio = fromRate / DICTATION_SAMPLE_RATE;
    const outLength = Math.max(1, Math.round(samples.length / ratio));
    const out = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) {
        const pos = i * ratio;
        const left = Math.floor(pos);
        const right = Math.min(left + 1, samples.length - 1);
        const frac = pos - left;
        out[i] = samples[left] * (1 - frac) + samples[right] * frac;
    }
    return out;
}

/** RIFF/WAVE, mono, 16-bit PCM. Little-endian, which is what every Windows reader expects. */
export function encodeWavPcm16(samples: Float32Array, sampleRate: number): Uint8Array {
    const dataBytes = samples.length * 2;
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);

    const writeAscii = (offset: number, text: string) => {
        for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    };

    writeAscii(0, "RIFF");
    view.setUint32(4, 36 + dataBytes, true);
    writeAscii(8, "WAVE");
    writeAscii(12, "fmt ");
    view.setUint32(16, 16, true); // PCM fmt chunk size
    view.setUint16(20, 1, true); // audio format: PCM
    view.setUint16(22, 1, true); // channels: mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byte rate = rate * channels * bytes
    view.setUint16(32, 2, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    writeAscii(36, "data");
    view.setUint32(40, dataBytes, true);

    for (let i = 0; i < samples.length; i++) {
        // Clamp before scaling: a clipped float wraps to the opposite sign otherwise.
        const clamped = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(44 + i * 2, Math.round(clamped * 0x7fff), true);
    }
    return new Uint8Array(buffer);
}

export type DictationState = "idle" | "listening" | "processing" | "error";

export type DictationHandlers = {
    /** Recognized text, ready to insert at the caret. */
    onText: (text: string) => void;
    onError: (message: string) => void;
    onState?: (state: DictationState) => void;
    /** Normalized 0..1 voice level emitted per audio buffer while listening. */
    onLevel?: (level: number) => void;
};

export type DictationSession = {
    /** Finish the current utterance and hand the audio to the recognizer. */
    commit: () => void;
    /** Stop capture and tear the recognizer down. */
    dispose: () => void;
};

/**
 * Errors the user can act on. Anything else is surfaced verbatim rather than flattened,
 * because a silent "dictation failed" teaches nothing.
 */
export function describeDictationError(error: unknown): string {
    if (error instanceof DOMException) {
        if (error.name === "NotAllowedError") {
            return "Microphone access was denied. Allow it in your system settings and try again.";
        }
        if (error.name === "NotFoundError") {
            return "No microphone was found.";
        }
        if (error.name === "NotReadableError") {
            return "The microphone is in use by another application.";
        }
    }
    if (error instanceof Error && error.message) return error.message;
    return "Dictation couldn't start.";
}

function concatFloat32(chunks: Float32Array[]): Float32Array {
    let total = 0;
    for (const chunk of chunks) total += chunk.length;
    const out = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}

/** Appends a PCM chunk while evicting oldest samples once `maxSamples` is exceeded. */
export const appendBoundedAudioChunk = (
    chunks: Float32Array[],
    incoming: Float32Array,
    currentSamples: number,
    maxSamples: number,
): number => {
    if (incoming.length === 0 || maxSamples <= 0) return currentSamples;
    if (incoming.length >= maxSamples) {
        chunks.length = 0;
        const tail = incoming.slice(incoming.length - maxSamples);
        chunks.push(tail);
        return tail.length;
    }
    chunks.push(incoming);
    let total = currentSamples + incoming.length;
    while (total > maxSamples && chunks.length > 0) {
        const head = chunks[0];
        const excess = total - maxSamples;
        if (head.length <= excess) {
            chunks.shift();
            total -= head.length;
        } else {
            chunks[0] = head.subarray(excess);
            total -= excess;
        }
    }
    return total;
};

/** Computes a normalized `0..1` voice-level meter reading from a mono PCM buffer. */
const computeAudioBufferLevel = (channel: Float32Array): number => {
    let sumSq = 0;
    for (let index = 0; index < channel.length; index += 4) {
        const sample = channel[index] ?? 0;
        sumSq += sample * sample;
    }
    const rms = Math.sqrt(sumSq / Math.ceil(channel.length / 4));
    return Math.min(1, rms * 6);
};

/** Record one utterance and push it to the recognizer. */
export async function startDictation(
    handlers: DictationHandlers,
    constraints: MediaTrackConstraints | boolean,
    invoke: {
        start: () => Promise<void>;
        stop: () => Promise<void>;
        push: (wav: number[]) => Promise<void>;
    },
): Promise<DictationSession> {
    const setState = handlers.onState ?? (() => {});
    setState("listening");

    let stream: MediaStream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
    } catch (error) {
        setState("error");
        handlers.onError(describeDictationError(error));
        throw error;
    }

    try {
        await invoke.start();
    } catch (error) {
        for (const track of stream.getTracks()) track.stop();
        setState("error");
        const message =
            error instanceof Error && error.message ? error.message : describeDictationError(error);
        handlers.onError(message);
        throw error;
    }

    const AudioCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) {
        for (const track of stream.getTracks()) track.stop();
        await invoke.stop();
        setState("error");
        handlers.onError("This build cannot record audio.");
        throw new Error("AudioContext unavailable");
    }

    const context = new AudioCtor();
    const source = context.createMediaStreamSource(stream);
    // ScriptProcessor is deprecated but is the only node available without shipping a
    // separate worklet file, and dictation is a deliberate, user-initiated action.
    const processor = context.createScriptProcessor(4096, 1, 1);
    const silentGain =
        typeof context.createGain === "function" ? context.createGain() : null;
    if (silentGain) {
        silentGain.gain.value = 0;
    }
    if (typeof source.connect === "function") {
        source.connect(processor);
    }
    if (typeof processor.connect === "function") {
        if (silentGain && typeof silentGain.connect === "function") {
            processor.connect(silentGain);
            silentGain.connect(context.destination);
        } else {
            processor.connect(context.destination);
        }
    }
    const chunks: Float32Array[] = [];
    const effectiveRate =
        Number.isFinite(context.sampleRate) && context.sampleRate > 0
            ? context.sampleRate
            : 48_000;
    const maxBufferedSamples = Math.max(
        DICTATION_SAMPLE_RATE,
        Math.round(effectiveRate * MAX_DICTATION_BUFFER_SECONDS),
    );
    let bufferedSamples = 0;

    processor.onaudioprocess = (event) => {
        const channel = event.inputBuffer.getChannelData(0);
        bufferedSamples = appendBoundedAudioChunk(
            chunks,
            new Float32Array(channel),
            bufferedSamples,
            maxBufferedSamples,
        );
        if (handlers.onLevel && channel.length > 0) {
            handlers.onLevel(computeAudioBufferLevel(channel));
        }
    };

    let disposed = false;
    const teardown = () => {
        if (disposed) return;
        disposed = true;
        processor.onaudioprocess = null;
        chunks.length = 0;
        bufferedSamples = 0;
        handlers.onLevel?.(0);
        try {
            source.disconnect();
            processor.disconnect();
            silentGain?.disconnect();
        } catch {
            /* already torn down */
        }
        for (const track of stream.getTracks()) track.stop();
        context.close().catch(() => {
            /* ignore audio context close errors */
        });
    };

    const hasAudibleSignal = (samples: Float32Array): boolean => {
        for (const sample of samples) {
            if (Math.abs(sample) >= 1e-4) return true;
        }
        return false;
    };

    return {
        commit: () => {
            if (disposed) return;
            const samples = concatFloat32(chunks);
            teardown();
            if (!hasAudibleSignal(samples)) {
                invoke.stop().catch(() => {
                    /* ignore recognizer teardown errors */
                });
                setState("idle");
                return;
            }
            setState("processing");
            const pcm = resampleTo16k(samples, context.sampleRate);
            const wav = encodeWavPcm16(pcm, DICTATION_SAMPLE_RATE);
            // The recognizer stays up: `dictation_stop` kills the child process, and doing
            // that now would race the recognition that `dictation_push` only just queued.
            // It is torn down once the recognition response arrives or is cancelled.
            invoke
                .push(Array.from(wav))
                .catch((error: unknown) => {
                    invoke.stop().catch(() => {
                        /* ignore recognizer teardown errors */
                    });
                    setState("error");
                    handlers.onError(describeDictationError(error));
                });
        },
        dispose: () => {
            teardown();
            invoke.stop().catch(() => {
                /* ignore recognizer teardown errors */
            });
            setState("idle");
        },
    };
}