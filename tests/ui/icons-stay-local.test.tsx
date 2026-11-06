import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrandMark } from "@/components/ui/brand-mark";
import { Favicon } from "@/components/ui/favicon";
import { PluginLogo } from "@/components/ui/plugin-logo";
import { mcpServerBrandCandidates, pluginLogoCandidates } from "@/lib/plugins/logos";
import { PLUGIN_MARKS } from "@/lib/plugins/plugin-marks";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
});

const sources = () => [...host.querySelectorAll("img")].map((img) => img.getAttribute("src") ?? "");

/** Every source file under `dir`, recursively. */
const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) return files(path);
        return /\.(tsx?|css)$/.test(entry) ? [path] : [];
    });

describe("icons draw without asking a server", () => {
    it("names no icon CDN or favicon lookup service anywhere in the app", () => {
        const services = /cdn\.simpleicons\.org|thesvg\.org\/icons|google\.com\/s2\/favicons|icons\.duckduckgo\.com/;
        const offenders = ["app", "components", "features", "lib"]
            .flatMap((dir) => files(join(process.cwd(), dir)))
            .filter((path) => services.test(readFileSync(path, "utf8")))
            .map((path) => path.slice(process.cwd().length + 1));
        expect(offenders).toEqual([]);
    });

    it("gives a plugin its bundled mark, then the catalog's logo, and never a lookup service", () => {
        const github = pluginLogoCandidates("github", true, PLUGIN_MARKS, "https://catalog.example/github.png");
        expect(github).toHaveLength(2);
        expect(github[0]).toMatch(/^data:image\/svg\+xml,/);
        expect(github[1]).toBe("https://catalog.example/github.png");
        // A toolkit key with underscores finds the mark without them.
        expect(pluginLogoCandidates("google_drive", true, PLUGIN_MARKS)[0]).toMatch(/^data:image\/svg\+xml,/);
        // Before the marks load, or for a toolkit the bundle lacks, there is nothing to fetch.
        expect(pluginLogoCandidates("github", true, null)).toEqual([]);
        expect(pluginLogoCandidates("acme_internal", true, PLUGIN_MARKS)).toEqual([]);
    });

    it("gives an MCP server a bundled mark for its name or host, then the MCP mark", () => {
        const known = mcpServerBrandCandidates("Linear", "https://mcp.linear.app/sse", true, PLUGIN_MARKS);
        expect(known[0]).toMatch(/^data:image\/svg\+xml,/);
        expect(known.at(-1)).toBe("/integrations/logos/mcp.svg");
        expect(mcpServerBrandCandidates("acme", "https://tools.acme.dev/mcp", true, PLUGIN_MARKS)).toEqual([
            "/integrations/logos/mcp.svg",
        ]);
    });

    it("draws a plugin it has no mark for as its first letter", async () => {
        await act(async () => root.render(<PluginLogo toolkit="acme_internal" name="Acme" size={24} />));
        expect(sources()).toEqual([]);
        expect(host.textContent).toBe("A");
    });

    it("draws a known plugin's mark once the marks' chunk loads", async () => {
        await act(async () => root.render(<PluginLogo toolkit="github" name="GitHub" size={24} />));
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(sources()).toHaveLength(1);
        expect(sources()[0]).toMatch(/^data:image\/svg\+xml,/);
    });

    it("draws a site mark in the colour its caller asks for, and nothing for an unknown site", () => {
        act(() => root.render(<BrandMark slug="vite" color="646CFF" />));
        expect(decodeURIComponent(sources()[0] ?? "")).toContain('fill="#646CFF"');
        act(() => root.render(<BrandMark slug="nowhere" />));
        expect(host.innerHTML).toBe("");
    });

    it("draws a globe for a site unless the page published its own icon", () => {
        act(() => root.render(<Favicon />));
        expect(sources()).toEqual([]);
        expect(host.querySelector("svg")).not.toBeNull();
        act(() => root.render(<Favicon src="https://example.com/favicon.ico" />));
        expect(sources()).toEqual(["https://example.com/favicon.ico"]);
        act(() => root.render(<Favicon src="javascript:alert(1)" />));
        expect(sources()).toEqual([]);
    });
});
