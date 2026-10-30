import { act } from "react";
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

    it("disarms on Escape or timeout without confirming", () => {
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

        act(() => {
            btn.click();
        });
        expect(btn.dataset.state).toBe("armed");
        act(() => {
            vi.advanceTimersByTime(3700);
        });
        expect(btn.dataset.state).toBe("idle");
        expect(onConfirm).not.toHaveBeenCalled();
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
});
