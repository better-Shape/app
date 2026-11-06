"use client";

/** Uploaded families carry this prefix, because an `@font-face` family hides an installed font of the same name. */
const CUSTOM_FAMILY_PREFIX = "BetterShapeCustom-";
/** The tag after an uploaded family's name: a hash of the file, so two files with one name stay apart. */
const CONTENT_TAG = /-[0-9a-f]{8}$/;
const FONT_EXTENSIONS = new Set(["ttf", "otf", "woff", "woff2"]);
const FONT_DB = "bettershape-custom-fonts";
const FONT_TABLE = "uploads";

/** An uploaded font, kept per setting so a reload can register it again. */
export type StoredFont = { slot: string; family: string; data: ArrayBuffer };

/** Where uploads live between sessions. One upload per slot, so a new upload replaces the old one. */
export type CustomFontStore = {
    put: (font: StoredFont) => Promise<void>;
    all: () => Promise<StoredFont[]>;
};

/** The families of a font stack, unquoted. A quoted name runs to its closing quote, commas included. */
const FAMILY_PATTERN = /\s*(?:"([^"]*)"|'([^']*)'|([^,]*))\s*(?:,|$)/g;

/**
 * Splits a font stack into its families. Only one group of each match is set, so joining them reads
 * it. The pattern also matches the empty end of the string, which names no family.
 */
const fontFamilies = (stack: string): string[] =>
    [...stack.matchAll(FAMILY_PATTERN)]
        .filter((match) => match[0] !== "")
        .map((match) => match.slice(1).join("").trim());

/** The uploaded families a font setting names. */
const customFamiliesIn = (value: string): string[] =>
    fontFamilies(value).filter((family) => family.startsWith(CUSTOM_FAMILY_PREFIX));

/** A file's base name in any script, keeping letters, digits, spaces, hyphens and underscores. */
const uploadName = (fileName: string): string =>
    fileName
        .replace(/\.[^.]+$/, "")
        .replaceAll(/[^\p{L}\p{N} _-]+/gu, "")
        .replaceAll(/\s+/g, " ")
        .trim() || "Font";

/** FNV-1a over the file's bytes, as eight hex digits. */
const contentTag = (bytes: Uint8Array): string => {
    let hash = 0x811c9dc5;
    for (const byte of bytes) {
        hash = Math.imul(hash ^ byte, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
};

const openFontDb = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
        const request = indexedDB.open(FONT_DB, 1);
        request.onupgradeneeded = () => {
            request.result.createObjectStore(FONT_TABLE, { keyPath: "slot" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

/** Runs one request in its own transaction and settles when the transaction does. */
const runFontRequest = async <T>(
    mode: IDBTransactionMode,
    request: (table: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
    const db = await openFontDb();
    return new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(FONT_TABLE, mode);
        const pending = request(transaction.objectStore(FONT_TABLE));
        transaction.oncomplete = () => {
            db.close();
            resolve(pending.result);
        };
        transaction.onabort = () => {
            db.close();
            reject(transaction.error ?? pending.error);
        };
    });
};

/** The webview's IndexedDB, which the app keeps in its own data directory. */
const indexedDbFontStore: CustomFontStore = {
    put: (font) => runFontRequest("readwrite", (table) => table.put(font)).then(() => undefined),
    all: () => runFontRequest("readonly", (table) => table.getAll() as IDBRequest<StoredFont[]>),
};

/** The store for this window, or none where IndexedDB is missing, as in a prerender. */
const defaultFontStore = (): CustomFontStore | null =>
    typeof indexedDB === "undefined" ? null : indexedDbFontStore;

const registeredFaces = new Map<string, Promise<void>>();

/** Adds a face to `document.fonts` once per family, so every element and canvas can draw with it. */
const registerFace = (family: string, data: ArrayBuffer): Promise<void> => {
    const known = registeredFaces.get(family);
    if (known) return known;
    const ready = new FontFace(family, data).load().then((face) => {
        document.fonts.add(face);
    });
    registeredFaces.set(family, ready);
    ready.catch(() => registeredFaces.delete(family));
    return ready;
};

/**
 * Registers an uploaded font and keeps it in `slot`, replacing the slot's previous upload. Returns
 * the font stack to store in the setting. Rejects for a file that is not a font.
 */
export async function loadCustomEditorFont(
    file: File,
    slot: string,
    store: CustomFontStore | null = defaultFontStore(),
): Promise<string> {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!FONT_EXTENSIONS.has(ext)) {
        throw new Error("Supported font formats: .ttf, .otf, .woff, .woff2");
    }
    const data = await file.arrayBuffer();
    const family = `${CUSTOM_FAMILY_PREFIX}${uploadName(file.name)}-${contentTag(new Uint8Array(data))}`;
    await registerFace(family, data);
    await store?.put({ slot, family, data }).catch((error: unknown) => {
        console.warn("The uploaded font works until the window reloads; it could not be kept:", error);
    });
    return `'${family}', monospace`;
}

/**
 * Registers the uploads that these font settings name, from the store. Resolves once they can draw,
 * and never rejects: a font that cannot be restored falls back to the rest of its stack.
 */
export async function restoreCustomFonts(
    values: readonly string[],
    store: CustomFontStore | null = defaultFontStore(),
): Promise<void> {
    const wanted = new Set(values.flatMap(customFamiliesIn));
    if (wanted.size === 0 || !store || typeof FontFace === "undefined") return;
    const uploads = await store.all().catch(() => []);
    await Promise.all(
        uploads
            .filter((font) => wanted.has(font.family))
            .map((font) => registerFace(font.family, font.data).catch(() => undefined)),
    );
}

/**
 * The name to show for a font value that matches no preset. It is the first family without quotes,
 * and for an upload without the prefix and tag, so `'BetterShapeCustom-StudioMono-1a2b3c4d',
 * monospace` shows as "StudioMono".
 */
export const customFontLabel = (value: string): string => {
    const [family = ""] = fontFamilies(value);
    const name = family.startsWith(CUSTOM_FAMILY_PREFIX)
        ? family.slice(CUSTOM_FAMILY_PREFIX.length).replace(CONTENT_TAG, "")
        : family;
    return name || value.trim();
};
