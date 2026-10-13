import type { McpRegistryEntry } from "@/lib/backend/types";

/**
 * Presentation helpers for registry entries.
 *
 * The registry is a catalogue written by its publishers, so nothing here trusts
 * the entry beyond turning it into a label: the text is shown, never acted on.
 */

/** The part of a reverse-DNS name a person recognises: `io.github.acme/files` → `files`. */
export function registryDisplayName(entry: McpRegistryEntry): string {
    // Last non-empty segment, so a name with a trailing slash still reads as
    // something instead of "io.github.acme/".
    const leaf = entry.name
        .split("/")
        .map((part) => part.trim())
        .filter(Boolean)
        .pop();
    return leaf || "unnamed server";
}

/** What will actually run or be contacted, in one line. */
export function registryTarget(entry: McpRegistryEntry): string {
    const command = entry.command?.trim();
    if (command) {
        return [command, ...entry.args].join(" ").trim();
    }
    const url = entry.url?.trim();
    if (url) {
        return url;
    }
    return "no run command published";
}

/** Whether Shape can install this entry at all, and why not when it cannot. */
export function registryInstallable(entry: McpRegistryEntry): { ok: boolean; reason?: string } {
    if (entry.command?.trim() || entry.url?.trim()) {
        return { ok: true };
    }
    return {
        ok: false,
        reason: entry.repository?.trim()
            ? `No package or URL. Its docs are at ${entry.repository.trim()}.`
            : "No package or URL to run. Configure it from the publisher's docs.",
    };
}

/** Meta line under the name: package, version, and how it is reached. */
export function registrySubtitle(entry: McpRegistryEntry): string {
    const parts: string[] = [];
    if (entry.identifier.trim()) {
        parts.push(entry.identifier.trim());
    }
    if (entry.registryType.trim() && entry.registryType.trim() !== "other") {
        parts.push(entry.registryType.trim());
    }
    if (entry.version.trim()) {
        parts.push(entry.version.trim());
    }
    return parts.join(" · ");
}
