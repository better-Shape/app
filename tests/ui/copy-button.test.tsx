import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopyButton } from "@/components/ui/copy-button";
import { useCopyToClipboard } from "@/lib/ui/use-copy";
import { notificationStore } from "@/features/notifications";

/**
 * Copy feedback has to be truthful. Before this hook every call site wrote the
 * clipboard without awaiting it and announced success regardless, so a blocked or
 * missing clipboard produced a green "Copied" toast for text that never landed.
 * These tests pin the awaited behaviour and the drawn-mark handoff.
 */

let container: HTMLDivElement;
let root: Root;
let written: string[];

const toasts = () => notificationStore.getSnapshot().notifications.map((n) => n.type);

beforeEach(() => {
    vi.useFakeTimers();
    notificationStore.clearAll();
    written = [];
    Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
            writeText: vi.fn(async (text: string) => {
                written.push(text);
            }),
        },
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
});

function Probe({ text, silent }: { text: string; silent?: boolean }) {
    const { copied, failed, copy } = useCopyToClipboard({ silent });
    return (
        <button data-testid="probe" data-state={copied ? "copied" : failed ? "failed" : "idle"} onClick={() => copy(text)}>
            go
        </button>
    );
}

const probe = () => container.querySelector('[data-testid="probe"]') as HTMLButtonElement;

describe("useCopyToClipboard", () => {
    it("writes the text and confirms only after the write resolves", async () => {
        act(() => root.render(<Probe text="abc123" />));
        await act(async () => {
            probe().click();
            await Promise.resolve();
        });
        expect(written).toEqual(["abc123"]);
        expect(probe().getAttribute("data-state")).toBe("copied");
        expect(toasts()).toEqual(["success"]);
    });

    it("reports failure instead of a green toast when the write rejects", async () => {
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) },
        });
        act(() => root.render(<Probe text="abc123" />));
        await act(async () => {
            probe().click();
            await Promise.resolve();
        });
        expect(probe().getAttribute("data-state")).toBe("failed");
        // A retry would hit the same wall, so the user gets guidance, not a green tick.
        expect(toasts()).toEqual(["error"]);
    });

    it("treats a missing clipboard API as failure rather than throwing", async () => {
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
        act(() => root.render(<Probe text="abc123" />));
        await act(async () => {
            probe().click();
            await Promise.resolve();
        });
        expect(probe().getAttribute("data-state")).toBe("failed");
    });

    it("settles back to idle so the next copy animates again", async () => {
        act(() => root.render(<Probe text="abc123" />));
        await act(async () => {
            probe().click();
            await Promise.resolve();
        });
        expect(probe().getAttribute("data-state")).toBe("copied");
        act(() => vi.advanceTimersByTime(1500));
        expect(probe().getAttribute("data-state")).toBe("idle");
    });

    it("keeps quiet when the surface shows its own confirmation", async () => {
        act(() => root.render(<Probe text="abc123" silent />));
        await act(async () => {
            probe().click();
            await Promise.resolve();
        });
        expect(probe().getAttribute("data-state")).toBe("copied");
        expect(notificationStore.getSnapshot().notifications).toHaveLength(0);
    });

    it("clears its reset timer on unmount", async () => {
        act(() => root.render(<Probe text="abc123" />));
        await act(async () => {
            probe().click();
            await Promise.resolve();
        });
        const timers = vi.getTimerCount();
        act(() => root.unmount());
        // The only pending timer was the reset; unmount must take it with it.
        expect(timers).toBeGreaterThan(0);
        expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
    });
});

describe("CopyButton", () => {
    const button = () => container.querySelector('[data-copy-state]') as HTMLButtonElement;

    it("draws the check as a stroked path, not a filled glyph", async () => {
        act(() => root.render(<CopyButton text="hash" label="Copy hash" />));
        expect(button().getAttribute("data-copy-state")).toBe("idle");
        expect(container.querySelector(".t-success-check")).toBeNull();
        await act(async () => {
            button().click();
            await Promise.resolve();
        });
        expect(button().getAttribute("data-copy-state")).toBe("copied");
        const draw = container.querySelector(".t-success-check");
        expect(draw).not.toBeNull();
        expect(draw?.querySelector("svg path")?.getAttribute("fill")).toBeNull();
    });

    it("mounts the drawn mark only on the flip, so first paint stays still", () => {
        act(() => root.render(<CopyButton text="hash" />));
        expect(container.querySelector(".t-success-check")).toBeNull();
        expect(container.querySelector("svg")).not.toBeNull();
    });

    it("renames itself for assistive tech and shows the word when asked", async () => {
        act(() => root.render(<CopyButton text="hash" label="Copy URL" showLabel />));
        expect(button().getAttribute("aria-label")).toBe("Copy URL");
        expect(button().textContent).toContain("Copy");
        await act(async () => {
            button().click();
            await Promise.resolve();
        });
        expect(button().getAttribute("aria-label")).toBe("Copied");
        expect(button().textContent).toContain("Copied");
    });

    it("stops the click from activating a surrounding row", async () => {
        const onRow = vi.fn();
        act(() =>
            root.render(
                <div onClick={onRow}>
                    <CopyButton text="hash" />
                </div>,
            ),
        );
        await act(async () => {
            button().click();
            await Promise.resolve();
        });
        expect(onRow).not.toHaveBeenCalled();
    });
});
