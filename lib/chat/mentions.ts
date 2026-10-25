import { escapeXmlAttr } from "./xml";
import { commands } from "@/lib/backend/commands";
import { listDesignPreviewSessions } from "@/lib/agent-preview/store";
import { hostnameOf } from "@/lib/ui/favicon";
import { lookupMentionToken, registerMentionToken } from "@/lib/chat/mention-registry";
import { getPreviewCurrentUrl } from "@/features/preview/store";
import { DESIGN_TOKEN_MENTIONS, designTokenById } from "@/lib/chat/design-mentions";
import { elementMentionBlock, lookupElementMention } from "@/lib/chat/element-mentions";
import { skillBySlug, skillIdFromName } from "@/lib/chat/skills";
import type { DiscoveredSkill } from "@/lib/chat/discover-skills";
import { resolveDiscoveredSkill, resolveDiscoveredSkillBySource } from "@/lib/chat/skill-index";

export type MentionKind =
    | "file"
    | "folder"
    | "codebase"
    | "selection"
    | "design"
    | "docs"
    | "terminal"
    | "chat"
    | "branch"
    | "browser"
    | "mcp"
    | "plugin"
    | "skill"
    | "element";

export type ChatMention = {
    kind: MentionKind;
    path?: string;
    label: string;
    /** Design concept id when kind === "design"; chat id when kind === "chat" */
    id?: string;
};

/** Resolve `@browser:current` to the Preview panel URL when available. */
export function resolveBrowserMentionPath(path: string | undefined): string | null {
    if (!path || path === "current") {
        return getPreviewCurrentUrl();
    }
    return path;
}

/** Explicit typed tokens + bare paths / design names (no spaces). */
const MENTION_PATTERN =
    /@(?:(file|folder|design|docs|terminal|chat|branch|browser|mcp|plugin|skill|element):([^\s]+)|(codebase|selection)\b|((?:[\w.-]+\/)*[\w.-]+\/?))/g;

/** Normalizes a design preset key into lowercase alphanumeric slug form. */
function normalizeDesignKey(value: string): string {
    return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

/** Slug for typed mention tokens (no spaces; overlay must match textarea). */
export function slugifyMentionLabel(value: string): string {
    return value
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^a-zA-Z0-9._/-]+/g, "")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") || "item";
}

/** Converts a hyphenated or underscored slug into a readable mention label. */
function unslugMentionLabel(value: string): string {
    return value.replace(/-/g, " ").trim() || value;
}

/** Returns the trailing filename segment of a slash-delimited path. */
function pathBasename(path: string): string {
    const norm = path.replace(/\\/g, "/").replace(/(?<!\/)\/+$/, "");
    const parts = norm.split("/").filter(Boolean);
    return parts[parts.length - 1] || path;
}

/** Formats a chat-mention chip label while hiding raw UUID or numeric IDs. */
const formatChatMentionLabel = (mention: ChatMention): string => {
    if (mention.label && mention.label !== mention.path && mention.label !== mention.id) {
        return mention.label;
    }
    const raw = mention.path || mention.id || mention.label || "Chat";
    if (/^[0-9a-f-]{8,}$/i.test(raw) || /^\d+$/.test(raw)) {
        return mention.label && !/^[0-9a-f-]{8,}$/i.test(mention.label) ? mention.label : "Chat";
    }
    return unslugMentionLabel(raw);
};

/** Formats a browser-mention chip label from its target URL or active tab fallback. */
const formatBrowserMentionLabel = (mention: ChatMention): string => {
    const resolved = resolveBrowserMentionPath(mention.path) || mention.path || mention.label || "";
    if (!resolved || resolved === "current") return "Current page";
    return hostnameOf(resolved) || mention.label || "Browser";
};

/** Formats a named slug mention (terminal or branch) using its label or unslugged path. */
const formatNamedSlugMentionLabel = (mention: ChatMention, fallback: string): string =>
    mention.label && mention.label !== mention.path
        ? mention.label
        : unslugMentionLabel(mention.path || fallback);

/** Formats a generic entity mention using label, ID, path, or fallback noun. */
const formatEntityMentionLabel = (mention: ChatMention, fallback: string): string =>
    mention.label || mention.id || mention.path || fallback;

