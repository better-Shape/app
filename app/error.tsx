"use client";

import { CrashScreen } from "@/components/layout/error/crash-screen";

export default function RouteError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    // The route boundary used to say only "Can't reach this page" and throw the error
    // away. It now renders the same screen as the other two boundaries, so the three
    // cannot drift apart.
    return (
        <CrashScreen
            title="This page hit an error"
            hint="One part of the interface failed to draw. Nothing was saved over. Trying again re-renders just this part, and your project and the agent's work are untouched."
            message={error.message || "The BetterShape UI failed to load."}
            digest={error.digest}
            stack={error.stack}
            onRetry={() => reset()}
            onReload={() => window.location.reload()}
        />
    );
}
