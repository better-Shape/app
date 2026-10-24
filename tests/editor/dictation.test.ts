import { describe, expect, it, vi } from "vitest";
import {
    DICTATION_SAMPLE_RATE,
    describeDictationError,
    encodeWavPcm16,
    resampleTo16k,
    startDictation,
} from "@/lib/editor/dictation";

function ascii(bytes: Uint8Array, offset: number, length: number) {
    return String.fromCharCode(...Array.from(bytes.slice(offset, offset + length)));
}

describe("encodeWavPcm16", () => {
    it("writes a RIFF/WAVE header a PCM reader can parse", () => {
        const wav = encodeWavPcm16(new Float32Array([0, 0]), DICTATION_SAMPLE_RATE);
        const view = new DataView(wav.buffer);
        expect(ascii(wav, 0, 4)).toBe("RIFF");
        expect(ascii(wav, 8, 4)).toBe("WAVE");
        expect(ascii(wav, 12, 4)).toBe("fmt ");
        expect(view.getUint32(16, true)).toBe(16); // PCM fmt chunk size
        expect(view.getUint16(20, true)).toBe(1); // PCM
        expect(view.getUint16(22, true)).toBe(1); // mono
        expect(view.getUint32(24, true)).toBe(DICTATION_SAMPLE_RATE);
        expect(view.getUint32(28, true)).toBe(DICTATION_SAMPLE_RATE * 2); // byte rate
        expect(view.getUint16(32, true)).toBe(2); // block align
        expect(view.getUint16(34, true)).toBe(16); // bits per sample
        expect(ascii(wav, 36, 4)).toBe("data");
    });

    it("declares sizes that match the samples it was given", () => {
        const samples = new Float32Array(160); // 10ms at 16k
        const wav = encodeWavPcm16(samples, DICTATION_SAMPLE_RATE);
        const view = new DataView(wav.buffer);
        expect(wav.byteLength).toBe(44 + 160 * 2);
        expect(view.getUint32(40, true)).toBe(160 * 2); // data chunk size
        expect(view.getUint32(4, true)).toBe(36 + 160 * 2); // RIFF size = file - 8
    });

    it("scales full-scale samples to the int16 extremes", () => {
        const wav = encodeWavPcm16(new Float32Array([0, 1, -1]), DICTATION_SAMPLE_RATE);
        const view = new DataView(wav.buffer);
        expect(view.getInt16(44, true)).toBe(0);
        expect(view.getInt16(46, true)).toBe(0x7fff);
        expect(view.getInt16(48, true)).toBe(-0x7fff);
    });

    it("clamps out-of-range samples instead of wrapping them", () => {
        // 1.5 would wrap to a negative int16 if it were scaled without clamping.
        const loud = encodeWavPcm16(new Float32Array([1.5, -1.5]), DICTATION_SAMPLE_RATE);
        const view = new DataView(loud.buffer);
        expect(view.getInt16(44, true)).toBe(0x7fff);
        expect(view.getInt16(46, true)).toBe(-0x7fff);
    });

    it("round-trips silence as silence", () => {
        const wav = encodeWavPcm16(new Float32Array(8), DICTATION_SAMPLE_RATE);
        const view = new DataView(wav.buffer);
        for (let i = 0; i < 8; i++) expect(view.getInt16(44 + i * 2, true)).toBe(0);
    });
});

describe("resampleTo16k", () => {
    it("returns the input untouched when it is already 16k", () => {
        const input = new Float32Array([0.1, 0.2, 0.3]);
        expect(resampleTo16k(input, DICTATION_SAMPLE_RATE)).toBe(input);
    });

    it("halves a 32k signal to 16k", () => {
        const input = new Float32Array([0, 1, 0, 1]);
        const out = resampleTo16k(input, 32_000);
        expect(out.length).toBe(2);
    });

    it("keeps a constant signal constant, whatever the ratio", () => {
        for (const rate of [8_000, 22_050, 44_100, 48_000]) {
            const out = resampleTo16k(new Float32Array(64).fill(0.5), rate);
            expect(out.length).toBeGreaterThan(0);
            for (const value of out) expect(value).toBeCloseTo(0.5, 5);
        }
    });

    it("drops the sample count by the rate ratio", () => {
        const out = resampleTo16k(new Float32Array(48_000), 48_000);
        expect(out.length).toBe(16_000);
    });

    it("does not blow up on an empty or nonsensical rate", () => {
        expect(resampleTo16k(new Float32Array(0), 48_000).length).toBe(0);
        expect(resampleTo16k(new Float32Array(4), 0).length).toBe(4);
    });

    it("stays inside the input range rather than overshooting", () => {
        const input = new Float32Array(100).fill(1);
        const out = resampleTo16k(input, 44_100);
        for (const value of out) expect(value).toBeLessThanOrEqual(1);
    });
});

