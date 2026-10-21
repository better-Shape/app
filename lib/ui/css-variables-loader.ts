import { commands } from "@/lib/backend";
import { setCachedGlobalsCssContent } from "@/lib/ui/css-variables";

/** Common locations for the project's global CSS / design token file. */
export const GLOBALS_CSS_CANDIDATES = [
    "app/globals.css",
    "src/app/globals.css",
    "styles/globals.css",
    "src/styles/globals.css",
    "src/index.css",
    "src/global.css",
    "app/global.css",
    "src/styles/global.css",
    "styles/global.css",
    "src/app/global.css",
    "website/app/globals.css",
    "website/src/app/globals.css",
    "website/src/index.css",
    "shape/app/globals.css",
    "shape/src/app/globals.css",
];

type ResolvedCss = { content: string; path: string | null };
let cache: { projectPath: string; result: ResolvedCss } | null = null;
let activeLoad: { projectPath: string; promise: Promise<ResolvedCss> } | null = null;
let generation = 0;

export async function ensureGlobalsCssLoaded(projectPath: string): Promise<string> {
    return (await resolveGlobalsCss(projectPath)).content;
}

async function discoverGlobalsCss(projectPath: string): Promise<ResolvedCss> {
    const root = projectPath.replace(/(?<![\\/])[\\/]+$/, "");
    for (const relative of GLOBALS_CSS_CANDIDATES) {
        try {
            const path = `${root}/${relative}`.replace(/\\/g, "/");
            const content = await commands.readFile(path);
            return { content, path };
        } catch { /* Try the next candidate. */ }
    }
    return { content: "", path: null };
}

/** Content, source path and project have one owner; display-only CSS grants no file authority. */
export async function resolveGlobalsCss(projectPath: string): Promise<ResolvedCss> {
    if (cache?.projectPath === projectPath) return { ...cache.result };
    if (activeLoad?.projectPath === projectPath) return activeLoad.promise;
    const owner = ++generation;
    cache = null;
    setCachedGlobalsCssContent("");
    const promise = discoverGlobalsCss(projectPath).then(result => {
        if (generation === owner) {
            // Do not cache misses: the user can create a CSS file and retry.
            cache = result.path ? { projectPath, result: { ...result } } : null;
            setCachedGlobalsCssContent(result.content);
        }
        return result;
    }).finally(() => {
        if (generation === owner) activeLoad = null;
    });
    activeLoad = { projectPath, promise };
    return promise;
}

export function updateGlobalsCssCache(projectPath: string, path: string, content: string): void {
    generation += 1;
    activeLoad = null;
    cache = { projectPath, result: { path, content } };
    setCachedGlobalsCssContent(content);
}

/** A late write may invalidate its own project's cache, never a newer project's content or load. */
export function invalidateGlobalsCssCache(projectPath?: string): void {
    if (projectPath !== undefined && cache?.projectPath !== projectPath && activeLoad?.projectPath !== projectPath) return;
    generation += 1;
    cache = null;
    activeLoad = null;
    setCachedGlobalsCssContent("");
}
