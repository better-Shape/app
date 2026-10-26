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

export type DictationState = "idle" | "listening" | "processing" | "error";

export type DictationHandlers = {
    /** Recognized text, ready to insert at the caret. */
    onText: (text: string) => void;
    onError: (message: string) => void;
    onState?: (state: DictationState) => void;
    /** Normalized 0..1 voice level emitted per audio buffer while listening. */
    onLevel?: (level: number) => void;
    /** Invoked when continuous recording reaches `MAX_DICTATION_BUFFER_SECONDS` and auto-commits. */
    onMaxDurationReached?: () => void;
};

export type DictationSession = {
    /** Finish the current utterance and hand the audio to the recognizer. */
    commit: () => void;
    /** Stop capture and tear the recognizer down. */
    dispose: () => void;
};

type DictationInvokeBridge = {
    start: () => Promise<void>;
    stop: () => Promise<void>;
    push: (wav: number[]) => Promise<void>;
};

const DOM_EXCEPTION_MESSAGES: Partial<Record<string, string>> = {
    NotAllowedError:
        "Microphone access was denied. Allow it in your system settings and try again.",
    NotFoundError: "No microphone was found.",
    NotReadableError: "The microphone is in use by another application.",
};

/** Checks whether `samples` needs resampling to `DICTATION_SAMPLE_RATE`. */
const isAlreadyTargetSampleRate = (
    samples: Float32Array,
    fromRate: number,
): boolean =>
    fromRate === DICTATION_SAMPLE_RATE || fromRate <= 0 || samples.length === 0;

/**
 * Resample to 16 kHz with linear interpolation.
 *
 * The recognizer resamples internally anyway; doing it here keeps the payload small and,
 * more importantly, keeps the format it sees to the one it was built for.
 */
export const resampleTo16k = (
    samples: Float32Array,
    fromRate: number,
): Float32Array => {
    if (isAlreadyTargetSampleRate(samples, fromRate)) {
        return samples;
    }
    const ratio = fromRate / DICTATION_SAMPLE_RATE;
    const outLength = Math.max(1, Math.round(samples.length / ratio));
    const out = new Float32Array(outLength);
    for (let i = 0; i < outLength; i += 1) {
        const pos = i * ratio;
        const left = Math.floor(pos);
        const right = Math.min(left + 1, samples.length - 1);
        const frac = pos - left;
        out[i] = samples[left] * (1 - frac) + samples[right] * frac;
    }
    return out;
};

/** Writes ASCII header bytes into `view` starting at `offset`. */
const writeAsciiHeader = (
    view: DataView,
    offset: number,
    text: string,
): void => {
    for (let i = 0; i < text.length; i += 1) {
        view.setUint8(offset + i, text.charCodeAt(i));
    }
};

/** RIFF/WAVE, mono, 16-bit PCM. Little-endian, which is what every Windows reader expects. */
export const encodeWavPcm16 = (
    samples: Float32Array,
    sampleRate: number,
): Uint8Array => {
    const dataBytes = samples.length * 2;
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);

    writeAsciiHeader(view, 0, "RIFF");
    view.setUint32(4, 36 + dataBytes, true);
    writeAsciiHeader(view, 8, "WAVE");
    writeAsciiHeader(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAsciiHeader(view, 36, "data");
    view.setUint32(40, dataBytes, true);

    for (let i = 0; i < samples.length; i += 1) {
        // Clamp before scaling: a clipped float wraps to the opposite sign otherwise.
        const clamped = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(44 + i * 2, Math.round(clamped * 0x7fff), true);
    }
    return new Uint8Array(buffer);
};

/**
 * Errors the user can act on. Anything else is surfaced verbatim rather than flattened,
 * because a silent "dictation failed" teaches nothing.
 */
export const describeDictationError = (error: unknown): string => {
    if (error instanceof DOMException) {
        const mapped = DOM_EXCEPTION_MESSAGES[error.name];
        if (mapped) return mapped;
    }
    if (error instanceof Error && error.message) return error.message;
    return "Dictation couldn't start.";
};

