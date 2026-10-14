/**
 * jsdom has no Web Animations API: `Element.prototype.animate` and
 * `Element.prototype.getAnimations` are both undefined, and
 * `getBoundingClientRect` returns all zeros for everything. Every test in this
 * folder therefore installs the stubs below — they are not conveniences, they
 * are the only way the module can be observed at all.
 */

export interface StubRect {
    top: number;
    left: number;
    width: number;
    height: number;
}

export interface RecordedKeyframe {
    transform?: string;
    opacity?: number;
    height?: string;
    [key: string]: unknown;
}

export interface RecordedAnimation {
    element: Element;
    keyframes: RecordedKeyframe[];
    options: Record<string, unknown>;
    playState: string;
    /** Reported by `getComputedTiming()`. `null` models "before the first frame". */
    progress: number | null;
    cancelled: boolean;
    effect: {
        getComputedTiming: () => { progress: number | null };
        getKeyframes: () => RecordedKeyframe[];
    };
    finished: Promise<unknown>;
    cancel: () => void;
}

interface AnimateLike {
    (keyframes: RecordedKeyframe[] | RecordedKeyframe, options?: Record<string, unknown>): RecordedAnimation;
}

interface GetAnimationsLike {
    (): RecordedAnimation[];
}

const MOTION_ID = "data-motion-id";

const animationsByElement = new WeakMap<Element, RecordedAnimation[]>();
const liveCalls: RecordedAnimation[] = [];

function makeRecord(
    element: Element,
    keyframes: RecordedKeyframe[] | RecordedKeyframe,
    options: Record<string, unknown> | undefined,
): RecordedAnimation {
    const frames = Array.isArray(keyframes) ? keyframes : [keyframes];
    const record: RecordedAnimation = {
        element,
        keyframes: frames,
        options: (options ?? {}) as Record<string, unknown>,
        playState: "running",
        progress: null,
        cancelled: false,
        effect: {
            getComputedTiming: () => ({ progress: record.progress }),
            getKeyframes: () => record.keyframes,
        },
        // Never settles. The module must not depend on `finished` resolving; the
        // exit clone's fallback timer is what has to clean up.
        finished: new Promise(() => {}),
        cancel() {
            record.cancelled = true;
            record.playState = "idle";
        },
    };
    return record;
}

export interface AnimationStub {
    /** Every animation created since install, in order. */
    calls: RecordedAnimation[];
    /** Animations created on one element. */
    forElement(element: Element): RecordedAnimation[];
    restore(): void;
}

export function installAnimationStub(): AnimationStub {
    const prototype = Element.prototype as unknown as Record<string, unknown>;
    const hadAnimate = "animate" in prototype;
    const originalAnimate = prototype.animate as AnimateLike | undefined;
    const hadGetAnimations = "getAnimations" in prototype;
    const originalGetAnimations = prototype.getAnimations as GetAnimationsLike | undefined;

    const animate: AnimateLike = function (this: Element, keyframes, options) {
        const record = makeRecord(this, keyframes, options);
        const list = animationsByElement.get(this) ?? [];
        list.push(record);
        animationsByElement.set(this, list);
        liveCalls.push(record);
        return record;
    };

    prototype.animate = animate;
    prototype.getAnimations = function getAnimations(this: Element): RecordedAnimation[] {
        return [...(animationsByElement.get(this) ?? [])];
    };

    return {
        calls: liveCalls,
        forElement(element) {
            return [...(animationsByElement.get(element) ?? [])];
        },
        restore() {
            if (hadAnimate) prototype.animate = originalAnimate;
            else delete prototype.animate;
            if (hadGetAnimations) prototype.getAnimations = originalGetAnimations;
            else delete prototype.getAnimations;
            liveCalls.length = 0;
        },
    };
}

const rects = new WeakMap<Element, StubRect>();

export interface RectStub {
    set(element: Element, rect: StubRect): void;
    restore(): void;
}

const ZERO_RECT: StubRect = { top: 0, left: 0, width: 0, height: 0 };

