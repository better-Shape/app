import { JSON_SCHEMA, load } from "js-yaml";

/** Documentation metadata is YAML data only, never an executable frontmatter engine. */
export function parseFrontmatter(source) {
    const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);
    if (!/^---(?:\s.*|[a-z]+)?$/.test(lines[0])) return { data: {}, content: source };
    if (lines[0].trim() !== "---" && lines[0].trim() !== "---yaml") {
        throw new Error("Only YAML documentation frontmatter is supported.");
    }
    const end = lines.findIndex((line, index) => index > 0 && (line.trim() === "---" || line.trim() === "..."));
    if (end === -1) throw new Error("Unterminated documentation frontmatter.");
    const data = load(lines.slice(1, end).join("\n"), { schema: JSON_SCHEMA }) ?? {};
    if (typeof data !== "object" || Array.isArray(data)) throw new Error("Documentation frontmatter must be a mapping.");
    return { data, content: lines.slice(end + 1).join("\n") };
}