/** Formats a DOM element mention as `<tag>`. */
const formatElementMentionLabel = (mention: ChatMention): string => {
    if (mention.label.startsWith("<")) return mention.label;
    const tag = (mention.id || mention.path || "element").replace(/^element:/, "").replace(/-\d+$/, "");
    return `<${tag}>`;
};

/** Formats a file, folder, or docs mention to its basename. */
const formatPathMentionLabel = (mention: ChatMention): string => {
    if (mention.label && !mention.label.includes("/")) return mention.label;
    return mention.path ? pathBasename(mention.path) : mention.label;
};

const MENTION_LABEL_FORMATTERS: Partial<Record<ChatMention["kind"], (mention: ChatMention) => string>> = {
    codebase: () => "Codebase",
    selection: () => "Selection",
    design: (m) => m.label || m.id || "Design",
    chat: formatChatMentionLabel,
    browser: formatBrowserMentionLabel,
    terminal: (m) => formatNamedSlugMentionLabel(m, "Terminal"),
    branch: (m) => formatNamedSlugMentionLabel(m, "Branch"),
    mcp: (m) => formatEntityMentionLabel(m, "MCP"),
    plugin: (m) => formatEntityMentionLabel(m, "Plugin"),
    skill: (m) => formatEntityMentionLabel(m, "Skill"),
    element: formatElementMentionLabel,
    file: formatPathMentionLabel,
    folder: formatPathMentionLabel,
    docs: formatPathMentionLabel,
};

/** Short chip label for composer / messages (basename, not full path). */
export const mentionDisplayLabel = (mention: ChatMention): string => {
    const formatter = MENTION_LABEL_FORMATTERS[mention.kind];
    if (formatter) return formatter(mention);
    return mention.path ? pathBasename(mention.path) : mention.label;
};

/** Trim trailing slashes. */
const trimTrailingSlashes = (value: string): string => {
    let end = value.length;
    while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
    return end === value.length ? value : value.slice(0, end);
};

/** Is simple relative path. */
const isSimpleRelativePath = (value: string): boolean => {
    if (!value) return false;
    const parts = value.split("/");
    return parts.every((seg) => seg.length > 0 && /^[\w.-]+$/.test(seg));
};

/** Disambiguates basename mention tokens when another path already claimed `shortToken`. */
const disambiguatePathToken = (
    shortToken: string,
    rawPath: string,
    kind: "file" | "folder" | "docs",
): string => {
    const existing = lookupMentionToken(shortToken);
    const normalized = rawPath.replace(/\\/g, "/");
    if (!existing?.path || existing.path.replace(/\\/g, "/") === normalized) {
        return shortToken;
    }
    const cleanRel = trimTrailingSlashes(normalized);
    if (kind === "folder") {
        return isSimpleRelativePath(cleanRel)
            ? `@${cleanRel}/`
            : `@folder:${slugifyMentionLabel(cleanRel)}/`;
    }
    return isSimpleRelativePath(cleanRel)
        ? `@${cleanRel}`
        : `@${kind}:${slugifyMentionLabel(cleanRel)}`;
};

/** Checks whether a path basename can use a bare `@basename` mention token without slugification. */
const canUseBarePathToken = (rawPath: string, cleanBase: string): boolean =>
    !/\s/.test(rawPath) && /^[\w.-]+$/.test(cleanBase);

/** Formats a folder mention token (`@src/` or `@folder:my-dir/`) with collision disambiguation. */
const formatFolderMentionToken = (mention: ChatMention): string => {
    const rawPath = mention.path ?? mention.label;
    const base = pathBasename(rawPath);
    const cleanBase = base.endsWith("/") ? base.slice(0, -1) : base;
    const shortToken = canUseBarePathToken(rawPath, cleanBase)
        ? `@${cleanBase}/`
        : `@folder:${slugifyMentionLabel(cleanBase)}/`;
    return disambiguatePathToken(shortToken, rawPath, "folder");
};

/** Formats a file or docs mention token (`@index.ts` or `@file:my-file`) with collision disambiguation. */
const formatFileOrDocsMentionToken = (mention: ChatMention, kind: "file" | "docs"): string => {
    const rawPath = mention.path ?? mention.label;
    const base = pathBasename(rawPath);
    const shortToken = canUseBarePathToken(rawPath, base)
        ? `@${base}`
        : `@${kind}:${slugifyMentionLabel(base)}`;
    return disambiguatePathToken(shortToken, rawPath, kind);
};

