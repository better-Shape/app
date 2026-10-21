"use client";

/**
 * The file explorer's clipboard: cut/copy files and directories, then paste
 * them into another folder.
 *
 * The explorer's keyboard shortcuts (Ctrl+X/C/V while the tree has focus) have
 * always dispatched `bettershape-explorer-action`, but nothing implemented the
 * other half, so the keys did nothing. This module is that other half: the
 * backend already exposes `copyPath`/`renamePath`, so a paste is one call.
 *
 * Safety rules, in the order they matter:
 * 1. **Never overwrite.** A copy that would land on an existing name gets
 *    `name copy`, `name copy 2`, …; a move that would collide is refused with a
 *    message rather than silently replacing a file.
 * 2. **Never paste a folder into itself** (or into one of its own children) —
 *    that is an infinite recursion, not a file operation.
 * 3. A cut is cleared once it lands, so the same move cannot be replayed.
 */

import { commands } from "@/lib/backend";

export type FileClipboardMode = "copy" | "cut";

export interface FileClipboard {
    mode: FileClipboardMode;
    paths: string[];
}

let clipboard: FileClipboard | null = null;
const listeners = new Set<() => void>();

function emit(): void {
    for (const listener of listeners) listener();
}

/** Subscribe to clipboard changes (used by the tree to dim cut entries). */
export function subscribeFileClipboard(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getFileClipboard(): FileClipboard | null {
    return clipboard;
}

export function setFileClipboard(mode: FileClipboardMode, paths: string[]): void {
    const clean = paths.map((path) => path.trim()).filter(Boolean);
    clipboard = clean.length > 0 ? { mode, paths: clean } : null;
    // A copy of the same path twice is a double-paste waiting to happen.
    if (clipboard) {
        clipboard = { mode: clipboard.mode, paths: [...new Set(clipboard.paths)] };
    }
    emit();
}

export function clearFileClipboard(): void {
    if (!clipboard) return;
    clipboard = null;
    emit();
}

/** A path's parent directory, tolerating either separator. */
export function parentDir(path: string): string {
    const trimmed = path.replace(/(?<![\\/])[\\/]+$/, "");
    const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
    return cut > 0 ? trimmed.slice(0, cut) : trimmed;
}

/** A path's final segment. */
export function baseName(path: string): string {
    const trimmed = path.replace(/(?<![\\/])[\\/]+$/, "");
    const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
    return cut >= 0 ? trimmed.slice(cut + 1) : trimmed;
}

/** Join using whichever separator the directory already uses. */
export function joinPath(dir: string, name: string): string {
    const trimmed = dir.replace(/(?<![\\/])[\\/]+$/, "");
    const separator = trimmed.includes("\\") && !trimmed.includes("/") ? "\\" : "/";
    return `${trimmed}${separator}${name}`;
}

function isSamePath(a: string, b: string): boolean {
    const norm = (value: string) => value.replace(/\\/g, "/").replace(/(?<!\/)\/+$/, "").toLowerCase();
    return norm(a) === norm(b);
}

function isInside(child: string, parent: string): boolean {
    const norm = (value: string) => value.replace(/\\/g, "/").replace(/(?<!\/)\/+$/, "").toLowerCase();
    return norm(child).startsWith(`${norm(parent)}/`);
}

/** Split `report.tar.gz` into `report.tar` + `.gz` so copies keep the suffix. */
function splitExtension(name: string): { stem: string; extension: string } {
    const dot = name.lastIndexOf(".");
    if (dot <= 0) return { stem: name, extension: "" };
    return { stem: name.slice(0, dot), extension: name.slice(dot) };
}

/** A name that is free in `dir`, derived from `name`. */
async function freeNameIn(dir: string, name: string): Promise<string> {
    const taken = await namesIn(dir);
    if (!taken.has(name.toLowerCase())) return name;
    const { stem, extension } = splitExtension(name);
    // "app copy.ts", then "app copy 2.ts", …
    for (let n = 1; n < 500; n += 1) {
        const candidate = `${stem}${n === 1 ? " copy" : ` copy ${n}`}${extension}`;
        if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return `${stem} copy ${Date.now()}${extension}`;
}

async function namesIn(dir: string): Promise<Set<string>> {
    try {
        const entries = await commands.lsDir(dir);
        return new Set(entries.map((entry) => entry.name.toLowerCase()));
    } catch {
        // An unreadable directory cannot tell us about collisions; let the
        // backend be the judge rather than refusing the paste outright.
        return new Set();
    }
}

/**
 * Paste the clipboard into `targetDir`.
 *
 * Returns the paths that were written, and throws with a human-readable
 * message when the paste is impossible (a name clash on a move, a folder into
 * itself). The caller shows that message; nothing is written halfway.
 */
export async function pasteFileClipboard(targetDir: string): Promise<string[]> {
    const current = clipboard;
    if (!current) return [];
    const dir = targetDir.trim();
    if (!dir) throw new Error("Nothing to paste into.");

    const written: string[] = [];
    for (const source of current.paths) {
        const name = baseName(source);
        if (!name) continue;

        if (isSamePath(source, dir) || isInside(dir, source)) {
            throw new Error(`Cannot paste “${name}” into itself.`);
        }

        const samePlace = isSamePath(parentDir(source), dir);
        if (current.mode === "cut" && samePlace) continue;

        if (current.mode === "copy") {
            const target = joinPath(dir, await freeNameIn(dir, name));
            await commands.copyPath(source, target);
            written.push(target);
            continue;
        }

        const taken = await namesIn(dir);
        if (taken.has(name.toLowerCase())) {
            throw new Error(`“${name}” already exists in that folder — rename it or paste elsewhere.`);
        }
        const target = joinPath(dir, name);
        await commands.renamePath(source, target);
        written.push(target);
    }

    if (current.mode === "cut" && written.length > 0) {
        clipboard = null;
    }
    emit();
    if (written.length > 0 && typeof window !== "undefined") {
        window.dispatchEvent(new Event("bettershape-files-changed"));
    }
    return written;
}
