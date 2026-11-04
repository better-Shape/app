import { afterEach, describe, expect, it, vi } from "vitest";
import { copyWithHiddenTextarea } from "@/lib/ui/legacy-copy";

// jsdom ships no `execCommand`, so each test installs the one it needs.
const stubExecCommand = (impl: () => boolean) => {
    Object.defineProperty(document, "execCommand", { configurable: true, writable: true, value: vi.fn(impl) });
};

afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, "execCommand");
    document.body.innerHTML = "";
});

describe("hidden textarea copy", () => {
    it("reports the copy that landed", () => {
        stubExecCommand(() => true);
        expect(copyWithHiddenTextarea("text")).toBe(true);
        expect(document.body.querySelector("textarea")).toBeNull();
    });

    it("reports a refused copy so the caller can say so", () => {
        stubExecCommand(() => false);
        expect(copyWithHiddenTextarea("text")).toBe(false);
        expect(document.body.querySelector("textarea")).toBeNull();
    });

    it("reports a webview that does not implement the command", () => {
        stubExecCommand(() => {
            throw new Error("unsupported");
        });
        expect(copyWithHiddenTextarea("text")).toBe(false);
        expect(document.body.querySelector("textarea")).toBeNull();
    });
});
