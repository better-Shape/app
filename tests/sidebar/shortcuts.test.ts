import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSidebarShortcut } from "@/features/agent/sidebar/shortcuts";

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; });

describe.each([["Windows", "ctrlKey"], ["Darwin", "metaKey"]] as const)("sidebar shortcut ownership on %s", (userAgent, modifier) => {
    beforeEach(() => vi.stubGlobal("navigator", { userAgent }));
    function key(options: KeyboardEventInit = {}) {
        return new KeyboardEvent("keydown", { key: "z", [modifier]: true, bubbles: true, cancelable: true, ...options });
    }
    it("allows the primary modifier without changing the secondary-modifier policy", () => {
        expect(isSidebarShortcut(key())).toBe(true);
        expect(isSidebarShortcut(key({ ctrlKey: true, metaKey: true }))).toBe(true);
        expect(isSidebarShortcut(key({ [modifier]: false }))).toBe(false);
    });
    it.each([{ altKey: true }, { shiftKey: true }, { isComposing: true }, { keyCode: 229 }])("rejects reserved input %j", options => {
        expect(isSidebarShortcut(key(options))).toBe(false);
    });
    it("does not handle an already-consumed event", () => {
        const event = key(); event.preventDefault();
        expect(isSidebarShortcut(event)).toBe(false);
    });
    it.each([
        '<input>', '<textarea></textarea>', '<select></select>',
        '<div role="textbox"><span></span></div>',
        '<div contenteditable><span></span></div>',
        '<div contenteditable="plaintext-only"><svg><path></path></svg></div>',
    ])("leaves editor input alone: %s", markup => {
        document.body.innerHTML = markup;
        const target = document.body.querySelector("path, span, input, textarea, select")!;
        let owned = true;
        target.addEventListener("keydown", event => { owned = isSidebarShortcut(event as KeyboardEvent); });
        target.dispatchEvent(key());
        expect(owned).toBe(false);
    });
    it("allows sidebar commands on ordinary noneditable markup", () => {
        document.body.innerHTML = '<div contenteditable="false"><span></span></div>';
        const target = document.body.querySelector("span")!;
        let owned = false;
        target.addEventListener("keydown", event => { owned = isSidebarShortcut(event as KeyboardEvent); });
        target.dispatchEvent(key());
        expect(owned).toBe(true);
    });
});
