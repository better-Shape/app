/**
 * The Design tab used to hand the chat the bridge's opaque node key as the
 * picked element's selector, so the mention block named something no search
 * could find. These pin the selector that replaces it.
 */
import { expect, it } from "vitest";
import { elementSelector } from "@/features/preview/design/library";

it("uses the id when the element has one", () => {
    expect(elementSelector({ tag: "DIV", id: "hero", classes: ["flex", "pricing"] })).toBe("div#hero");
});

it("falls back to the first author classes when there is no id", () => {
    expect(
        elementSelector({ tag: "section", id: null, classes: ["pricing", "flex", "mt-4", "compare"] }),
    ).toBe("section.pricing.compare");
});

it("skips utility and bridge classes", () => {
    expect(elementSelector({ tag: "button", classes: ["__bettershape-overlay", "p-2", "cta"] })).toBe(
        "button.cta",
    );
});

it("answers with the bare tag when nothing identifies the element", () => {
    expect(elementSelector({ tag: "p", id: null, classes: [] })).toBe("p");
});

it("drops values that cannot sit unquoted in a selector", () => {
    expect(elementSelector({ tag: "a", id: "has space", classes: ["w-1/2", "link"] })).toBe("a.link");
});
