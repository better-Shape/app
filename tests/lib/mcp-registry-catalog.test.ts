import { describe, expect, it } from "vitest";
import type { McpRegistryEntry } from "@/lib/backend/types";
import {
    registryDisplayName,
    registryInstallable,
    registrySubtitle,
    registryTarget,
} from "@/lib/mcp/registry-catalog";

function entry(patch: Partial<McpRegistryEntry> = {}): McpRegistryEntry {
    return {
        name: "io.github.acme/files-mcp",
        description: "Files, but for agents.",
        version: "1.2.3",
        registryType: "npm",
        identifier: "@acme/files-mcp",
        transport: "stdio",
        url: null,
        command: "npx",
        args: ["-y", "@acme/files-mcp@1.2.3"],
        repository: null,
        ...patch,
    };
}

describe("mcp-registry-catalog", () => {
    it("shows the leaf of a reverse-DNS name", () => {
        expect(registryDisplayName(entry())).toBe("files-mcp");
        expect(registryDisplayName(entry({ name: "Sentry" }))).toBe("Sentry");
        expect(registryDisplayName(entry({ name: "io.github.acme/" }))).toBe("io.github.acme");
        expect(registryDisplayName(entry({ name: "   " }))).toBe("unnamed server");
    });

    it("shows the exact command a package install will run", () => {
        expect(registryTarget(entry())).toBe("npx -y @acme/files-mcp@1.2.3");
    });

    it("shows the URL for a hosted server", () => {
        const hosted = entry({
            command: null,
            args: [],
            url: "https://mcp.acme.dev/mcp",
        });
        expect(registryTarget(hosted)).toBe("https://mcp.acme.dev/mcp");
    });

    it("refuses an entry with nothing to run, naming the docs when there are any", () => {
        const docsOnly = entry({
            command: null,
            args: [],
            url: null,
            repository: "https://github.com/acme/docs",
        });
        expect(registryTarget(docsOnly)).toBe("no run command published");
        expect(registryInstallable(docsOnly)).toEqual({
            ok: false,
            reason: "No package or URL. Its docs are at https://github.com/acme/docs.",
        });
        expect(registryInstallable(entry()).ok).toBe(true);
    });

    it("lists only the package facts that are there", () => {
        expect(registrySubtitle(entry())).toBe("@acme/files-mcp · npm · 1.2.3");
        expect(registrySubtitle(entry({ registryType: "other", version: "" }))).toBe(
            "@acme/files-mcp",
        );
    });
});
