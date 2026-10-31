import { afterEach, describe, expect, it } from "vitest";
import { MAX_QUOTE_CHARS, dispatchChatQuote } from "@/features/chat/ui/quote-selection";

type QuoteDetail = { id: string; text: string };

const received: QuoteDetail[] = [];
const handler = (event: Event) => {
    received.push((event as CustomEvent<QuoteDetail>).detail);
};

const listen = () => window.addEventListener("bettershape-chat-quote-selection", handler);

afterEach(() => {
    received.length = 0;
    window.removeEventListener("bettershape-chat-quote-selection", handler);
});

describe("chat quote dispatch", () => {
    it("assigns a distinct id to every quote", () => {
        listen();
        dispatchChatQuote("first");
        dispatchChatQuote("second");
        expect(received).toHaveLength(2);
        expect(received[0].id).not.toBe(received[1].id);
        expect(received[0].id.length).toBeGreaterThan(0);
    });

    it("trims and caps the quoted text", () => {
        listen();
        dispatchChatQuote("  hello  ");
        dispatchChatQuote("x".repeat(MAX_QUOTE_CHARS + 50));
        expect(received[0].text).toBe("hello");
        expect(received[1].text).toHaveLength(MAX_QUOTE_CHARS);
        expect(received[1].text.endsWith("...")).toBe(true);
    });

    it("drops whitespace-only selections", () => {
        listen();
        dispatchChatQuote("   \n\t ");
        expect(received).toHaveLength(0);
    });
});
