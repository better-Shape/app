"use client";

/** Open the Graph tab in the agent right workspace (no separate Git Manager overlay). */
export async function openGitWindow(_section?: string) {
    if (typeof window === "undefined") return;

    window.dispatchEvent(new CustomEvent("bettershape-agent-overlay", { detail: null }));
    window.dispatchEvent(
        new CustomEvent("bettershape-layout-toggle", {
            detail: { id: "secondary-sidebar", value: true },
        }),
    );
    window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("bettershape-set-active-tab", { detail: "graph" }));
    }, 80);
}

/** @deprecated Use openGitWindow */
export async function openBranchWindow() {
    return openGitWindow("branches");
}
