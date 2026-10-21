import { describe, expect, it } from "vitest";
import { repairStreamGlitches } from "@/features/chat/ui/md/stream";

/** The original quadratic implementation, kept as the behavioural reference. */
function reference(text: string): string {
    if (text.length < 24) return text;

    for (let len = Math.min(120, Math.floor(text.length / 2)); len >= 20; len--) {
        for (let i = 0; i + len * 2 <= text.length; i++) {
            const a = text.slice(i, i + len);
            const b = text.slice(i + len, i + len * 2);
            if (a === b) {
                return text.slice(0, i + len) + text.slice(i + len * 2);
            }
        }
    }

    for (let start = 20; start < text.length - 20; start++) {
        const maxLen = Math.min(start, text.length - start);
        for (let len = maxLen; len >= 20; len--) {
            if (text.slice(0, len) === text.slice(start, start + len)) {
                return text.slice(0, start) + text.slice(start + len);
            }
        }
    }

    const glued = text.match(/([a-z])([A-Z][a-z]{4,})/);
    if (glued && glued.index !== undefined) {
        const splitAt = glued.index + 1;
        const prefix = text.slice(0, splitAt);
        const suffix = text.slice(splitAt);
        for (let checkLen = 16; checkLen <= Math.min(80, prefix.length); checkLen++) {
            const tail = prefix.slice(-checkLen);
            if (suffix.startsWith(tail)) {
                return prefix + suffix.slice(tail.length);
            }
        }
    }

    return text;
}

function rng(seed: number) {
    return () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 0x100000000;
    };
}

describe("repairStreamGlitches equivalence", () => {
    it("matches the reference on random inputs", () => {
        const rand = rng(42);
        const alphabet = "abcde fgh\n.";
        for (let caseIdx = 0; caseIdx < 500; caseIdx++) {
            const len = 20 + Math.floor(rand() * 380);
            let s = "";
            for (let i = 0; i < len; i++) {
                s += alphabet[Math.floor(rand() * alphabet.length)];
            }
            expect(repairStreamGlitches(s), `case ${caseIdx}: ${JSON.stringify(s)}`).toBe(reference(s));
        }
    });

    it("matches the reference on repeated and pasted blocks", () => {
        const rand = rng(7);
        const words = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "theta"];
        for (let caseIdx = 0; caseIdx < 300; caseIdx++) {
            const parts: string[] = [];
            const count = 4 + Math.floor(rand() * 30);
            for (let i = 0; i < count; i++) {
                parts.push(words[Math.floor(rand() * words.length)]!);
            }
            let s = parts.join(" ");
            const kind = Math.floor(rand() * 4);
            if (kind === 1) s += s.slice(0, 24 + Math.floor(rand() * 80));
            if (kind === 2) s = s.slice(0, 25) + s;
            if (kind === 3) s += s.slice(-30) + s.slice(-30);
            expect(repairStreamGlitches(s), `case ${caseIdx}`).toBe(reference(s));
        }
    });

    it("matches the reference at the length boundaries around the second pass", () => {
        // The prefix-repeat pass only has a `start` to try once the text reaches
        // 41 characters; both sides must agree exactly at 40, 41 and 42.
        const prefix = "the same twenty char";
        for (const total of [40, 41, 42, 43]) {
            const repeatedPrefix = (prefix + "s").slice(0, 21);
            const s = (repeatedPrefix + repeatedPrefix).padEnd(total, "x");
            expect(repairStreamGlitches(s), `len ${total}`).toBe(reference(s));
        }
        // 41 chars whose first 20 repeat at offset 20 (the exact boundary case).
        const boundary = "abcdefghijklmnopqrst" + "abcdefghijklmnopqrst" + "!";
        expect(boundary).toHaveLength(41);
        expect(repairStreamGlitches(boundary)).toBe(reference(boundary));
        expect(repairStreamGlitches(boundary)).toBe("abcdefghijklmnopqrst!");
    });

    it("keeps known shapes", () => {
        expect(repairStreamGlitches("short")).toBe("short");
        const repeated = "The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog.";
        expect(repairStreamGlitches(repeated)).toBe("The quick brown fox jumps over the lazy dog. ");
        const glued = "Here is a sentence that ran intoTwoWordsOfAnotherSentence".padEnd(60, ".");
        expect(repairStreamGlitches(glued)).toBe(reference(glued));
    });
});