/** Formats a browser mention token (`@browser:localhost:3000` or `@browser:current`). */
const formatBrowserMentionToken = (mention: ChatMention): string => {
    const resolved = resolveBrowserMentionPath(mention.path) || mention.path || "";
    const parsedHost = hostnameOf(resolved);
    if (parsedHost) return `@browser:${parsedHost}`;
    const fallback = !resolved || resolved === "current" ? "current" : slugifyMentionLabel(mention.label || "page");
    return `@browser:${fallback}`;
};

/** Formats a skill mention token using the skill directory/filename or fallback identifier. */
const formatSkillMentionToken = (mention: ChatMention): string => {
    const source = skillMentionSource(mention.path) || mention.id || mention.path;
    return `@skill:${slugifyMentionLabel(source || mention.label || "skill")}`;
};

const MENTION_TOKEN_FORMATTERS: Record<string, (mention: ChatMention) => string> = {
    codebase: () => "@codebase",
    selection: () => "@selection",
    design: (m) => `@${(m.label || m.id || "design").trim().replace(/\s+/g, "-")}`,
    folder: formatFolderMentionToken,
    file: (m) => formatFileOrDocsMentionToken(m, "file"),
    docs: (m) => formatFileOrDocsMentionToken(m, "docs"),
    chat: (m) => `@chat:${slugifyMentionLabel(m.label || "Chat")}`,
    terminal: (m) => `@terminal:${slugifyMentionLabel(m.label || "Terminal")}`,
    branch: (m) => `@branch:${slugifyMentionLabel(m.label || m.path || "main")}`,
    browser: formatBrowserMentionToken,
    mcp: (m) => `@mcp:${slugifyMentionLabel(m.id || m.label || "server")}`,
    plugin: (m) => `@plugin:${slugifyMentionLabel(m.id || m.path || m.label || "plugin")}`,
    skill: formatSkillMentionToken,
    element: (m) => `@${(m.id || "element:element").replace(/^@/, "")}`,
};

/**
 * Insert short tokens into the composer (`@favicon.ico`) and register the full
 * path so send-time resolution still works.
 */
export const formatMentionToken = (mention: ChatMention): string => {
    const format = MENTION_TOKEN_FORMATTERS[mention.kind];
    const token = format ? format(mention) : `@${mention.kind}:${mention.path ?? mention.label}`;
    registerMentionToken(token, {
        ...mention,
        label: mentionDisplayLabel(mention),
    });
    return token;
};

/** Resolves an `@design:...` mention token against built-in design presets. */
function resolveDesignMention(token: string): ChatMention | null {
    const key = normalizeDesignKey(token);
    const tokenHit = designTokenById(key) ?? DESIGN_TOKEN_MENTIONS.find((t) => normalizeDesignKey(t.label) === key);
    if (tokenHit) {
        return {
            kind: "design",
            id: tokenHit.id,
            path: tokenHit.id,
            label: tokenHit.label,
        };
    }
    const sessions = listDesignPreviewSessions();
    for (const session of sessions) {
        for (const item of session.items) {
            const id = item.id || "";
            const nameKey = normalizeDesignKey(item.name || "");
            if (key === normalizeDesignKey(id) || key === nameKey) {
                return {
                    kind: "design",
                    id: item.id,
                    path: item.path,
                    label: item.name || item.id,
                };
            }
        }
    }
    return null;
}

/** Computes the display chip label for a typed `@kind:target` mention. */
function labelForTypedMention(kind: MentionKind, path: string): string {
    if (kind === "chat") return unslugMentionLabel(path);
    if (kind === "browser") return hostnameOf(path) || path;
    if (kind === "terminal") return unslugMentionLabel(path);
    if (kind === "branch") return unslugMentionLabel(path);
    if (kind === "mcp") return unslugMentionLabel(path);
    if (kind === "plugin") return unslugMentionLabel(path);
    if (kind === "skill") return unslugMentionLabel(path);
    if (kind === "element") return `<${path.replace(/-\d+$/, "")}>`;
    return path;
}

