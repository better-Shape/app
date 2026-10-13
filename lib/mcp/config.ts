"use client";

import { commands } from "@/lib/backend";
import { serverFromEntry } from "@/lib/mcp/parse";
import type { McpEntryInput } from "@/lib/mcp/parse";
import type { McpServerConfig } from "@/lib/settings";

const DEFAULT_MCP_JSON = `{
  "mcpServers": {
  }
}
`;

export async function getMcpConfigPath(): Promise<string> {
    return commands.getMcpConfigPath();
}

export async function ensureMcpConfigFile(): Promise<string> {
    return commands.ensureMcpConfig();
}

type RawMcpEntry = {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    disabled?: boolean;
    transport?: "stdio" | "http";
    url?: string;
    auth?: "none" | "oauth";
    headers?: Record<string, string>;
    disabledTools?: string[];
    oauthClientId?: string;
};

/** Reads whatever the file holds; `serverFromEntry` decides what is valid. */
export function parseMcpJson(content: string): McpServerConfig[] {
    const parsed = JSON.parse(content) as {
        mcpServers?: Record<string, McpEntryInput>;
    };

    const servers = parsed.mcpServers ?? {};
    return Object.entries(servers).map(([name, cfg]) => serverFromEntry(name, cfg ?? {}));
}

export async function loadMcpServersFromFile(): Promise<McpServerConfig[]> {
    await ensureMcpConfigFile();
    try {
        const content = await commands.readMcpConfig();
        return parseMcpJson(content);
    } catch {
        return [];
    }
}

/** Writes mcp.json only. Servers added in Settings must not be passed here. */
export async function saveMcpServers(servers: McpServerConfig[]): Promise<void> {
    await ensureMcpConfigFile();
    const mcpServers: Record<string, RawMcpEntry> = {};
    for (const s of servers) {
        mcpServers[s.id] = {
            transport: s.transport,
            command: s.command || undefined,
            args: s.args.length ? s.args : undefined,
            env: Object.keys(s.env).length ? s.env : undefined,
            url: s.url,
            auth: s.auth,
            headers: s.headers,
            disabled: !s.enabled,
            disabledTools: s.disabledTools?.length ? s.disabledTools : undefined,
            oauthClientId: s.oauthClientId || undefined,
        };
    }
    // The file can carry a $schema, notes, or other servers' keys. Replace only
    // the mcpServers property so a save from Settings cannot drop them.
    let existing: Record<string, unknown> = {};
    try {
        const raw = await commands.readMcpConfig();
        const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            existing = parsed as Record<string, unknown>;
        }
    } catch {
        /* first write, or unreadable file: start fresh */
    }
    const content = JSON.stringify({ ...existing, mcpServers }, null, 2);
    await commands.writeMcpConfig(content);
}

export async function openMcpConfig(): Promise<void> {
    const path = await ensureMcpConfigFile();
    try {
        await commands.readMcpConfig();
    } catch {
        await commands.writeMcpConfig(DEFAULT_MCP_JSON);
    }
    await commands.openFile(path, "mcp.json");
    window.dispatchEvent(new CustomEvent("shape-agent-overlay", { detail: null }));
    window.dispatchEvent(
        new CustomEvent("shape-open-workspace-file", { detail: { path } }),
    );
    window.dispatchEvent(
        new CustomEvent("shape-layout-toggle", { detail: { id: "agent-workspace", value: true } }),
    );
}

export async function mergePluginConfig(
    pluginId: string,
    config: { mcpServers?: Record<string, McpEntryInput> },
): Promise<McpServerConfig[]> {
    const existing = await loadMcpServersFromFile();
    const incoming = config.mcpServers ?? {};
    const merged = new Map(existing.map((s) => [s.id, s]));
    for (const [id, cfg] of Object.entries(incoming)) {
        merged.set(id, serverFromEntry(id, cfg ?? {}));
    }
    const list = Array.from(merged.values());
    await saveMcpServers(list);
    return list;
}