/** Concatenates sequential `Float32Array` PCM chunks into a single contiguous buffer. */
const concatFloat32 = (chunks: Float32Array[]): Float32Array => {
    let total = 0;
    for (const chunk of chunks) total += chunk.length;
    const out = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
};

/** Checks whether incoming PCM samples can be appended under `maxSamples`. */
const canAppendSamples = (
    incomingLength: number,
    currentSamples: number,
    maxSamples: number,
): boolean =>
    incomingLength > 0 && maxSamples > 0 && currentSamples < maxSamples;

/**
 * Appends a PCM chunk up to `maxSamples`, preserving the start of speech rather
 * than evicting opening words when the duration cap is reached.
 */
export const appendBoundedAudioChunk = (
    chunks: Float32Array[],
    incoming: Float32Array,
    currentSamples: number,
    maxSamples: number,
): number => {
    if (!canAppendSamples(incoming.length, currentSamples, maxSamples)) {
        return currentSamples;
    }
    const remaining = maxSamples - currentSamples;
    if (incoming.length <= remaining) {
        chunks.push(incoming);
        return currentSamples + incoming.length;
    }
    const clipped = incoming.slice(0, remaining);
    chunks.push(clipped);
    return currentSamples + clipped.length;
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

/** Stops every media track on `stream`. */
const stopMediaStreamTracks = (stream: MediaStream): void => {
    for (const track of stream.getTracks()) {
        track.stop();
    }
};

/** Resolves the browser `AudioContext` constructor (`AudioContext` or `webkitAudioContext`). */
const resolveAudioContextCtor = (): typeof AudioContext | undefined =>
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

/** Requests microphone capture and starts the backend recognizer process. */
const acquireStreamAndStartRecognizer = async (
    constraints: MediaTrackConstraints | boolean,
    invoke: DictationInvokeBridge,
    setState: (state: DictationState) => void,
    onError: (message: string) => void,
): Promise<MediaStream> => {
    let stream: MediaStream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            audio: constraints,
        });
    } catch (error) {
        setState("error");
        onError(describeDictationError(error));
        throw error;
    }
    try {
        await invoke.start();
        return stream;
    } catch (error) {
        stopMediaStreamTracks(stream);
        setState("error");
        onError(describeDictationError(error));
        throw error;
    }
};

/** Connects a processor node downstream via `silentGain` when available, or directly to `destination`. */
const connectProcessorDownstream = (
    context: AudioContext,
    processor: ScriptProcessorNode,
    silentGain: GainNode | null,
): void => {
    if (silentGain && typeof silentGain.connect === "function") {
        processor.connect(silentGain);
        silentGain.connect(context.destination);
    } else {
        processor.connect(context.destination);
    }
};

/** Connects `source -> processor -> (silentGain ->) destination` for PCM capture. */
const wireSilentCaptureGraph = (
    context: AudioContext,
    source: MediaStreamAudioSourceNode,
    processor: ScriptProcessorNode,
): GainNode | null => {
    const silentGain =
        typeof context.createGain === "function" ? context.createGain() : null;
    if (silentGain) silentGain.gain.value = 0;
    if (typeof source.connect === "function") source.connect(processor);
    if (typeof processor.connect === "function") {
        connectProcessorDownstream(context, processor, silentGain);
    }
    return silentGain;
};

/** Resolves a positive finite sample rate from `context`, defaulting to `48_000` Hz. */
const resolveEffectiveSampleRate = (sampleRate: number): number =>
    Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48_000;

/** Checks whether `samples` contains at least one sample above the silence floor (`1e-4`). */
const hasAudibleSignal = (samples: Float32Array): boolean => {
    for (const sample of samples) {
        if (Math.abs(sample) >= 1e-4) return true;
    }
    return false;
};

/** Pushes encoded WAV bytes to the recognizer and reports push errors cleanly. */
const pushEncodedWav = (
    wav: Uint8Array,
    invoke: DictationInvokeBridge,
    setState: (state: DictationState) => void,
    onError: (message: string) => void,
): void => {
    invoke.push(Array.from(wav)).catch((error: unknown) => {
        invoke.stop().catch(() => {
            /* ignore recognizer teardown errors */
        });
        setState("error");
        onError(describeDictationError(error));
    });
};