/** Extracts structured `@` mention tokens from a composer prompt string. */
export function parseMentionTokens(text: string): ChatMention[] {
    const mentions: ChatMention[] = [];
    let match: RegExpExecArray | null;
    const re = new RegExp(MENTION_PATTERN.source, "g");
    while ((match = re.exec(text)) !== null) {
        const rawToken = match[0];
        const registered = lookupMentionToken(rawToken);
        if (registered?.kind) {
            mentions.push({
                kind: registered.kind as MentionKind,
                path: registered.path,
                label: registered.label,
                id: registered.id,
            });
            continue;
        }

        if (match[3]) {
            const kind = match[3] as MentionKind;
            mentions.push({
                kind,
                label: kind === "codebase" ? "Codebase" : "Selection",
            });
            continue;
        }

        if (match[1] && match[2]) {
            const kind = match[1] as MentionKind;
            const path = match[2];
            if (kind === "design") {
                const resolved = resolveDesignMention(path);
                mentions.push(
                    resolved ?? {
                        kind: "design",
                        id: path,
                        path,
                        label: path.replace(/-/g, " "),
                    },
                );
                continue;
            }
            mentions.push({
                kind,
                path,
                id: kind === "chat" || kind === "plugin" || kind === "skill" ? path : kind === "element" ? `element:${path}` : undefined,
                label: labelForTypedMention(kind, path),
            });
            continue;
        }

        const bare = match[4];
        if (!bare) continue;
        if (bare === "codebase" || bare === "selection") continue;

        const design = resolveDesignMention(bare);
        if (design) {
            mentions.push(design);
            continue;
        }

        // Basename-only token: keep label short; path may be resolved via registry above.
        const isFolder = bare.endsWith("/");
        const clean = bare.replace(/\/$/, "") || bare;
        mentions.push({
            kind: isFolder ? "folder" : "file",
            path: clean,
            label: pathBasename(clean),
        });
    }
    return mentions;
}

/** Ranges of @mentions in the composer for highlight overlays. */
export function mentionRanges(
    text: string,
): { start: number; end: number; mention: ChatMention }[] {
    const ranges: { start: number; end: number; mention: ChatMention }[] = [];
    const re = new RegExp(MENTION_PATTERN.source, "g");
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
        const token = match[0];
        const parsed = parseMentionTokens(token);
        if (!parsed[0]) continue;
        ranges.push({
            start: match.index,
            end: match.index + token.length,
            mention: parsed[0],
        });
    }
    return ranges;
}

/** Removes raw `@` mention syntax tokens from display text while preserving prose. */
export function stripMentionTokens(text: string): string {
    return text.replace(MENTION_PATTERN, "").replace(/\s+/g, " ").trim();
}

/**
 * Collapse long `@path/to/file` tokens to `@file` while registering the full path
 * for send-time resolution. Safe to run on every keystroke.
 */
export function shortenMentionTokensInText(text: string): string {
    const re = new RegExp(MENTION_PATTERN.source, "g");
    return text.replace(re, (token) => {
        const parsed = parseMentionTokens(token)[0];
        if (!parsed) return token;
        if (
            parsed.kind !== "file" &&
            parsed.kind !== "docs" &&
            parsed.kind !== "folder"
        ) {
            return token;
        }
        const fullPath = (parsed.path || token.replace(/^@/, "")).replace(/\/$/, "");
        if (!fullPath.includes("/")) return token;
        const short = formatMentionToken({
            ...parsed,
            path: parsed.kind === "folder" ? `${fullPath}/` : fullPath,
            label: pathBasename(fullPath),
        });
        return short;
    });
}

export type SelectionSnapshot = {
    path: string;
    startLine: number;
    endLine: number;
    text: string;
};

/** Formats an active editor code selection into an XML context block. */
function selectionMentionBlock(selection: SelectionSnapshot): string | null {
    const text = selection.text?.trim();
    if (!text) return null;
    const range =
        selection.startLine === selection.endLine
            ? `${selection.startLine}`
            : `${selection.startLine}-${selection.endLine}`;
    return `<mention_context type="selection" path="${escapeXmlAttr(selection.path || "")}" range="${range}">\n${text}\n</mention_context>`;
}

/** Detect design concept names written in plain prose (no @ required). */
export function findDesignMentionsInProse(text: string): ChatMention[] {
  const resolved = resolveDesignSelectionFromProse(text);
  return resolved ? [resolved] : [];
}

/**
 * Resolve an explicit design pick from user prose.
 * Prefers "make/go with/pick X" and "option N" over incidental name mentions
 * (e.g. complaining about Field Radar while asking for Operator Ledger).
 */
