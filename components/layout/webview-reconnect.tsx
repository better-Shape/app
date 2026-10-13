"use client";

import React, { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { isTauriRuntime } from "@/lib/window/tauri-window";

/** In-app reconnect when the Next origin / webview document fails. */
export function WebviewReconnect() {
    const [down, setDown] = useState(false);

    useEffect(() => {
        // `listen` resolves asynchronously; if unmount wins the race, drop the subscription
        // as soon as it arrives instead of leaking it.
        let active = true;
        let unlisten: (() => void) | undefined;
        if (isTauriRuntime()) {
            void listen("webview-load-failed", () => setDown(true)).then((fn) => {
                if (active) unlisten = fn;
                else fn();
            });
        }
        return () => {
            active = false;
            unlisten?.();
        };
    }, []);

    if (!down) return null;

    return (
        <div className="absolute inset-0 z-[90] flex flex-col items-center justify-center gap-3 bg-background px-6 text-center">
            <p className="text-base font-medium text-text-primary">Can’t reach the BetterShape UI</p>
            <p className="max-w-sm text-sm text-text-secondary">
                {isTauriRuntime()
                    ? "The local Next.js server stopped. Retry — BetterShape is still running."
                    : "The app server stopped responding."}
            </p>
            <Button type="button" onClick={() => window.location.reload()}>
                Reconnect
            </Button>
        </div>
    );
}