describe("describeDictationError", () => {
    it("turns a denied microphone into something the user can act on", () => {
        const denied = new DOMException("denied", "NotAllowedError");
        expect(describeDictationError(denied)).toMatch(/denied/i);
    });

    it("names the case that actually applies", () => {
        expect(describeDictationError(new DOMException("x", "NotFoundError"))).toMatch(
            /no microphone/i,
        );
        expect(describeDictationError(new DOMException("x", "NotReadableError"))).toMatch(
            /in use/i,
        );
    });

    it("passes a backend message through rather than flattening it", () => {
        // The Rust side says "Dictation couldn't start. Turn on speech recognition in Windows."
        expect(describeDictationError(new Error("Turn on speech recognition in Windows."))).toBe(
            "Turn on speech recognition in Windows.",
        );
    });

    it("never returns an empty string", () => {
        for (const input of [undefined, null, "", new Error("")]) {
            expect(describeDictationError(input).length).toBeGreaterThan(0);
        }
    });
});

describe("startDictationCapture audio graph & RMS levels", () => {
    it("connects MediaStreamSource -> ScriptProcessor -> silent GainNode(0) -> destination and reports RMS levels", async () => {
        const connections: Array<[string, string]> = [];
        const stopTrack = vi.fn();
        type AudioProcessHandler = (e: { inputBuffer: { getChannelData: () => Float32Array } }) => void;
        let processorHandler: AudioProcessHandler | null = null;

        const destination = { name: "destination" };
        const silentGain = {
            name: "silentGain",
            gain: { value: 1 },
            connect: vi.fn((target: { name: string }) => connections.push(["silentGain", target.name])),
            disconnect: vi.fn(),
        };
        const processor = {
            name: "processor",
            set onaudioprocess(fn: AudioProcessHandler | null) {
                processorHandler = fn;
            },
            get onaudioprocess() {
                return processorHandler;
            },
            connect: vi.fn((target: { name: string }) => connections.push(["processor", target.name])),
            disconnect: vi.fn(),
        };
        const source = {
            name: "source",
            connect: vi.fn((target: { name: string }) => connections.push(["source", target.name])),
            disconnect: vi.fn(),
        };

        vi.stubGlobal(
            "AudioContext",
            class {
                sampleRate = 16_000;
                destination = destination;
                createMediaStreamSource() {
                    return source;
                }
                createScriptProcessor() {
                    return processor;
                }
                createGain() {
                    return silentGain;
                }
                async close() {}
            },
        );
        Object.defineProperty(navigator, "mediaDevices", {
            configurable: true,
            value: {
                getUserMedia: vi.fn(async () => ({
                    getTracks: () => [{ stop: stopTrack }],
                })),
            },
        });

        const levels: number[] = [];
        const session = await startDictation(
            {
                onText: () => {},
                onError: () => {},
                onLevel: (lvl) => levels.push(lvl),
            },
            true,
            {
                start: async () => {},
                stop: async () => {},
                push: async () => {},
            },
        );

        expect(silentGain.gain.value).toBe(0);
        expect(connections).toEqual([
            ["source", "processor"],
            ["processor", "silentGain"],
            ["silentGain", "destination"],
        ]);

        processor.onaudioprocess?.({
            inputBuffer: { getChannelData: () => new Float32Array(64).fill(0.2) },
        });
        expect(levels.length).toBe(1);
        expect(levels[0]).toBeGreaterThan(0);

        session.dispose();
        expect(stopTrack).toHaveBeenCalledTimes(1);
        expect(levels.at(-1)).toBe(0);

        vi.unstubAllGlobals();
    });
});