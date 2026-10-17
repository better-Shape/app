import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    NO_RESIDUAL,
    cancelOwnAnimations,
    claimAnimation,
    forgetAnimations,
    isOwnAnimation,
    ownAnimations,
    parseTransform,
    remainingOffset,
    remainingTransform,
} from "@/features/agent/sidebar/motion";
import { installAnimationStub, type AnimationStub, type RecordedAnimation } from "./harness";

let animation: AnimationStub;

beforeEach(() => {
    animation = installAnimationStub();
});

afterEach(() => {
    animation.restore();
    document.body.innerHTML = "";
});

function row(): HTMLElement {
    const element = document.createElement("div");
    document.body.appendChild(element);
    return element;
}

/** Creates an animation the way the animators do, so it is claimed. */
function claimed(
    element: HTMLElement,
    keyframes: Keyframe[],
    progress: number | null,
): RecordedAnimation {
    const record = element.animate(keyframes, { duration: 200 }) as unknown as RecordedAnimation;
    record.progress = progress;
    claimAnimation(record, element);
    return record;
}

describe("parseTransform", () => {
    it("reads every translate spelling the animators produce", () => {
        expect(parseTransform("translate(10px, -20px)")).toEqual({ x: 10, y: -20, scaleX: 1, scaleY: 1 });
        expect(parseTransform("translateX(5px)")).toEqual({ x: 5, y: 0, scaleX: 1, scaleY: 1 });
        expect(parseTransform("translateY(-7px)")).toEqual({ x: 0, y: -7, scaleX: 1, scaleY: 1 });
        expect(parseTransform("translate3d(1px, 2px, 0)")).toEqual({ x: 1, y: 2, scaleX: 1, scaleY: 1 });
        // dnd-kit writes translate3d; a WebView may normalise it to a matrix-free
        // translate or keep it verbatim.
        expect(parseTransform("translate3d(0px, 12px, 0)").y).toBe(12);
    });

    it("reads every scale spelling", () => {
        expect(parseTransform("scale(2)")).toEqual({ x: 0, y: 0, scaleX: 2, scaleY: 2 });
        expect(parseTransform("scaleX(3)")).toEqual({ x: 0, y: 0, scaleX: 3, scaleY: 1 });
        expect(parseTransform("scaleY(0.5)")).toEqual({ x: 0, y: 0, scaleX: 1, scaleY: 0.5 });
        expect(parseTransform("scale3d(2, 4, 1)")).toEqual({ x: 0, y: 0, scaleX: 2, scaleY: 4 });
    });

    it("sums repeated and mixed functions in source order", () => {
        expect(parseTransform("translateY(10px) translateY(4px)")).toMatchObject({ y: 14 });
        expect(parseTransform("scale(2) scaleX(3)")).toMatchObject({ scaleX: 6, scaleY: 2 });
        expect(parseTransform("translate3d(5px, 5px, 0) scale(2)")).toEqual({
            x: 5,
            y: 5,
            scaleX: 2,
            scaleY: 2,
        });
    });

    it("treats identity, junk and absence as identity rather than guessing", () => {
        for (const value of ["none", "", "rotate(45deg)", "  ", null, undefined]) {
            expect(parseTransform(value as string)).toEqual({ x: 0, y: 0, scaleX: 1, scaleY: 1 });
        }
    });
});

