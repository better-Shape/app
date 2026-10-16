"use client";

/**
 * Preview-only crash trigger, so the error boundaries can be looked at without genuinely
 * breaking the app. `?crash=route` lands on `app/error.tsx`, `?crash=global` on
 * `app/global-error.tsx`.
 *
 * Gated on `NEXT_PUBLIC_BROWSER_PREVIEW`, the same flag the Tauri mock uses. It is inlined
 * at build time, so a packaged release never reaches this code and a stray query parameter
 * cannot crash a real install.
 */
export const PreviewCrash = ({ scope }: { scope: "route" | "global" }) => {
    if (process.env.NEXT_PUBLIC_BROWSER_PREVIEW !== "1") return null;
    if (typeof window === "undefined") return null;

    const requested = new URLSearchParams(window.location.search).get("crash");
    if (requested !== scope) return null;

    // With `?seed=project` the workbench renders before this mount, so open
    // `/?crash=route` with no seed to observe the route trigger.
    throw new Error(
        `Preview crash (${scope}): thrown on purpose so the ${scope} error boundary can be inspected.`,
    );
};