export function resolveDesignSelectionFromProse(text: string): ChatMention | null {
  const sessions = listDesignPreviewSessions();
  if (sessions.length === 0) return null;

  const items = sessions.flatMap((s) =>
    s.items.map((item) => ({
      sessionId: s.id,
      item,
      selectedId: s.selectedId,
    })),
  );
  if (items.length === 0) return null;

  const matchItem = (raw: string): ChatMention | null => {
    const needle = normalizeDesignKey(raw);
    if (needle.length < 2) return null;
    const ranked = [...items].sort(
      (a, b) => (b.item.name?.length ?? 0) - (a.item.name?.length ?? 0),
    );
    for (const row of ranked) {
      const name = row.item.name?.trim();
      if (!name) continue;
      const nk = normalizeDesignKey(name);
      if (nk === needle || nk.startsWith(needle) || needle.startsWith(nk)) {
        return {
          kind: "design",
          id: row.item.id,
          path: row.item.path,
          label: row.item.name,
        };
      }
    }
    return null;
  };

  const explicit =
    /\b(?:go with|pick|choose|select|make|use|build)\s+(?:the\s+)?(?:option\s*)?#?(\d+)\b/i.exec(text) ||
    /\b(?:option|design|concept)\s*#?\s*(\d+)\b/i.exec(text);
  if (explicit) {
    const n = Number.parseInt(explicit[1], 10);
    // Prefer the most recent session's items for numbered picks.
    const latest = sessions[sessions.length - 1];
    const hit = latest?.items[n - 1];
    if (hit && n >= 1) {
      return {
        kind: "design",
        id: hit.id,
        path: hit.path,
        label: hit.name,
      };
    }
  }

  const named =
    /\b(?:go with|pick|choose|select|make|use|build)\s+(?:the\s+)?([A-Za-z][\w\s-]{1,48}?)(?:[.!?,]|$)/i.exec(
      text,
    );
  if (named) {
    const hit = matchItem(named[1]);
    if (hit) return hit;
  }

  // Exact whole-name mention as a short message ("Operator Ledger", "1")
  const trimmed = text.trim();
  if (trimmed.length <= 60) {
    const asNumber = /^(\d+)$/.exec(trimmed);
    if (asNumber) {
      const n = Number.parseInt(asNumber[1], 10);
      const latest = sessions[sessions.length - 1];
      const hit = latest?.items[n - 1];
      if (hit) {
        return {
          kind: "design",
          id: hit.id,
          path: hit.path,
          label: hit.name,
        };
      }
    }
    const hit = matchItem(trimmed);
    if (hit) return hit;
  }

  return null;
}

/** A discovery path (`…/SKILL.md`, `~/…`), not a skill slug. */
function skillMentionSource(path: string | undefined): string | null {
    const value = path?.trim();
    if (!value) return null;
    if (value.includes("/") || value.includes("\\") || value.startsWith("~")) return value;
    return null;
}

/** Formats a discovered workspace skill file into an XML prompt instruction block. */
function skillMentionBlock(onDisk: DiscoveredSkill): string {
    const attributes = [
        `type="skill"`,
        `id="${escapeXmlAttr(skillIdFromName(onDisk.name))}"`,
        `name="${escapeXmlAttr(onDisk.name)}"`,
        `source="${escapeXmlAttr(onDisk.relPath)}"`,
    ];
    if (onDisk.description) attributes.push(`description="${escapeXmlAttr(onDisk.description)}"`);
    const folderNote =
        onDisk.scope === "project"
            ? ""
            : `\nThe skill folder is ${onDisk.folder} — resolve any relative paths in this skill against it.`;
    return `<mention_context ${attributes.join(" ")}>Follow this skill for the rest of the turn.${folderNote}\n${onDisk.body}\n</mention_context>`;
}