describe("remainingTransform", () => {
    it("returns zeros for an element with nothing animating", () => {
        expect(remainingTransform(row())).toEqual(NO_RESIDUAL);
        expect(remainingTransform(null)).toEqual(NO_RESIDUAL);
        expect(remainingTransform(undefined)).toEqual(NO_RESIDUAL);
    });

    it("returns zeros when the element has no Web Animations API at all", () => {
        const element = row();
        delete (element as unknown as Record<string, unknown>).animate;
        delete (Element.prototype as unknown as Record<string, unknown>).getAnimations;
        expect(() => remainingTransform(element)).not.toThrow();
        expect(remainingTransform(element)).toEqual(NO_RESIDUAL);
    });

    it("returns the un-elapsed half of a running move", () => {
        const element = row();
        claimed(element, [{ transform: "translate(0, -80px)" }, { transform: "none" }], 0.5);

        expect(remainingTransform(element)).toEqual({ x: 0, y: -40, scaleX: 0, scaleY: 0 });
        expect(remainingOffset(element)).toBe(-40);
    });

    it("scales the residual by how little has been played", () => {
        const element = row();
        const record = claimed(
            element,
            [{ transform: "translate(0, -100px)" }, { transform: "none" }],
            0.25,
        );

        expect(remainingTransform(element).y).toBe(-75);
        // 0.9 is not representable in binary, so the residual is 1 - 0.9 rather
        // than exactly 0.1. `toBeCloseTo` is the honest assertion here; the
        // animators round the tail away before it reaches a keyframe.
        record.progress = 0.9;
        expect(remainingTransform(element).y).toBeCloseTo(-10, 9);
        // A finished animation owes nothing.
        record.progress = 1;
        expect(remainingTransform(element)).toEqual(NO_RESIDUAL);
    });

    it("expresses scale as a delta from 1", () => {
        const element = row();
        claimed(element, [{ transform: "scale(3)" }, { transform: "none" }], 0.5);
        // Interpolated scale at the halfway point is 2, so 1 is still owed.
        expect(remainingTransform(element).scaleX).toBe(1);
        expect(remainingTransform(element).scaleY).toBe(1);
    });

    it("sums several animations on the same element", () => {
        const element = row();
        claimed(element, [{ transform: "translateY(-40px)" }, { transform: "none" }], 0.5);
        claimed(element, [{ transform: "translateX(12px)" }, { transform: "none" }], 0.5);

        expect(remainingTransform(element)).toEqual({ x: 6, y: -20, scaleX: 0, scaleY: 0 });
    });

    it("carries nothing for an animation that does not end at identity", () => {
        const element = row();
        // A looping pulse: it starts 80px out and ends 20px out, so it will
        // never reach identity and there is no "distance still owed" to speak
        // of. Reading a residual here would seed the next FLIP with a number
        // that means nothing.
        //
        // The start transform is deliberately non-zero: an animation whose first
        // keyframe is already identity cannot distinguish this guard from its
        // absence, so a test using one would pass against broken code.
        claimed(element, [{ transform: "translateY(-80px)" }, { transform: "translateY(-20px)" }], 0.5);
        expect(remainingTransform(element)).toEqual(NO_RESIDUAL);
        expect(remainingOffset(element)).toBe(0);
    });

    it("still carries an animation whose first keyframe is identity", () => {
        const element = row();
        claimed(element, [{ transform: "scale(1)" }, { transform: "none" }], 0.5);
        expect(remainingTransform(element)).toEqual(NO_RESIDUAL);
    });

    it("carries nothing before the animation has produced a progress value", () => {
        const element = row();
        claimed(element, [{ transform: "translateY(-40px)" }, { transform: "none" }], null);
        expect(remainingTransform(element)).toEqual(NO_RESIDUAL);
    });

    it("ignores animations this module did not claim", () => {
        const element = row();
        const foreign = element.animate(
            [{ transform: "translateY(-500px)" }, { transform: "none" }],
            { duration: 1000 },
        ) as unknown as { progress: number | null };
        foreign.progress = 0.5;

        expect(ownAnimations(element)).toHaveLength(0);
        expect(remainingTransform(element)).toEqual(NO_RESIDUAL);
        expect(isOwnAnimation(foreign)).toBe(false);
    });

    it("stops reporting a residual once its animation is cancelled", () => {
        const element = row();
        const record = claimed(element, [{ transform: "translateY(-40px)" }, { transform: "none" }], 0.5);
        expect(isOwnAnimation(record)).toBe(true);
        expect(remainingTransform(element).y).toBe(-20);

        cancelOwnAnimations(element);

        expect(record.cancelled).toBe(true);
        expect(remainingTransform(element)).toEqual(NO_RESIDUAL);
    });

    it("drops a claimed element from the index without throwing", () => {
        const element = row();
        claimed(element, [{ transform: "translateY(-40px)" }, { transform: "none" }], 0.5);
        expect(() => forgetAnimations(element)).not.toThrow();
        expect(() => forgetAnimations(null)).not.toThrow();
        // Ownership survives the index drop, so the fallback path can still see
        // the animation if the engine reports it.
        expect(remainingTransform(element).y).toBe(-20);
    });

    it("survives a getAnimations that throws", () => {
        const element = row();
        (element as unknown as { getAnimations: () => never }).getAnimations = () => {
            throw new Error("detached");
        };
        expect(() => remainingTransform(element)).not.toThrow();
        expect(remainingTransform(element)).toEqual(NO_RESIDUAL);
    });
});

describe("cancelOwnAnimations", () => {
    it("cancels claimed animations and leaves foreign ones alone", () => {
        const element = row();
        const mine = claimed(element, [{ transform: "translateY(-40px)" }, { transform: "none" }], 0.5);
        const theirs = element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 10 }) as unknown as {
            cancelled: boolean;
        };

        cancelOwnAnimations(element);

        expect(mine).toMatchObject({ cancelled: true });
        expect(theirs.cancelled).toBe(false);
    });

    it("is a no-op for an element with nothing claimed", () => {
        const element = row();
        expect(() => cancelOwnAnimations(element)).not.toThrow();
        expect(() => cancelOwnAnimations(null)).not.toThrow();
    });
});
