import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDelayedFlag } from "@/lib/ui/use-delayed-flag";

/**
 * `useDelayedFlag` decides whether a loading indicator is ever seen. Both halves
 * matter and neither is visible in a type: work that finishes inside the delay
 * must show nothing at all, and work that finishes just after the indicator appears
 * must not make it stutter out in the next frame.
 */

function Probe({ active, delayMs, minVisibleMs }: { active: boolean; delayMs?: number; minVisibleMs?: number }) {
    const visible = useDelayedFlag(active, { delayMs, minVisibleMs });
    return <span data-testid="flag">{visible ? "visible" : "hidden"}</span>;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
});

const state = () => container.querySelector('[data-testid="flag"]')?.textContent;

describe("delayed flag", () => {
    it("stays hidden when the work finishes inside the delay", () => {
        act(() => root.render(<Probe active delayMs={200} minVisibleMs={400} />));
        expect(state()).toBe("hidden");
        act(() => vi.advanceTimersByTime(150));
        expect(state()).toBe("hidden");
        act(() => root.render(<Probe active={false} delayMs={200} minVisibleMs={400} />));
        act(() => vi.advanceTimersByTime(1000));
        expect(state()).toBe("hidden");
    });

    it("shows once the work outlasts the delay", () => {
        act(() => root.render(<Probe active delayMs={200} minVisibleMs={400} />));
        act(() => vi.advanceTimersByTime(199));
        expect(state()).toBe("hidden");
        act(() => vi.advanceTimersByTime(2));
        expect(state()).toBe("visible");
    });

    it("holds the indicator long enough to read once it has appeared", () => {
        act(() => root.render(<Probe active delayMs={200} minVisibleMs={400} />));
        act(() => vi.advanceTimersByTime(200));
        expect(state()).toBe("visible");
        // Work finishes one frame after the bar appeared.
        act(() => root.render(<Probe active={false} delayMs={200} minVisibleMs={400} />));
        act(() => vi.advanceTimersByTime(100));
        expect(state()).toBe("visible");
        act(() => vi.advanceTimersByTime(400));
        expect(state()).toBe("hidden");
    });

    it("does not hide work that restarts while the indicator is up", () => {
        act(() => root.render(<Probe active delayMs={200} minVisibleMs={400} />));
        act(() => vi.advanceTimersByTime(200));
        act(() => root.render(<Probe active={false} delayMs={200} minVisibleMs={400} />));
        act(() => vi.advanceTimersByTime(50));
        act(() => root.render(<Probe active delayMs={200} minVisibleMs={400} />));
        act(() => vi.advanceTimersByTime(1000));
        expect(state()).toBe("visible");
    });

    it("shows immediately when the delay is zero", () => {
        act(() => root.render(<Probe active delayMs={0} minVisibleMs={0} />));
        act(() => vi.advanceTimersByTime(1));
        expect(state()).toBe("visible");
    });
});
