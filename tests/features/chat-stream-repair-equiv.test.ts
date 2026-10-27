import { describe, expect, it } from "vitest";
import {
    preprocessChatMarkdown,
    repairStreamGlitches,
} from "@/features/chat/ui/md/stream";

/** The original quadratic implementation, kept as the behavioural reference. */
function reference(text: string): string {
    // The shortest adjacent duplicate is two 20-char halves, so nothing below
    // 40 characters can match; production short-circuits there too.
    if (text.length < 40) return text;

    for (let len = Math.min(120, Math.floor(text.length / 2)); len >= 20; len--) {
        for (let i = 0; i + len * 2 <= text.length; i++) {
            const a = text.slice(i, i + len);
            const b = text.slice(i + len, i + len * 2);
            if (a === b) {
                return text.slice(0, i + len) + text.slice(i + len * 2);
            }
        }
    }

    // A prefix replay is only a streaming glitch when it is back-to-back, glued
    // into the previous token, or long. The stream re-sends short phrases at
    // paragraph starts in ordinary prose, and those must survive.
    for (let start = 20; start < text.length - 20; start++) {
        const maxLen = Math.min(start, text.length - start);
        let matched = 0;
        while (matched < maxLen && text.charCodeAt(matched) === text.charCodeAt(start + matched)) {
            matched++;
        }
        if (matched < 20) continue;
        const prevChar = text.charAt(start - 1);
        const isSuffixReplay = start + matched >= text.length - 1;
        const isGlitchReplay =
            matched === start
            || matched >= 80
            || isSuffixReplay
            || (prevChar.length > 0 && !/\s/.test(prevChar));
        if (isGlitchReplay) return text.slice(0, start) + text.slice(start + matched);
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

    it("never leaves unpaired surrogates or split emoji clusters at display or preprocess caps", () => {
        const hasLoneSurrogate = (value: string): boolean => {
            for (let idx = 0; idx < value.length; idx += 1) {
                const code = value.charCodeAt(idx);
                if (code >= 0xd800 && code <= 0xdbff) {
                    const next = value.charCodeAt(idx + 1);
                    if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
                    idx += 1;
                } else if (code >= 0xdc00 && code <= 0xdfff) {
                    return true;
                }
            }
            return false;
        };
        const buildNonRepeatingAscii = (length: number): string => {
            const chunks: string[] = [];
            let total = 0;
            let counter = 0;
            while (total < length) {
                const token = `[block-${String(counter).padStart(6, "0")}] `;
                chunks.push(token);
                total += token.length;
                counter += 1;
            }
            return chunks.join("").slice(0, length);
        };

        // 47,999 ASCII chars + 2-UTF16-unit emoji ("🚀") places MAX_DISPLAY_CHARS (48,000)
        // directly between the high and low surrogate halves during streaming.
        const head47999 = buildNonRepeatingAscii(47_999);
        const splitSurrogate = `${head47999}🚀 trailing text`;
        const streamed = preprocessChatMarkdown(splitSurrogate, { streaming: true });
        expect(hasLoneSurrogate(streamed)).toBe(false);
        expect(streamed).toBe(`${head47999}\n\n... (response truncated for display)`);

        // Multi-codepoint ZWJ family emoji straddling MAX_DISPLAY_CHARS (48,000) drops cleanly.
        const head47996 = buildNonRepeatingAscii(47_996);
        const splitZwj = `${head47996}👨‍👩‍👧‍👦 trailing text`;
        const zwjOut = preprocessChatMarkdown(splitZwj, { streaming: true });
        expect(hasLoneSurrogate(zwjOut)).toBe(false);
        expect(zwjOut).toBe(`${head47996}\n\n... (response truncated for display)`);

        // Settled mode exercises BOTH capSettledPreprocessInput (96,000) and
        // truncateForDisplay (48,000) when emojis straddle both boundaries.
        const splitBothCaps = `${head47999}🚀${buildNonRepeatingAscii(47_998)}🎉 trailing text`;
        const settledOut = preprocessChatMarkdown(splitBothCaps, { streaming: false });
        expect(hasLoneSurrogate(settledOut)).toBe(false);
        expect(settledOut).toBe(`${head47999}\n\n... (response truncated for display)`);
    });
});
