import type { IconModule } from "thesvg";
import { thesvgDataUrl } from "@/lib/brand/thesvg-image";

/** Bundled toolkit marks by toolkit key, as `usePluginMarks` loads them. */
export type PluginMarks = Record<string, IconModule>;

/** The toolkit's mark among `marks`: by its key, or by the key without underscores. */
const markFor = (marks: PluginMarks, toolkit: string): IconModule | undefined => {
    const raw = toolkit.trim().toLowerCase();
    const key = [raw.replaceAll("_", ""), raw].find((candidate) => Object.hasOwn(marks, candidate));
    return key ? marks[key] : undefined;
};

/** A mark's `<img>` source: its dark variant on a dark surface when it has one. */
const markSrc = (mark: IconModule, dark: boolean): string =>
    thesvgDataUrl((dark && mark.variants.dark) || mark.variants.default || mark.svg);

/**
 * The `<img>` sources to try for a toolkit's logo, in order: its bundled mark, then `fallback`, the
 * logo the plugin catalog itself lists, which only the catalog page passes. Nothing here asks a
 * third-party icon service; with no source, callers draw the toolkit's letter.
 */
export function pluginLogoCandidates(
    toolkit: string,
    dark: boolean,
    marks: PluginMarks | null,
    fallback?: string | null,
): string[] {
    const mark = marks ? markFor(marks, toolkit) : undefined;
    const sources = [mark ? markSrc(mark, dark) : null, fallback];
    return [...new Set(sources.filter((src): src is string => Boolean(src)))];
}

export function pluginLetter(name: string): string {
    return name.trim().slice(0, 1).toUpperCase() || "?";
}

/** Meta discovery tools — never force the BetterShape logo in workflow chips. */
export function isBetterShapePluginMeta(_toolkit?: string, _slug?: string): boolean {
    return false;
}

export function humanizePluginActionName(slug: string, name?: string): string {
    const source = slug.includes("_") ? slug : (name || slug);
    const parts = source.split("_").filter(Boolean);
    const words = parts.length > 1 ? parts.slice(1) : parts;
    return words
        .map((w) => {
            const lower = w.toLowerCase();
            if (["id", "url", "api", "http", "sms"].includes(lower)) return lower.toUpperCase();
            return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join(" ")
        .replace(/(?<!\s)\s*\(deprecated\)/i, "")
        .replace(/(?<!\s)\s+Deprecated$/i, "")
        .trim() || slug;
}

/** The `<img>` sources to try for a custom MCP server: a bundled mark for its name or host, then the MCP mark. */
export function mcpServerBrandCandidates(
    name: string,
    url: string | undefined,
    dark: boolean,
    marks: PluginMarks | null,
): string[] {
    const keys: string[] = [];
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (slug) keys.push(slug);
    if (url) {
        try {
            const host = new URL(url).hostname.replace(/^www\./, "");
            const first = host.split(".")[0] ?? host;
            keys.push(first, host);
        } catch {
            /* ignore */
        }
    }
    const out: string[] = [];
    for (const key of keys) {
        out.push(...pluginLogoCandidates(key, dark, marks));
    }
    out.push("/integrations/logos/mcp.svg");
    return [...new Set(out)];
}

export function cleanPluginActionDescription(raw: string): string {
    let s = raw.replace(/\s+/g, " ").trim();
    s = s.replace(/(?<!\s)\s*Args:\s*\{[\s\S]*$/i, "").trim();
    s = s.replace(/\{"type"\s*:\s*"object"[\s\S]*/g, "").trim();
    s = s.replace(/Deprecated\.?\s*/gi, "").trim();
    const cut = s.search(/[.!?]\s/);
    if (cut > 20 && cut < 140) s = s.slice(0, cut + 1);
    if (s.length > 140) s = `${s.slice(0, 137).trim()}…`;
    return s;
}
