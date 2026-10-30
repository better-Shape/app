import { act } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HoldButton } from "@/components/ui/hold-button";

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

function render(node: React.ReactElement) {
    act(() => root.render(node));
}

const getButton = () => container.querySelector("button") as HTMLButtonElement;

describe("HoldButton", () => {
    it("charges on pointer hold, confirms at holdMs, suppresses post-hold click, and resets", () => {
        const onConfirm = vi.fn();
        render(
            <HoldButton
                ariaLabel="Discard changes"
                label="Discard changes"
                armedLabel="Click to confirm"
                holdMs={600}
                onConfirm={onConfirm}
            />,
        );

        const btn = getButton();
        expect(btn.dataset.state).toBe("idle");

        act(() => {
            btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
        });
        expect(btn.dataset.state).toBe("holding");

        act(() => {
            vi.advanceTimersByTime(600);
        });
        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(btn.dataset.state).toBe("confirmed");
        expect(btn.querySelector(".t-success-check svg")).not.toBeNull();

        act(() => {
            btn.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }));
            btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(onConfirm).toHaveBeenCalledTimes(1);

        act(() => {
            vi.advanceTimersByTime(1300);
        });
        expect(btn.dataset.state).toBe("idle");
    });

    it("cancels cleanly when released mid-hold without firing onConfirm", () => {
        const onConfirm = vi.fn();
        render(
            <HoldButton
                ariaLabel="Discard"
                label="Discard"
                holdMs={650}
                onConfirm={onConfirm}
            />,
        );

        const btn = getButton();
        act(() => {
            btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
        });
        act(() => {
            vi.advanceTimersByTime(320);
        });
        act(() => {
            btn.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }));
            btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });

        expect(btn.dataset.state).toBe("idle");
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it("provides a WCAG two-step armed fallback on quick tap or assistive .click()", () => {
        const onConfirm = vi.fn();
        render(
            <HoldButton
                ariaLabel="Restore file"
                label="Restore file"
                armedLabel="Confirm restore"
                onConfirm={onConfirm}
            />,
        );

        const btn = getButton();
        act(() => {
            btn.click();
        });
        expect(onConfirm).not.toHaveBeenCalled();
        expect(btn.dataset.state).toBe("armed");
        expect(btn.textContent).toContain("Confirm restore");

        act(() => {
            btn.click();
        });
        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(btn.dataset.state).toBe("confirmed");
    });

    it("disarms on Escape or outside pointerdown without imposing a deadline on armed state", () => {
        const onConfirm = vi.fn();
        render(
            <HoldButton
                ariaLabel="Cancel workflow run"
                label="Cancel run"
                armedLabel="Confirm"
                onConfirm={onConfirm}
            />,
        );

        const btn = getButton();
        act(() => {
            btn.click();
        });
        expect(btn.dataset.state).toBe("armed");

        act(() => {
            btn.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        });
        expect(btn.dataset.state).toBe("idle");
        expect(onConfirm).not.toHaveBeenCalled();

        // Clicking outside disarms without confirming.
        act(() => {
            btn.click();
        });
        expect(btn.dataset.state).toBe("armed");
        act(() => {
            document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
        });
        expect(btn.dataset.state).toBe("idle");
        expect(onConfirm).not.toHaveBeenCalled();

        // Remaining on the armed button imposes no fixed countdown (WCAG 2.2.1): a second press after 10s confirms.
        act(() => {
            btn.click();
            vi.advanceTimersByTime(10_000);
        });
        expect(btn.dataset.state).toBe("armed");
        act(() => {
            btn.click();
        });
        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(btn.dataset.state).toBe("confirmed");
    });

    it("survives Safari/WKWebView pointer blur while still cancelling keyboard holds on blur", () => {
        const onConfirm = vi.fn();
        render(
            <HoldButton
                ariaLabel="Discard"
                label="Discard"
                holdMs={500}
                onConfirm={onConfirm}
            />,
        );

        const other = document.createElement("button");
        container.append(other);
        const btn = getButton();
        other.focus();

        act(() => {
            btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
            btn.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
            vi.advanceTimersByTime(500);
        });
        expect(onConfirm).toHaveBeenCalledTimes(1);

        act(() => {
            vi.advanceTimersByTime(1300);
        });
        expect(btn.dataset.state).toBe("idle");

        btn.focus();
        act(() => {
            btn.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
            btn.dispatchEvent(new KeyboardEvent("keydown", { key: " ", repeat: true, bubbles: true }));
        });
        expect(btn.dataset.state).toBe("holding");

        act(() => {
            btn.blur();
            vi.advanceTimersByTime(600);
        });
        expect(btn.dataset.state).toBe("idle");
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it("cancels touch hold when pointer drags outside button bounds under implicit pointer capture", () => {
        const onConfirm = vi.fn();
        render(
            <HoldButton
                ariaLabel="Discard changes"
                label="Discard"
                holdMs={600}
                onConfirm={onConfirm}
            />,
        );

        const btn = getButton();
        vi.spyOn(btn, "getBoundingClientRect").mockReturnValue({
            left: 20,
            top: 10,
            right: 100,
            bottom: 38,
            width: 80,
            height: 28,
            x: 20,
            y: 10,
            toJSON: () => ({}),
        });

        act(() => {
            btn.dispatchEvent(
                new PointerEvent("pointerdown", {
                    bubbles: true,
                    button: 0,
                    pointerId: 7,
                    clientX: 40,
                    clientY: 20,
                }),
            );
        });
        expect(btn.dataset.state).toBe("holding");

        // Drag finger outside bounds without firing pointerleave (implicit touch capture).
        act(() => {
            btn.dispatchEvent(
                new PointerEvent("pointermove", {
                    bubbles: true,
                    pointerId: 7,
                    clientX: 145,
                    clientY: 20,
                }),
            );
            vi.advanceTimersByTime(700);
        });

        expect(btn.dataset.state).toBe("idle");
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it("aborts in-flight hold and armed timers when disabled becomes true", () => {
        const onConfirm = vi.fn();
        render(
            <HoldButton
                ariaLabel="Cancel workflow run"
                label="Cancel run"
                holdMs={500}
                onConfirm={onConfirm}
            />,
        );

        const btn = getButton();
        act(() => {
            btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
            vi.advanceTimersByTime(250);
        });
        expect(btn.dataset.state).toBe("holding");

        render(
            <HoldButton
                ariaLabel="Cancel workflow run"
                label="Cancel run"
                holdMs={500}
                disabled
                onConfirm={onConfirm}
            />,
        );
        act(() => {
            vi.advanceTimersByTime(500);
        });
        expect(btn.dataset.state).toBe("idle");
        expect(onConfirm).not.toHaveBeenCalled();

        // Re-enable, arm via assistive click, then disable while armed -> resets to idle and stays disarmed.
        render(
            <HoldButton
                ariaLabel="Cancel workflow run"
                label="Cancel run"
                holdMs={500}
                onConfirm={onConfirm}
            />,
        );
        act(() => {
            btn.click();
        });
        expect(btn.dataset.state).toBe("armed");

        render(
            <HoldButton
                ariaLabel="Cancel workflow run"
                label="Cancel run"
                holdMs={500}
                disabled
                onConfirm={onConfirm}
            />,
        );
        expect(btn.dataset.state).toBe("idle");

        render(
            <HoldButton
                ariaLabel="Cancel workflow run"
                label="Cancel run"
                holdMs={500}
                onConfirm={onConfirm}
            />,
        );
        expect(btn.dataset.state).toBe("idle");
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it("confirms armed pointer presses only on pointerup inside the button and cancels on drag-out", () => {
        const onConfirm = vi.fn();
        render(
            <HoldButton
                ariaLabel="Discard changes"
                label="Discard"
                armedLabel="Confirm"
                onConfirm={onConfirm}
            />,
        );

        const btn = getButton();
        vi.spyOn(btn, "getBoundingClientRect").mockReturnValue({
            left: 10,
            top: 10,
            right: 90,
            bottom: 40,
            width: 80,
            height: 30,
            x: 10,
            y: 10,
            toJSON: () => ({}),
        });

        act(() => {
            btn.click();
        });
        expect(btn.dataset.state).toBe("armed");

        // Pressing down while armed must NOT fire on pointerdown (WCAG 2.5.2).
        act(() => {
            btn.dispatchEvent(
                new PointerEvent("pointerdown", {
                    bubbles: true,
                    button: 0,
                    pointerId: 9,
                    clientX: 40,
                    clientY: 25,
                }),
            );
        });
        expect(onConfirm).not.toHaveBeenCalled();

        // Dragging outside before releasing disarms without firing onConfirm.
        act(() => {
            btn.dispatchEvent(
                new PointerEvent("pointermove", {
                    bubbles: true,
                    pointerId: 9,
                    clientX: 160,
                    clientY: 25,
                }),
            );
            btn.dispatchEvent(
                new PointerEvent("pointerup", {
                    bubbles: true,
                    pointerId: 9,
                    clientX: 160,
                    clientY: 25,
                }),
            );
        });
        expect(btn.dataset.state).toBe("idle");
        expect(onConfirm).not.toHaveBeenCalled();

        // Re-arm and release inside -> confirms on pointerup.
        act(() => {
            btn.click();
        });
        expect(btn.dataset.state).toBe("armed");
        act(() => {
            btn.dispatchEvent(
                new PointerEvent("pointerdown", {
                    bubbles: true,
                    button: 0,
                    pointerId: 10,
                    clientX: 40,
                    clientY: 25,
                }),
            );
            btn.dispatchEvent(
                new PointerEvent("pointerup", {
                    bubbles: true,
                    pointerId: 10,
                    clientX: 40,
                    clientY: 25,
                }),
            );
        });
        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(btn.dataset.state).toBe("confirmed");
    });

    it("waits for async onConfirm before showing confirmed and returns to idle on rejection", async () => {
        let resolveFirst!: () => void;
        let rejectSecond!: (err: Error) => void;
        const onConfirm = vi
            .fn<() => Promise<void>>()
            .mockImplementationOnce(
                () =>
                    new Promise<void>((resolve) => {
                        resolveFirst = resolve;
                    }),
            )
            .mockImplementationOnce(
                () =>
                    new Promise<void>((_resolve, reject) => {
                        rejectSecond = reject;
                    }),
            );

        render(
            <HoldButton
                ariaLabel="Discard changes"
                label="Discard"
                confirmedLabel="Done"
                onConfirm={onConfirm}
            />,
        );

        const btn = getButton();
        act(() => {
            btn.click();
            btn.click();
        });
        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(btn.dataset.state).toBe("idle");
        expect(btn.getAttribute("aria-busy")).toBe("true");
        expect(btn.getAttribute("aria-label")).toBe("Discard changes");

        // Duplicate clicks while in-flight are ignored.
        act(() => {
            btn.click();
        });
        expect(onConfirm).toHaveBeenCalledTimes(1);

        await act(async () => {
            resolveFirst();
            await Promise.resolve();
        });
        expect(btn.dataset.state).toBe("confirmed");
        expect(btn.getAttribute("aria-busy")).toBeNull();

        act(() => {
            vi.advanceTimersByTime(1500);
        });
        expect(btn.dataset.state).toBe("idle");

        // Second async invocation resolves to false -> settles back to idle without flashing confirmed.
        const onConfirmFalse = vi.fn<() => Promise<boolean>>().mockResolvedValue(false);
        render(
            <HoldButton
                ariaLabel="Discard changes"
                label="Discard"
                confirmedLabel="Done"
                onConfirm={onConfirmFalse}
            />,
        );
        act(() => {
            btn.click();
            btn.click();
        });
        await act(async () => {
            await Promise.resolve();
        });
        expect(onConfirmFalse).toHaveBeenCalledTimes(1);
        expect(btn.dataset.state).toBe("idle");

        // Third async invocation rejects -> settles back to idle without flashing confirmed.
        render(
            <HoldButton
                ariaLabel="Discard changes"
                label="Discard"
                confirmedLabel="Done"
                onConfirm={onConfirm}
            />,
        );
        act(() => {
            btn.click();
            btn.click();
        });
        await act(async () => {
            rejectSecond(new Error("git discard failed"));
            await Promise.resolve();
        });
        expect(btn.dataset.state).toBe("idle");
    });

    it("ignores unrelated pointerleave and pointercancel while a keyboard hold is active", () => {
        const onConfirm = vi.fn();
        render(
            <HoldButton
                ariaLabel="Cancel workflow run"
                label="Cancel run"
                holdMs={400}
                onConfirm={onConfirm}
            />,
        );

        const btn = getButton();
        act(() => {
            btn.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
            vi.advanceTimersByTime(150);
            btn.dispatchEvent(new PointerEvent("pointerleave", { bubbles: false, pointerId: 1 }));
            btn.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 }));
        });
        expect(btn.dataset.state).toBe("holding");

        act(() => {
            vi.advanceTimersByTime(250);
        });
        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(btn.dataset.state).toBe("confirmed");
    });

    it("ignores mismatched release sources on armed presses so unrelated keyup or pointerup never confirms", () => {
        const onConfirm = vi.fn();
        render(
            <HoldButton
                ariaLabel="Discard changes"
                label="Discard"
                armedLabel="Confirm"
                onConfirm={onConfirm}
            />,
        );

        const btn = getButton();
        act(() => {
            btn.click();
        });
        expect(btn.dataset.state).toBe("armed");

        // Start an armed pointer press; an unrelated keyup must NOT confirm it.
        act(() => {
            btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 12 }));
            btn.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
        });
        expect(onConfirm).not.toHaveBeenCalled();
        expect(btn.dataset.state).toBe("armed");

        // Matching pointerup completes the confirmation.
        act(() => {
            btn.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 12 }));
        });
        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(btn.dataset.state).toBe("confirmed");
    });

    it("clears click suppression on pointercancel so the next assistive click arms cleanly", () => {
        const onConfirm = vi.fn();
        render(
            <HoldButton
                ariaLabel="Restore file"
                label="Restore"
                armedLabel="Confirm"
                onConfirm={onConfirm}
            />,
        );

        const btn = getButton();
        act(() => {
            btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 3 }));
            btn.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 3 }));
        });
        expect(btn.dataset.state).toBe("idle");

        act(() => {
            btn.click();
        });
        expect(btn.dataset.state).toBe("armed");
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it("releases implicit pointer capture on both target and button and aborts touch drag-away via document pointermove without pointerleave", () => {
        const onConfirm = vi.fn();
        render(
            <HoldButton
                ariaLabel="Discard hunk"
                label="Discard hunk"
                holdMs={500}
                onConfirm={onConfirm}
            />,
        );

        const btn = getButton();
        vi.spyOn(btn, "getBoundingClientRect").mockReturnValue({
            x: 10,
            y: 10,
            left: 10,
            top: 10,
            right: 90,
            bottom: 40,
            width: 80,
            height: 30,
            toJSON: () => ({}),
        });

        const innerSpan = btn.querySelector("span") as HTMLSpanElement;
        const releaseChild = vi.fn();
        const releaseButton = vi.fn();
        Object.defineProperty(innerSpan, "hasPointerCapture", { value: () => true, configurable: true });
        Object.defineProperty(innerSpan, "releasePointerCapture", { value: releaseChild, configurable: true });
        Object.defineProperty(btn, "hasPointerCapture", { value: () => true, configurable: true });
        Object.defineProperty(btn, "releasePointerCapture", { value: releaseButton, configurable: true });

        act(() => {
            innerSpan.dispatchEvent(
                new PointerEvent("pointerdown", {
                    bubbles: true,
                    button: 0,
                    pointerId: 21,
                    clientX: 40,
                    clientY: 20,
                }),
            );
        });
        expect(releaseChild).toHaveBeenCalledWith(21);
        expect(releaseButton).toHaveBeenCalledWith(21);
        expect(btn.dataset.state).toBe("holding");

        // After implicit touch capture is released, dragging outside dispatches pointermove on
        // document.body rather than the button, with zero pointerleave on the button itself.
        act(() => {
            vi.advanceTimersByTime(180);
            document.body.dispatchEvent(
                new PointerEvent("pointermove", {
                    bubbles: true,
                    pointerId: 21,
                    clientX: 165,
                    clientY: 20,
                }),
            );
        });
        expect(btn.dataset.state).toBe("idle");

        act(() => {
            vi.advanceTimersByTime(600);
            document.body.dispatchEvent(
                new PointerEvent("pointerup", {
                    bubbles: true,
                    pointerId: 21,
                    clientX: 165,
                    clientY: 20,
                }),
            );
        });
        expect(onConfirm).not.toHaveBeenCalled();

        // Subsequent hold on the button still works (no stuck pointer session).
        act(() => {
            btn.dispatchEvent(
                new PointerEvent("pointerdown", {
                    bubbles: true,
                    button: 0,
                    pointerId: 22,
                    clientX: 40,
                    clientY: 20,
                }),
            );
            vi.advanceTimersByTime(500);
        });
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it("prevents confirmation when disabled flips synchronously or while an async confirm is resolving", async () => {
        let resolveAsync: (() => void) | null = null;
        const onConfirm = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    resolveAsync = resolve;
                }),
        );

        render(
            <HoldButton
                ariaLabel="Delete branch"
                label="Delete branch"
                holdMs={400}
                onConfirm={onConfirm}
            />,
        );

        const btn = getButton();
        act(() => {
            btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 31 }));
            vi.advanceTimersByTime(399);
            // Commit disabled=true synchronously via flushSync and fire the timer immediately
            // in the same tick before passive useEffects flush.
            flushSync(() => {
                root.render(
                    <HoldButton
                        ariaLabel="Delete branch"
                        label="Delete branch"
                        holdMs={400}
                        disabled
                        onConfirm={onConfirm}
                    />,
                );
            });
            vi.advanceTimersByTime(50);
        });
        expect(onConfirm).not.toHaveBeenCalled();
        expect(btn.dataset.state).toBe("idle");

        // Re-enable, trigger async confirm, then disable while async promise is still in flight.
        render(
            <HoldButton
                ariaLabel="Delete branch"
                label="Delete branch"
                holdMs={400}
                onConfirm={onConfirm}
            />,
        );
        act(() => {
            btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 32 }));
            vi.advanceTimersByTime(400);
        });
        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(btn.getAttribute("aria-busy")).toBe("true");

        render(
            <HoldButton
                ariaLabel="Delete branch"
                label="Delete branch"
                holdMs={400}
                disabled
                onConfirm={onConfirm}
            />,
        );
        await act(async () => {
            resolveAsync?.();
            await Promise.resolve();
        });
        expect(btn.dataset.state).toBe("idle");
    });
});
