import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FadeTruncate } from "@/components/ui/fade-truncate";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
    Reflect.deleteProperty(HTMLElement.prototype, "scrollWidth");
});

/** Makes every element report content wider than itself, as a long title in a narrow row does. */
const overflowEverything = () => {
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, get: () => 500 });
};

describe("FadeTruncate", () => {
    it("takes its direction from its own text and fades only while it overflows", () => {
        act(() => root.render(<FadeTruncate>مرحبا بالعالم</FadeTruncate>));
        const label = host.querySelector("span");
        expect(label?.getAttribute("dir")).toBe("auto");
        expect(label?.className).not.toContain("mask-image");
    });

    it("fades the trailing edge, which is the left one for right-to-left text", () => {
        overflowEverything();
        act(() => root.render(<FadeTruncate>مرحبا بالعالم، هذا عنوان طويل لجلسة</FadeTruncate>));
        const classes = host.querySelector("span")?.className ?? "";
        expect(classes).toContain("[mask-image:linear-gradient(to_right,");
        // `rtl:` matches `:dir(rtl)`, which `dir="auto"` resolves from the text.
        expect(classes).toContain("rtl:[mask-image:linear-gradient(to_left,");
    });
});
