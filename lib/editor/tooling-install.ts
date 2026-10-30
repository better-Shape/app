import { commands } from "@/lib/backend";
import { getSettings } from "@/lib/settings";
import { notify } from "@/features/notifications";

/** The formatter the editor shells out to through `npx --no-install`. */
const PACKAGE = "prettier";

/**
 * Failures `npx --no-install prettier` produces when the project has no local
 * Prettier. Everything else (a syntax error in the file, a bad config) is a
 * real formatting problem and must not trigger an install.
 */
const MISSING_PATTERNS = [
    "could not determine executable to run",
    "cannot find module 'prettier'",
    "cannot find module \"prettier\"",
    "prettier: not found",
    "not installed",
    "npm error code 404",
];

export function isMissingPrettierFailure(message: string): boolean {
    const text = message.toLowerCase();
    return MISSING_PATTERNS.some((pattern) => text.includes(pattern));
}

/** Projects with an install in flight, so a burst of saves starts one install. */
const installing = new Set<string>();
/** Projects the user has already been offered the install for. */
const offered = new Set<string>();

async function install(projectPath: string): Promise<void> {
    if (!projectPath || installing.has(projectPath)) return;
    installing.add(projectPath);
    try {
        await commands.npmInstall(projectPath, PACKAGE, true);
        notify.success(
            "Prettier installed",
            "The next save formats with the project's own Prettier.",
        );
    } catch (error) {
        notify.error(
            "Prettier could not be installed",
            error instanceof Error ? error.message : String(error),
        );
    } finally {
        installing.delete(projectPath);
    }
}

/**
 * Runs when formatting failed because the project has no Prettier.
 *
 * `workspace.toolingInstall` decides what happens: `auto` installs it as a dev
 * dependency, `prompt` offers the install in a toast, and `off` reports the
 * missing package without touching the project.
 */
export async function offerPrettierInstall(projectPath: string): Promise<void> {
    const mode = getSettings().workspace.toolingInstall;
    if (mode === "auto") {
        await install(projectPath);
        return;
    }
    if (offered.has(projectPath)) return;
    offered.add(projectPath);
    if (mode === "prompt") {
        notify.warn("Prettier is not installed", `${projectPath} has no local Prettier.`, {
            action: { label: "Install", onClick: () => void install(projectPath) },
        });
        return;
    }
    notify.warn(
        "Prettier is not installed",
        `${projectPath} has no local Prettier. Install it with npm install -D prettier.`,
    );
}

/** Clears the once-per-project bookkeeping between tests. */
export function resetToolingInstallForTests(): void {
    installing.clear();
    offered.clear();
}
