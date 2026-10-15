"use client";

import "./globals.css";

import { useEffect } from "react";
import { CrashScreen } from "@/components/layout/error/crash-screen";

/**
 * The root error boundary.
 *
 * This file has to live at the root of `app/`, Next.js only resolves `global-error`
 * as a route-segment convention, so a copy under `components/` is never mounted. Until
 * this file existed there was no root boundary at all and a crash in the root layout
 * fell through to Next.js' built-in unstyled fallback ("This page couldn't load"),
 * which is exactly what `?crash=global` used to show. `components/layout/error/error.tsx`
 * and `components/layout/error/global-error.tsx` were dead files pretending to be
 * boundaries and have been removed.
 *
 * It replaces the root layout, so it owns the document: the `<html>`/`<body>` tags below
 * are mandatory, and the stylesheet import is what gives the screen the app's tokens
 * instead of the browser defaults.
 */
export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error("Global Layout Error Caught:", error);
    }, [error]);

    return (
        <html lang="en" className="dark h-full bg-titlebar text-sm text-text-primary">
            <body className="flex h-full items-center justify-center bg-background p-8 antialiased font-sans">
                <CrashScreen
                    title="BetterShape hit an unexpected error"
                    hint="The interface failed to start. Your files on disk are untouched, and the agent's last saved state reloads with the IDE. Nothing was written over."
                    message={error.message || "A fatal application error occurred in the root layout."}
                    digest={error.digest}
                    stack={error.stack}
                    onRetry={() => reset()}
                    onReload={() => window.location.reload()}
                />
            </body>
        </html>
    );
}