export function stubRects(): RectStub {
    const prototype = Element.prototype as unknown as Record<string, unknown>;
    const original = prototype.getBoundingClientRect as (() => DOMRect) | undefined;
    prototype.getBoundingClientRect = function getBoundingClientRect(this: Element): DOMRect {
        const rect = rects.get(this) ?? ZERO_RECT;
        return {
            ...rect,
            right: rect.left + rect.width,
            bottom: rect.top + rect.height,
            x: rect.left,
            y: rect.top,
            toJSON: () => ({ ...rect }),
        } as DOMRect;
    };
    return {
        set(element, rect) {
            rects.set(element, rect);
        },
        restore() {
            if (original) prototype.getBoundingClientRect = original;
            else delete prototype.getBoundingClientRect;
        },
    };
}

/** Replaces `window.matchMedia` with one that answers only the reduced-motion query. */
export function stubReducedMotion(reduce: boolean): () => void {
    const original = window.matchMedia;
    const fake = (query: string) =>
        ({
            matches: reduce && query.includes("prefers-reduced-motion"),
            media: query,
            onchange: null,
            addListener() {},
            removeListener() {},
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent: () => false,
        }) as unknown as MediaQueryList;
    Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: fake });
    return () => {
        Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: original });
    };
}

export interface RowSpec {
    id: string;
    top: number;
    height?: number;
    className?: string;
    label?: string;
}

export interface ListFixture {
    container: HTMLElement;
    row(id: string): HTMLElement;
    rows(): HTMLElement[];
    /** Rewrite the DOM to `ids`, then re-measure every row to `index * height`. */
    reorder(ids: readonly string[]): void;
    setRect(id: string, rect: StubRect): void;
    cleanup(): void;
}

/**
 * A bare `<ul>` of `[data-motion-id]` rows. Rows are kept across reorders so a
 * reorder really is a move of the *same* nodes, which is what FLIP depends on.
 */
export function mountList(specs: readonly RowSpec[], rectsStub: RectStub): ListFixture {
    const container = document.createElement("ul");
    const byId = new Map<string, HTMLElement>();
    const defaultHeight = specs[0]?.height ?? 40;

    for (const spec of specs) {
        const row = document.createElement("li");
        row.setAttribute("data-motion-id", spec.id);
        row.id = `row-${spec.id}`;
        row.className = spec.className ?? "row";
        row.textContent = spec.label ?? spec.id;
        byId.set(spec.id, row);
        container.appendChild(row);
        rectsStub.set(row, {
            top: spec.top,
            left: 0,
            width: 300,
            height: spec.height ?? defaultHeight,
        });
    }
    rectsStub.set(container, { top: 0, left: 0, width: 300, height: specs.length * defaultHeight });
    document.body.appendChild(container);

    const rows = (): HTMLElement[] => [...container.querySelectorAll<HTMLElement>("[data-motion-id]")];

    return {
        container,
        row: (id) => {
            const row = byId.get(id);
            if (!row) throw new Error(`unknown row ${id}`);
            return row;
        },
        rows,
        reorder(ids) {
            // Look in the registry first, then in the live DOM, so a test that
            // appended its own row can still reorder through the fixture.
            const find = (id: string): HTMLElement => {
                const known = byId.get(id);
                if (known) return known;
                const live = container.querySelector<HTMLElement>(`[${MOTION_ID}="${id}"]`);
                if (!live) throw new Error(`unknown row ${id}`);
                byId.set(id, live);
                return live;
            };
            for (const id of ids) container.appendChild(find(id));
            ids.forEach((id, index) => {
                rectsStub.set(find(id), {
                    top: index * defaultHeight,
                    left: 0,
                    width: 300,
                    height: defaultHeight,
                });
            });
        },
        setRect(id, rect) {
            const known = byId.get(id);
            if (known) {
                rectsStub.set(known, rect);
                return;
            }
            const live = container.querySelector<HTMLElement>(`[${MOTION_ID}="${id}"]`);
            if (!live) throw new Error(`unknown row ${id}`);
            byId.set(id, live);
            rectsStub.set(live, rect);
        },
        cleanup() {
            container.remove();
        },
    };
}