/** Reads and formats the underlying file, folder, symbol, or URL content for a mention. */
async function readMentionContext(
    mention: ChatMention,
    projectPath: string | null,
): Promise<string | null> {
    if (mention.kind === "skill") {
        const slug = mention.id || mention.label;
        const source = skillMentionSource(mention.path);
        // A picker row stores the file path. That file wins over another skill
        // that happens to share the slug.
        if (source) {
            const picked = await resolveDiscoveredSkillBySource(source);
            if (picked) return skillMentionBlock(picked);
        }

        const installed = skillBySlug(slug || mention.path || "");
        if (installed) {
            return `<mention_context type="skill" id="${escapeXmlAttr(installed.id)}" name="${escapeXmlAttr(installed.name)}">Follow this skill for the rest of the turn.\n${installed.body}\n</mention_context>`;
        }

        // Typed `@skill:name` with no file: library first, then the
        // highest-precedence file on disk.
        const onDisk = await resolveDiscoveredSkill(skillIdFromName(slug || mention.path || ""));
        if (!onDisk) {
            const missing = slug || mention.path || mention.label || "skill";
            return `<mention_context type="skill" id="${escapeXmlAttr(missing)}">The user referenced a skill that is not installed.</mention_context>`;
        }
        return skillMentionBlock(onDisk);
    }

    if (mention.kind === "codebase") {
        if (!projectPath) return null;
        return '<mention_context type="codebase">Search the codebase for files and symbols relevant to the user request.</mention_context>';
    }

    if (mention.kind === "selection") {
        return null;
    }

    if (mention.kind === "element") {
        const key = mention.id || `element:${mention.path || ""}`;
        const el = lookupElementMention(key);
        if (el) return elementMentionBlock(key, el);
        return `<mention_context type="element" selector="${escapeXmlAttr(mention.path || "")}">The user referenced the page element ${escapeXmlAttr(mentionDisplayLabel(mention))}${mention.path ? ` (${escapeXmlAttr(mention.path)})` : ""} from the Browser tab.</mention_context>`;
    }

    if (mention.kind === "design") {
        const tokenHit = designTokenById(mention.id || mention.path || mention.label);
        if (tokenHit) {
            return `<mention_context type="design-token" id="${escapeXmlAttr(tokenHit.id)}">${escapeXmlAttr(tokenHit.prompt)}</mention_context>`;
        }
        const resolved =
            resolveDesignMention(mention.id || mention.label || mention.path || "") ??
            mention;
        const id = resolved.id ?? resolved.path ?? resolved.label;
        return `<mention_context type="design" id="${escapeXmlAttr(id)}" name="${escapeXmlAttr(resolved.label || id)}">The user referenced design concept "${escapeXmlAttr(resolved.label || id)}" (id=${escapeXmlAttr(id)}). Prefer this concept for subsequent design and implementation work. If they are choosing among previews, treat this as their selection.</mention_context>`;
    }

    if (
        mention.kind === "docs" ||
        mention.kind === "terminal" ||
        mention.kind === "chat" ||
        mention.kind === "branch" ||
        mention.kind === "browser" ||
        mention.kind === "mcp" ||
        mention.kind === "plugin"
    ) {
        const path = mention.path ?? mention.label;
        const label = mentionDisplayLabel(mention);
        if (mention.kind === "browser") {
            const resolved = resolveBrowserMentionPath(path);
            if (resolved) {
                const isLocal =
                    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?/i.test(resolved);
                return `<mention_context type="browser" path="${escapeXmlAttr(resolved)}" label="${escapeXmlAttr(hostnameOf(resolved) || resolved)}">The user referenced the ${isLocal ? "local preview page" : "website"} ${escapeXmlAttr(hostnameOf(resolved) || resolved)} (${escapeXmlAttr(resolved)}). ${isLocal ? "This is the URL currently open in the BetterShape Preview panel." : "Use the visit_url tool to fetch its content and styling if you need to recreate or reference it."}</mention_context>`;
            }
            if (path && path !== "current") {
                return `<mention_context type="browser" path="${escapeXmlAttr(path)}" label="${escapeXmlAttr(label)}">The user referenced the website ${escapeXmlAttr(label)} (${escapeXmlAttr(path)}). Use the visit_url tool to fetch its content and styling if you need to recreate or reference it.</mention_context>`;
            }
            return `<mention_context type="browser" path="current" label="Current page">The user referenced the Preview panel current page, but no local preview URL is loaded yet. Ask them for the localhost URL or open Preview.</mention_context>`;
        }
        if (mention.kind === "chat") {
            return `<mention_context type="chat" path="${escapeXmlAttr(path)}" label="${escapeXmlAttr(label)}">The user referenced a past chat titled "${escapeXmlAttr(label)}".</mention_context>`;
        }
        if (mention.kind === "mcp") {
            const id = mention.id || path;
            return `<mention_context type="mcp" id="${escapeXmlAttr(id)}" label="${escapeXmlAttr(label)}">The user referenced the connected MCP server "${escapeXmlAttr(label)}" (id=${escapeXmlAttr(id)}). Prefer tools from this server when relevant.</mention_context>`;
        }
        if (mention.kind === "plugin") {
            const toolkit = mention.id || path;
            return `<mention_context type="plugin" toolkit="${escapeXmlAttr(toolkit)}" label="${escapeXmlAttr(label)}">The user referenced the BetterShape plugin "${escapeXmlAttr(label)}" (toolkit=${escapeXmlAttr(toolkit)}). Prefer plugin_run / plugin tools for this app when relevant.</mention_context>`;
        }
        return `<mention_context type="${mention.kind}" path="${escapeXmlAttr(path)}" label="${escapeXmlAttr(label)}">${escapeXmlAttr(label)}</mention_context>`;
    }

    if (!projectPath) return null;

    const sep = projectPath.includes("\\") ? "\\" : "/";
    const rel = mention.path?.replace(/\//g, sep) ?? "";
    const fullPath = `${projectPath.replace(/(?<![\\/])[\\/]+$/, "")}${sep}${rel}`;

    if (mention.kind === "folder") {
        try {
            const entries = await commands.lsDir(fullPath);
            const listing = entries
                .slice(0, 80)
                .map((e) => `${e.is_dir ? "[dir]" : "[file]"} ${e.name}`)
                .join("\n");
            return `<mention_context type="folder" path="${mention.path}">\n${listing}\n</mention_context>`;
        } catch {
            return null;
        }
    }

    if (isBinaryMentionPath(mention.path || rel)) {
        return `<mention_context type="file" path="${mention.path}" binary="true">Binary file referenced at ${mention.path}. Do not dump its contents. Use the path if the user asks to apply or copy it.</mention_context>`;
    }

    try {
        const content = await commands.readFile(fullPath);
        if (looksLikeBinaryText(content)) {
            return `<mention_context type="file" path="${mention.path}" binary="true">Binary file referenced at ${mention.path}. Do not dump its contents. Use the path if the user asks to apply or copy it.</mention_context>`;
        }
        const trimmed = content.length > 4000 ? `${content.slice(0, 4000)}\n…(truncated)` : content;
        return `<mention_context type="file" path="${mention.path}">\n${trimmed}\n</mention_context>`;
    } catch {
        return null;
    }
}

const BINARY_MENTION_EXT = new Set([
    "woff", "woff2", "ttf", "otf", "eot", "ico", "icns", "pdf", "zip", "gz", "7z",
    "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "psd", "exe", "dll", "so",
    "dylib", "wasm", "mp3", "mp4", "wav", "ogg", "mov", "webm",
]);

/** Checks whether a path has a known binary or media file extension. */
function isBinaryMentionPath(path: string): boolean {
    const ext = path.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase() ?? "";
    return BINARY_MENTION_EXT.has(ext);
}

/** Detects null bytes or high control-character ratios indicating binary content. */
function looksLikeBinaryText(content: string): boolean {
    if (content.includes("\0")) return true;
    const n = Math.min(content.length, 800);
    if (n < 24) return false;
    let bad = 0;
    for (let i = 0; i < n; i++) {
        const c = content.charCodeAt(i);
        if (c === 0xfffd || c < 9 || (c > 13 && c < 32)) bad += 1;
    }
    return bad / n > 0.08;
}

/** Expands composer `@` mentions into grounded context blocks attached to the user prompt. */
export async function buildMessageWithMentions(
    text: string,
    projectPath: string | null,
    selectionContext?: SelectionSnapshot | null,
): Promise<string> {
    const mentions = parseMentionTokens(text);

    const body = stripMentionTokens(text);
    const blocks: string[] = [];

    for (const mention of mentions) {
        if (mention.kind === "selection") {
            const block = selectionContext ? selectionMentionBlock(selectionContext) : null;
            if (block) blocks.push(block);
            continue;
        }
        const block = await readMentionContext(mention, projectPath);
        if (block) blocks.push(block);
    }

    if (blocks.length === 0) return body;
    if (!body) return blocks.join("\n\n");
    return `${blocks.join("\n\n")}\n\n${body}`;
}
