"use client";

const STYLE_ID = "bettershape-custom-editor-fonts";
/** Uploaded families carry this prefix, because an `@font-face` family hides an installed font of the same name. */
const CUSTOM_FAMILY_PREFIX = "BetterShapeCustom-";
const loadedFamilies = new Set<string>();

function ensureStyleSheet(): HTMLStyleElement {
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
        el = document.createElement("style");
        el.id = STYLE_ID;
        document.head.appendChild(el);
    }
    return el;
}

function formatForExt(ext: string): string {
    switch (ext) {
        case "woff2": return "woff2";
        case "woff": return "woff";
        case "otf": return "opentype";
        case "ttf": return "truetype";
        default: return "truetype";
    }
}

export async function loadCustomEditorFont(file: File): Promise<string> {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["ttf", "otf", "woff", "woff2"].includes(ext)) {
        throw new Error("Supported font formats: .ttf, .otf, .woff, .woff2");
    }

    const family = `${CUSTOM_FAMILY_PREFIX}${file.name.replace(/\.[^.]+$/, "").replaceAll(/\W+/g, "") || "Font"}`;
    if (loadedFamilies.has(family)) {
        return `'${family}', monospace`;
    }

    const buffer = await file.arrayBuffer();
    const blob = new Blob([buffer], { type: file.type || `font/${ext}` });
    const url = URL.createObjectURL(blob);
    const sheet = ensureStyleSheet();
    sheet.appendChild(document.createTextNode(
        `@font-face{font-family:'${family}';src:url('${url}') format('${formatForExt(ext)}');font-display:swap;}`
    ));
    loadedFamilies.add(family);

    try {
        await document.fonts.load(`16px '${family}'`);
    } catch {
        // Font may still render once loaded by the browser
    }

    return `'${family}', monospace`;
}

/** The first family of a font stack. A quoted name runs to its closing quote, commas included; a bare one ends at the first comma. */
const firstFamily = (stack: string): string => {
    const text = stack.trimStart();
    const quote = text.charAt(0);
    const end = quote === '"' || quote === "'" ? text.indexOf(quote, 1) : -1;
    return end > 0 ? text.slice(1, end) : text.split(",")[0];
};

/**
 * The name to show for a font value that matches no preset. It is the first family without quotes or
 * the upload prefix, so `'BetterShapeCustom-StudioMono', monospace` shows as "StudioMono".
 */
export const customFontLabel = (value: string): string => {
    const family = firstFamily(value).trim();
    const name = family.startsWith(CUSTOM_FAMILY_PREFIX) ? family.slice(CUSTOM_FAMILY_PREFIX.length) : family;
    return name || value.trim();
};
