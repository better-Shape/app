#!/usr/bin/env node
/**
 * Glue audit: measures the four ways a shipped surface can be stranded.
 *
 * 1. Modules no app code imports (a component nothing renders).
 * 2. Event channels with a listener and no dispatcher, or the reverse.
 * 3. Settings keys stored in the schema that no code mentions at all. Limits:
 *    a key mapped through an options object (for example
 *    `getEditorOptionsFromSettings`) reads as used even when the code that
 *    builds the control never applies the mapped value. That second question
 *    needs a reader per consumer, not a grep.
 * 4. Exported names defined in more than one module (drift risk).
 *
 * The counts are the proof: run it before and after a fix and compare.
 * Output: human table on stdout, JSON at .qa-artifacts/glue-audit.json.
 *
 * Run: node scripts/qa/audit-glue.mjs
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = process.cwd();
const CODE_ROOTS = ["app", "components", "features", "lib", "core"];
const IGNORED_DIRS = new Set(["node_modules", ".next", "out", "dist", "build", "coverage", ".qa-artifacts"]);
const ROUTE_FILES = new Set([
    "page.tsx", "layout.tsx", "error.tsx", "global-error.tsx", "not-found.tsx",
    "template.tsx", "default.tsx", "loading.tsx", "route.ts", "route.tsx",
]);

const walk = (dir, out = []) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (/\.[cm]?[jt]sx?$/.test(entry.name)) out.push(full);
    }
    return out;
};

const files = CODE_ROOTS.flatMap((root) => (existsSync(join(ROOT, root)) ? walk(join(ROOT, root)) : []));
// Tests, the e2e suite and the QA scripts are importers too. A module that only
// they import is not app-reachable, but it is not dead either.
const CONSUMER_ROOTS = ["tests", "e2e", "scripts"];
const consumerFiles = CONSUMER_ROOTS.flatMap((root) => (existsSync(join(ROOT, root)) ? walk(join(ROOT, root)) : []));
const isRouteFile = (file) => file.startsWith(join(ROOT, "app")) && ROUTE_FILES.has(file.split("/").pop());

const resolveSpecifier = (fromFile, specifier) => {
    let base;
    if (specifier.startsWith("@/")) base = join(ROOT, specifier.slice(2));
    else if (specifier.startsWith(".")) base = resolve(dirname(fromFile), specifier);
    else return null;
    const candidates = [
        base,
        `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.cts`,
        join(base, "index.ts"), join(base, "index.tsx"),
    ];
    for (const candidate of candidates) {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    return null;
};

const IMPORT_RE = /(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;

const importGraph = new Map();
for (const file of files) {
    const source = readFileSync(file, "utf8");
    const specifiers = new Set();
    for (const match of source.matchAll(IMPORT_RE)) {
        const raw = match[1] ?? match[2] ?? match[3];
        if (raw) specifiers.add(raw);
    }
    importGraph.set(file, [...specifiers]);
}

const imported = new Set();
for (const [file, specifiers] of importGraph) {
    for (const specifier of specifiers) {
        const target = resolveSpecifier(file, specifier);
        if (target && target !== file) imported.add(target);
    }
}

const consumerImported = new Set();
for (const file of consumerFiles) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(IMPORT_RE)) {
        const raw = match[1] ?? match[2] ?? match[3];
        const target = raw ? resolveSpecifier(file, raw) : null;
        if (target) consumerImported.add(target);
    }
}

const orphans = [];
const testOnly = [];
for (const file of files) {
    if (imported.has(file) || isRouteFile(file)) continue;
    (consumerImported.has(file) ? testOnly : orphans).push(relative(ROOT, file));
}
const byName = (a, b) => a.localeCompare(b);
orphans.sort(byName);
testOnly.sort(byName);

// Event channels
const EVENT_LISTEN_RE = /addEventListener\(\s*["']([^"']+)["']/g;
const EVENT_DISPATCH_RE = /new\s+(?:Custom)?Event\(\s*["']([^"']+)["']/g;
const listeners = new Map();
const dispatchers = new Map();
const record = (map, name, file) => {
    if (!map.has(name)) map.set(name, new Set());
    map.get(name).add(relative(ROOT, file));
};
for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(EVENT_LISTEN_RE)) record(listeners, match[1], file);
    for (const match of source.matchAll(EVENT_DISPATCH_RE)) record(dispatchers, match[1], file);
}
const DOM_EVENTS = new Set([
    "click", "dblclick", "keydown", "keyup", "keypress", "pointerdown", "pointerup", "pointermove",
    "pointerenter", "pointerleave", "pointercancel", "mousedown", "mouseup", "mousemove", "mouseenter",
    "mouseleave", "wheel", "scroll", "resize", "focus", "blur", "focusin", "focusout", "input", "change",
    "submit", "paste", "copy", "cut", "drop", "dragover", "dragleave", "dragstart", "dragend", "contextmenu",
    "storage", "hashchange", "popstate", "online", "offline", "beforeunload", "message", "animationend",
    "transitionend", "selectstart", "visibilitychange", "load", "error", "touchstart", "touchmove", "touchend",
]);
const channelName = (name) => /^[a-z][a-z0-9:_-]*$/i.test(name);
const listenerOnly = [...listeners.keys()]
    .filter((name) => !dispatchers.has(name) && !DOM_EVENTS.has(name) && channelName(name))
    .sort(byName)
    .map((name) => ({ name, listeners: [...listeners.get(name)] }));
const dispatchOnly = [...dispatchers.keys()]
    .filter((name) => !listeners.has(name) && !DOM_EVENTS.has(name) && channelName(name))
    .sort(byName)
    .map((name) => ({ name, dispatchers: [...dispatchers.get(name)] }));

// Settings keys with no reader outside the settings system
const storePath = join(ROOT, "lib/settings/store.ts");
const settingsKeys = [];
if (existsSync(storePath)) {
    const store = readFileSync(storePath, "utf8");
    const region = store.slice(store.indexOf("DEFAULT_SETTINGS"), store.indexOf("DEFAULT_SETTINGS") + 6000);
    let section = null;
    for (const line of region.split("\n")) {
        const sectionMatch = /^ {4}(\w+):\s*\{/.exec(line);
        if (sectionMatch) {
            section = sectionMatch[1];
            continue;
        }
        const keyMatch = /^ {8}(\w+):/.exec(line);
        if (section && keyMatch) settingsKeys.push({ section, key: keyMatch[1] });
    }
}
// Three kinds of reader, because they prove different amounts:
//   app     - a surface outside the settings system consumes the key
//   mapping - only the settings layer reads it, e.g. getEditorOptionsFromSettings
//   none    - nothing reads it
// The settings UI itself is never a reader: rendering a key is not consuming it.
const settingsUi = join(ROOT, "features/settings/ui");
const settingsLayer = join(ROOT, "lib/settings");
const withoutDefaults = (source) => {
    const start = source.indexOf("DEFAULT_SETTINGS");
    if (start < 0) return source;
    const end = source.indexOf("};", start);
    return end < 0 ? source : source.slice(0, start) + source.slice(end);
};
const readSources = (predicate) =>
    files.filter(predicate).map((file) => ({ file: relative(ROOT, file), source: withoutDefaults(readFileSync(file, "utf8")) }));
const appSources = readSources((file) => !file.startsWith(settingsUi) && !file.startsWith(settingsLayer));
const mappingSources = readSources((file) => file.startsWith(settingsLayer));
const mentions = (entry, section, key) => {
    const pattern = new RegExp(`\\b${section}\\.${key}\\b`);
    const keyPattern = new RegExp(`\\b${key}\\b`);
    return pattern.test(entry.source) || keyPattern.test(entry.source);
};
const unreadSettings = [];
const mappedOnlySettings = [];
for (const { section, key } of settingsKeys) {
    const name = `${section}.${key}`;
    if (appSources.some((entry) => mentions(entry, section, key))) continue;
    const mappers = mappingSources.filter((entry) => mentions(entry, section, key)).map((entry) => entry.file);
    if (mappers.length > 0) mappedOnlySettings.push({ key: name, mappers });
    else unreadSettings.push(name);
}

// Duplicate exported names
const EXPORT_RE = /export\s+(?:async\s+)?(?:function|const|class|let)\s+([A-Za-z_$][\w$]*)/g;
const exportsByName = new Map();
for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(EXPORT_RE)) {
        const name = match[1];
        if (!exportsByName.has(name)) exportsByName.set(name, new Set());
        exportsByName.get(name).add(relative(ROOT, file));
    }
}
const duplicates = [...exportsByName.entries()]
    .filter(([, owners]) => owners.size > 1)
    .map(([name, owners]) => ({ name, owners: [...owners].sort(byName) }))
    .sort((a, b) => byName(a.name, b.name));

const summary = {
    generatedAt: new Date().toISOString(),
    counts: {
        modules: files.length,
        orphanModules: orphans.length,
        testOnlyModules: testOnly.length,
        listenerOnlyChannels: listenerOnly.length,
        dispatchOnlyChannels: dispatchOnly.length,
        duplicateExports: duplicates.length,
        settingsKeys: settingsKeys.length,
        unreadSettings: unreadSettings.length,
        mappedOnlySettings: mappedOnlySettings.length,
    },
    orphans,
    testOnly,
    listenerOnly,
    dispatchOnly,
    unreadSettings,
    mappedOnlySettings,
    duplicates,
};

mkdirSync(join(ROOT, ".qa-artifacts"), { recursive: true });
writeFileSync(join(ROOT, ".qa-artifacts/glue-audit.json"), `${JSON.stringify(summary, null, 2)}\n`);

console.log(`modules scanned: ${summary.counts.modules}`);
console.log(`\norphan modules (${orphans.length})`);
for (const file of orphans) console.log(`  ${file}`);
console.log(`\ntest-only modules (${testOnly.length})`);
for (const file of testOnly) console.log(`  ${file}`);
console.log(`\nevents: listener only (${listenerOnly.length})`);
for (const channel of listenerOnly) console.log(`  ${channel.name}  <- ${channel.listeners.join(", ")}`);
console.log(`\nevents: dispatch only (${dispatchOnly.length})`);
for (const channel of dispatchOnly) console.log(`  ${channel.name}  <- ${channel.dispatchers.join(", ")}`);
console.log(`\nsettings keys with no reader (${unreadSettings.length})`);
for (const key of unreadSettings) console.log(`  ${key}`);
// These are read only by the settings layer, which maps them into options that
// some surface may or may not consume. The audit cannot see through the mapping,
// so they are listed rather than counted as wired.
console.log(`\nsettings keys read only by the settings layer (${mappedOnlySettings.length})`);
for (const entry of mappedOnlySettings) console.log(`  ${entry.key}  <- ${entry.mappers.join(", ")}`);
console.log(`\nduplicate exported names (${duplicates.length})`);
for (const entry of duplicates) console.log(`  ${entry.name}: ${entry.owners.join(", ")}`);
