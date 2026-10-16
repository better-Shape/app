"use client";

import { CrashScreen } from "@/components/layout/error/crash-screen";

/**
 * The route-level boundary.
 *
 * It renders the same screen the other two boundaries use, so the three cannot drift
 * apart. The comment that used to sit here said the route used to say only "Can't reach
 * this page"; that history is in the commit, and this file only has to say why the screen
 * is shared.
 */
const RouteError = ({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) => {
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
};

export default RouteError;
