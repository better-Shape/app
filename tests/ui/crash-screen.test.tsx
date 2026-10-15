import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The crash screen is the surface a user meets when the product is already failing
 * them, and it used to be the one place in the app that ignored the design system:
 * raw Tailwind reds beside `text-error`, `active:scale-95` at more than three times
 * the intended press depth (`--press-scale` is 0.985), `transition-all`, and two
 * near-identical copies of itself that could drift. These tests hold the three
 * things that matter: it stays on the shared components and tokens, it always offers
 * a way out, and it can produce a report.
 */

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
});

describe("crash screens stay on the design system", () => {
    // These paths are the boundaries Next.js actually mounts. An earlier version of
    // this suite asserted against `components/layout/error/{error,global-error}.tsx`,
    // which nothing imported and Next.js never resolves, a test that passed against
    // dead files while the root layout had no boundary at all.
    it.each(["app/error.tsx", "app/global-error.tsx"])(
        "%s delegates to the shared CrashScreen",
        (file) => {
            const source = read(file);
            expect(source).toContain("@/components/layout/error/crash-screen");
            expect(source).toContain("<CrashScreen");
            // Hand-rolled buttons and raw palette colours must not come back.
            expect(source).not.toMatch(/active:scale-/);
            expect(source).not.toMatch(/transition-all/);
            expect(source).not.toMatch(/(bg|border|text|shadow)-(red|green|blue|rose|amber)-\d{2,3}/);
        },
    );

    it("keeps a root boundary where Next.js looks for it", () => {
        // `global-error` is a route-segment convention: it is only mounted from the root
        // of `app/`. Put it anywhere else and the app silently loses its outermost
        // boundary and falls back to Next.js' unstyled default page.
        const source = read("app/global-error.tsx");
        expect(source).toContain("<html");
        expect(source).toContain("<body");
        // It replaces the root layout, so it must bring the tokens with it.
        expect(source).toContain('import "./globals.css"');
        expect(fs.existsSync(path.join(process.cwd(), "components/layout/error/global-error.tsx"))).toBe(false);
    });

    it("does not restate a second copy of the layout in the shared screen", () => {
        const source = read("components/layout/error/crash-screen.tsx");
        // One screen, shared: the whole point is that the two boundaries cannot drift.
        expect(source).not.toContain("<html");
        expect(source).toContain('from "@/components/ui/button"');
        expect(source).toContain('from "@/lib/feedback/report"');
    });

    it("offers the crash as a report category", () => {
        const source = read("lib/feedback/report.ts");
        expect(source).toMatch(/"Crash",/);
    });
});

describe("CrashScreen", () => {
    async function render(props: {
        onRetry?: () => void;
        onReload?: () => void;
        title?: string;
        hint?: string;
        message?: string;
        digest?: string;
    }) {
        const { CrashScreen } = await import("@/components/layout/error/crash-screen");
        act(() =>
            root.render(
                <CrashScreen
                    title={props.title ?? "Something went wrong"}
                    hint={props.hint ?? "Nothing is lost, and trying again is free."}
                    message={props.message ?? "boom"}
                    digest={props.digest}
                    onRetry={props.onRetry ?? (() => {})}
                    onReload={props.onReload ?? (() => {})}
                />,
            ),
        );
    }

    it("shows the title and the plain-language hint", async () => {
        await render({ title: "BetterShape hit an unexpected error", hint: "Your files on disk are untouched." });
        expect(container.textContent).toContain("BetterShape hit an unexpected error");
        expect(container.textContent).toContain("Your files on disk are untouched.");
    });

    it("keeps the exception off the surface", async () => {
        // Error-state guidance is explicit that codes and stack traces do not belong on
        // the screen: they are written for a developer and are actively alarming to
        // anyone else. The old screen put this in a bordered box above the buttons.
        await render({ message: "TypeError: cannot read properties of null (reading 'x')", digest: "abc123" });
        expect(container.textContent).not.toContain("cannot read properties of null");
        expect(container.textContent).not.toContain("abc123");
        // ... and it is one click away for whoever is actually debugging.
        const toggle = [...container.querySelectorAll("button")].find((b) =>
            b.textContent?.includes("Technical details"),
        );
        expect(toggle).toBeDefined();
        act(() => toggle?.click());
        expect(container.textContent).toContain("cannot read properties of null");
        expect(container.textContent).toContain("abc123");
        expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    });

    it("announces itself and hands the keyboard to the recovery", async () => {
        // An unexpected failure needs to be announced now, not politely queued, and a
        // screen whose whole job is offering recovery must let Enter take it without a
        // Tab first.
        await render({});
        const alert = container.querySelector('[role="alert"]');
        expect(alert).not.toBeNull();
        expect(alert?.getAttribute("aria-live")).toBe("assertive");
        const retry = [...container.querySelectorAll("button")].find((b) =>
            b.textContent?.includes("Try again"),
        );
        expect(document.activeElement).toBe(retry);
    });

    it("offers recovery before anything else", async () => {
        const onRetry = vi.fn();
        await render({ onRetry });
        const buttons = [...container.querySelectorAll("button")];
        expect(buttons[0]?.textContent).toContain("Try again");
        expect(buttons[1]?.textContent).toContain("Reload IDE");
        act(() => buttons[0]?.click());
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("offers a way to report the crash without sending anything", async () => {
        // Reporting is the action that turns a dead end into a fix. It must be present,
        // and it must be honest about what it does.
        await render({});
        const reportButton = [...container.querySelectorAll("button")].find((b) =>
            b.textContent?.includes("Report this crash"),
        );
        expect(reportButton).toBeDefined();
        expect(container.textContent).toMatch(/copies a redacted report/i);
        expect(container.textContent).toMatch(/Nothing is sent until you submit it/i);
    });
});