/** Disconnects audio graph nodes and closes the `AudioContext` + `MediaStream` tracks. */
const disconnectCaptureGraph = (
    context: AudioContext,
    stream: MediaStream,
    source: MediaStreamAudioSourceNode,
    processor: ScriptProcessorNode,
    silentGain: GainNode | null,
): void => {
    try {
        source.disconnect();
        processor.disconnect();
        silentGain?.disconnect();
    } catch {
        /* already torn down */
    }
    stopMediaStreamTracks(stream);
    context.close().catch(() => {
        /* ignore audio context close errors */
    });
};

/** Builds an active PCM capture session over an initialized `AudioContext` and `MediaStream`. */
const createActiveDictationSession = (
    context: AudioContext,
    stream: MediaStream,
    handlers: DictationHandlers,
    invoke: DictationInvokeBridge,
    setState: (state: DictationState) => void,
): DictationSession => {
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const silentGain = wireSilentCaptureGraph(context, source, processor);
    const chunks: Float32Array[] = [];
    const effectiveRate = resolveEffectiveSampleRate(context.sampleRate);
    const maxBufferedSamples = Math.max(
        DICTATION_SAMPLE_RATE,
        Math.round(effectiveRate * MAX_DICTATION_BUFFER_SECONDS),
    );
    let bufferedSamples = 0;
    let disposed = false;

    /** Releases audio graph, microphone tracks, and sample buffers idempotently. */
    const teardown = (): void => {
        if (disposed) return;
        disposed = true;
        processor.onaudioprocess = null;
        chunks.length = 0;
        bufferedSamples = 0;
        handlers.onLevel?.(0);
        disconnectCaptureGraph(context, stream, source, processor, silentGain);
    };

    /** Finalizes recorded PCM samples and dispatches WAV audio to the recognizer. */
    const commitCapture = (): void => {
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
        pushEncodedWav(wav, invoke, setState, handlers.onError);
    };

    processor.onaudioprocess = (event) => {
        if (disposed) return;
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
        if (bufferedSamples >= maxBufferedSamples) {
            handlers.onMaxDurationReached?.();
            commitCapture();
        }
    };

    return {
        commit: commitCapture,
        dispose: () => {
            teardown();
            invoke.stop().catch(() => {
                /* ignore recognizer teardown errors */
            });
            setState("idle");
        },
    };
};

/** Disposes audio context, media stream tracks, and backend recognizer after a startup failure. */
const cleanupFailedAudioSession = async (
    context: AudioContext | null,
    stream: MediaStream,
    invoke: DictationInvokeBridge,
    setState: (state: DictationState) => void,
    onError: (message: string) => void,
    err: unknown,
): Promise<void> => {
    if (context) {
        context.close().catch(() => {
            /* ignore audio context close failure */
        });
    }
    stopMediaStreamTracks(stream);
    await invoke.stop().catch(() => {
        /* ignore recognizer stop failure */
    });
    setState("error");
    onError(err instanceof Error ? err.message : String(err));
};

/** Record one utterance and push it to the recognizer. */
export const startDictation = async (
    handlers: DictationHandlers,
    constraints: MediaTrackConstraints | boolean,
    invoke: DictationInvokeBridge,
): Promise<DictationSession> => {
    const setState = handlers.onState ?? (() => undefined);
    setState("listening");

    const stream = await acquireStreamAndStartRecognizer(
        constraints,
        invoke,
        setState,
        handlers.onError,
    );

    const AudioCtor = resolveAudioContextCtor();
    if (!AudioCtor) {
        stopMediaStreamTracks(stream);
        await invoke.stop();
        setState("error");
        handlers.onError("This build cannot record audio.");
        throw new Error("AudioContext unavailable");
    }

    let context: AudioContext | null = null;
    try {
        context = new AudioCtor();
        return createActiveDictationSession(
            context,
            stream,
            handlers,
            invoke,
            setState,
        );
    } catch (err) {
        await cleanupFailedAudioSession(
            context,
            stream,
            invoke,
            setState,
            handlers.onError,
            err,
        );
        throw err;
    }
};
