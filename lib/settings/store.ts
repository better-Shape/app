"use client";

import { useSyncExternalStore } from "react";
import { mergeSettingsHydration, mergeSettingsOverlay, projectSettingsOverlay } from "./hydration";
import { getUnsavedCredentialCount, stageCredentialDrafts } from "@/lib/ai/credential-drafts";
import { isWindows } from "@/lib/platform";
import { normalizeColorTheme, type ColorThemeId } from "./themes";
import type { AgentWorkflow } from "@/lib/chat/workflows";
import {
    defaultProvidersSettings,
    credentialScopes,
    mergeProviderConnections,
    normalizeProvidersSettings,
    parseHeaderSecretId,
    providerSecrets,
    redactProviderSecrets,
    type ProvidersSettings,
} from "@/lib/ai/providers";

export type WordWrapSetting = "off" | "on" | "bounded";
export type AutoSaveSetting = "off" | "afterDelay" | "onFocusChange";
export type LineNumbersSetting = "on" | "off" | "relative";
export type RenderWhitespaceSetting = "none" | "selection" | "all";
export type CursorStyleSetting = "line" | "block" | "underline";
export type DefaultShellSetting = "auto" | "powershell" | "cmd" | "git-bash";
export type UpdateChannel = "stable" | "nightly";

/** Map legacy channel names onto Nightly. Anything else stays Stable. */
export function normalizeUpdateChannel(value: unknown): UpdateChannel {
    if (value === "nightly" || value === "pre" || value === "preview" || value === "prerelease") {
        return "nightly";
    }
    return "stable";
}
export type ColorThemeSetting = ColorThemeId;
export type MotionPreferenceSetting = "system" | "reduced";

export function normalizeMotionPreference(value: unknown): MotionPreferenceSetting {
    return value === "reduced" ? "reduced" : "system";
}
/** How agent terminal commands are approved: ask for everything, safe-list
 * auto-runs (default), or run everything except hard-blocked commands. */
export type AutoRunModeSetting = "ask" | "auto" | "always";

export interface McpServerConfig {
    id: string;
    name: string;
    transport: "stdio" | "http";
    command: string;
    args: string[];
    env: Record<string, string>;
    url?: string;
    auth: "none" | "oauth";
    /** Extra HTTP headers (API keys, tenant ids). Never logged. */
    headers?: Record<string, string>;
    enabled: boolean;
    /** Tool names from this server that should not be exposed to the agent. */
    disabledTools?: string[];
    /** Pre-registered OAuth client id when the auth server has no DCR. */
    oauthClientId?: string;
}

export interface BetterShapeSettings {
    editor: {
        fontFamily: string;
        fontSize: number;
        tabSize: number;
        insertSpaces: boolean;
        wordWrap: WordWrapSetting;
        minimap: boolean;
        lineNumbers: LineNumbersSetting;
        renderWhitespace: RenderWhitespaceSetting;
        bracketPairColorization: boolean;
        formatOnSave: boolean;
        autoSave: AutoSaveSetting;
        autoSaveDelay: number;
        trimTrailingWhitespace: boolean;
        insertFinalNewline: boolean;
        detectIndentation: boolean;
        fontLigatures: boolean;
        cursorStyle: CursorStyleSetting;
        cursorBlinking: string;
        smoothScrolling: boolean;
        scrollBeyondLastLine: boolean;
        renderLineHighlight: "none" | "gutter" | "line" | "all";
        showIndentGuides: boolean;
        showBracketGuides: boolean;
        imagePreview: boolean;
        compactTabs: boolean;
    };
    terminal: {
        defaultShell: DefaultShellSetting;
        fontFamily: string;
        fontSize: number;
        scrollback: number;
        copyOnSelect: boolean;
    };
    voice: {
        /** `"default"` or a MediaDeviceInfo.deviceId from the microphone list. */
        deviceId: string;
    };
    git: {
        autoFetch: boolean;
        autoFetchInterval: number;
        confirmBeforeCommit: boolean;
        /** Show GitHub author avatars on multi-lane git graph branches. */
        graphAvatars: boolean;
        /** When true, Git Graph uses `git log --all`. When false, only the current branch. */
        graphShowAllBranches: boolean;
        blame: {
            enabled: boolean;
        };
    };
    ai: {
        maxContextLines: number;
        autoApplyEdits: boolean;
        enabledModels: string[];
        defaultModel: string;
        /** BYOK connections, default model, embeddings and service keys. */
        providers: ProvidersSettings;
        /** Models subagents may use. Never inherit the parent chat model. Empty means Auto only. */
        subagentModels: string[];
        /** Used when spawn_subagent omits model or the requested id is not allowed. */
        subagentDefaultModel: string;
        /** @deprecated Folded into customRules on load. Kept for storage compat. */
        customSystemPrompt: string;
        customRules: string;
        /** Standing instructions for compaction — what every summary must keep. */
        compactInstructions: string;
        mcpServers: McpServerConfig[];
        reviewAdversarialEnabled: boolean;
        /** Trigger phrase → prompt (+ optional plugin tool) injected on send. */
        workflows: AgentWorkflow[];
        /** Ask before the first Multiwork send. */
        multiworkConfirm: boolean;
        /** Show agent cards on the composer during Multiwork. */
        multiworkShowChips: boolean;
        /** Terminal command approval mode (Cursor-style run modes). */
        autoRunMode: AutoRunModeSetting;
        /** Stage agent file edits for approval before they touch disk. */
        requireEditApproval: boolean;
        /** Destructive git commands always ask, even in "run everything". */
        protectDestructiveGit: boolean;
        /** Default plugin action approval (safest: ask every time). */
        pluginApprovalDefault: AutoRunModeSetting;
        /** Per-plugin override of pluginApprovalDefault. */
        pluginApprovals: Record<string, AutoRunModeSetting>;
        /** Tool slugs the agent must not call, keyed by toolkit. */
        pluginDisabledActions: Record<string, string[]>;
        /** Semantic embeddings for codebase search (BM25 always on). */
        indexEmbeddings: boolean;
        /**
         * When on, the agent can call tools to look up past chats in this project.
         * Off by default — memories are never injected into every prompt.
         */
        chatMemoryEnabled: boolean;
    };
    files: {
        exclude: string;
        defaultEol: "LF" | "CRLF";
    };
    eslint: {
        enable: boolean;
        fixOnSave: boolean;
    };
    prettier: {
        enable: boolean;
    };
    lsp: {
        typescript: boolean;
        css: boolean;
        html: boolean;
        json: boolean;
        tailwindcss: boolean;
        emmet: boolean;
    };
    node: {
        interpreterPath: string;
        packageManager: "auto" | "npm" | "yarn" | "pnpm" | "bun";
        codingAssistance: boolean;
    };
    python: {
        /** Absolute path, or `"auto"` to discover from PATH / venv. */
        interpreterPath: string;
    };
    designAutocomplete: {
        enable: boolean;
    };
    designDiagnostics: {
        enable: boolean;
        level: "AA" | "AAA";
    };
    tailwindControls: {
        enable: boolean;
        /** Alt+drag / hover-wheel scrubbing on numeric design tokens */
        numberScrubbing: boolean;
        /** Open flex/gap/padding panel when cursor rests on a token */
        cursorBindPanel: boolean;
        /** Dashed underline on scrubbable numbers */
        scrubDecorations: boolean;
        /** Wheel over padding/gap inputs changes values (Figma-style) */
        wheelOnInputs: boolean;
    };
    designBlame: {
        enable: boolean;
    };
    spacingRefactor: {
        enable: boolean;
    };
    developer: {
        enableDevTools: boolean;
    };
    privacy: {
        showLoginPromptOnLaunch: boolean;
        /** Show the welcome page when the main window opens with no editor. */
        showWelcomeOnStartup: boolean;
        /** Skip the confirm dialog when restoring a chat checkpoint (rolls back file edits). */
        skipCheckpointRestoreConfirm: boolean;
    };
    notifications: {
        /** Master switch for OS/desktop notifications. On by default. */
        desktopEnabled: boolean;
        onGenerationComplete: boolean;
        onApprovalRequired: boolean;
    };
    workspace: {
        /** @deprecated Kept for settings merge compat; package suggestions were removed. */
        toolingInstall: "prompt" | "auto" | "off";
    };
    updates: {
        /** Poll for updates automatically. */
        autoUpdate: boolean;
        /** Stable = latest GitHub release. Nightly = latest GitHub prerelease. */
        channel: UpdateChannel;
    };
    appearance: {
        /** Color theme. */
        colorTheme: ColorThemeSetting;
        motionPreference: MotionPreferenceSetting;
    };
    skills: {
        /** Extra folders scanned for skill files, in the order the user added them. */
        folders: string[];
    };
}

export const DEFAULT_SETTINGS: BetterShapeSettings = {
    skills: {
        folders: [],
    },
    editor: {
        fontFamily: "'IBM Plex Mono', 'Cascadia Code', Consolas, monospace",
        fontSize: 14,
        tabSize: 4,
        insertSpaces: true,
        wordWrap: "off",
        minimap: false,
        lineNumbers: "on",
        renderWhitespace: "selection",
        bracketPairColorization: true,
        formatOnSave: false,
        autoSave: "off",
        autoSaveDelay: 1000,
        trimTrailingWhitespace: false,
        insertFinalNewline: true,
        detectIndentation: true,
        fontLigatures: true,
        cursorStyle: "line",
        cursorBlinking: "blink",
        smoothScrolling: true,
        scrollBeyondLastLine: true,
        renderLineHighlight: "line",
        showIndentGuides: true,
        showBracketGuides: true,
        imagePreview: true,
        compactTabs: false,
    },
    terminal: {
        defaultShell: "auto",
        fontFamily: "'IBM Plex Mono', Consolas, monospace",
        fontSize: 13,
        scrollback: 5000,
        copyOnSelect: false,
    },
    voice: {
        deviceId: "default",
    },
    git: {
        autoFetch: false,
        autoFetchInterval: 300,
        confirmBeforeCommit: false,
        graphAvatars: true,
        graphShowAllBranches: true,
        blame: {
            enabled: false,
        },
    },
    ai: {
        maxContextLines: 200,
        autoApplyEdits: false,
        enabledModels: [],
        defaultModel: "auto",
        providers: defaultProvidersSettings(),
        subagentModels: ["auto"],
        subagentDefaultModel: "auto",
        customSystemPrompt: "",
        customRules: "",
        compactInstructions: "",
        mcpServers: [],
        reviewAdversarialEnabled: true,
        workflows: [],
        multiworkConfirm: true,
        multiworkShowChips: true,
        autoRunMode: "auto",
        requireEditApproval: false,
        protectDestructiveGit: true,
        pluginApprovalDefault: "ask",
        pluginApprovals: {},
        pluginDisabledActions: {},
        indexEmbeddings: true,
        chatMemoryEnabled: false,
    },
    files: {
        exclude: "**/node_modules,**/.git,**/dist,**/build,**/.next",
        defaultEol: "LF",
    },
    eslint: {
        enable: true,
        fixOnSave: false,
    },
    prettier: {
        enable: true,
    },
    lsp: {
        typescript: true,
        css: true,
        html: true,
        json: true,
        tailwindcss: true,
        emmet: true,
    },
    node: {
        interpreterPath: "auto",
        packageManager: "auto",
        codingAssistance: true,
    },
    python: {
        interpreterPath: "auto",
    },
    designAutocomplete: {
        enable: true,
    },
    designDiagnostics: {
        enable: true,
        level: "AA",
    },
    tailwindControls: {
        enable: true,
        numberScrubbing: true,
        cursorBindPanel: true,
        scrubDecorations: true,
        wheelOnInputs: true,
    },
    designBlame: {
        enable: true,
    },
    spacingRefactor: {
        enable: true,
    },
    developer: {
        enableDevTools: false,
    },
    privacy: {
        showLoginPromptOnLaunch: true,
        showWelcomeOnStartup: true,
        skipCheckpointRestoreConfirm: false,
    },
    notifications: {
        desktopEnabled: true,
        onGenerationComplete: true,
        onApprovalRequired: true,
    },
    workspace: {
        toolingInstall: "off",
    },
    updates: {
        autoUpdate: true,
        channel: "stable",
    },
    appearance: {
        colorTheme: "dark",
        motionPreference: "system",
    },
};

// This is the localStorage namespace the settings live under, not a credential: the page
// reads it back with this same literal, and it can never change, because a different value
// would orphan the stored payload of every existing install. The analyzer's SCT-A000 flags
// any constant named for a key, and `skipcq` is its documented way to answer one finding at
// its own line instead of switching the rule off across the repository.
// skipcq: SCT-A000
const SETTINGS_STORAGE_NAMESPACE = "bettershape-settings-v1";
// Keep protected legacy bytes in their original slot. Only redacted
// preferences may be written while credentials await migration or review.
const REDACTED_STORAGE_KEY = "bettershape-settings-redacted-v1";

function localSettingsKey(): string {
    const raw = localStorage.getItem(SETTINGS_STORAGE_NAMESPACE);
    if (raw) {
        try { if (!canReplaceStoredSettings(JSON.parse(raw))) return REDACTED_STORAGE_KEY; }
        catch { return REDACTED_STORAGE_KEY; }
    }
    return SETTINGS_STORAGE_NAMESPACE;
}

/**
 * Tracks migration success. New persistence and event payloads always redact
 * provider credentials, independent of this flag.
 */
let secretsVaulted = false;
let desktopInitialization: Promise<void> | undefined;
// Legacy-copy replacement consent is not authority to bypass a new vault conflict.
const explicitLegacyReplacements = new Set<string>();
const credentialRecoveryConflicts = new Set<string>();
let legacyCredentialsPresent = false;

export function getCredentialRecoveryConflicts(): string[] { return [...credentialRecoveryConflicts]; }

export function registerCredentialRecoveryConflicts(ids: string[]): void {
    const previousSize = credentialRecoveryConflicts.size;
    for (const id of ids) {
        credentialRecoveryConflicts.add(id);
    }
    if (credentialRecoveryConflicts.size !== previousSize) {
        currentSettings = { ...currentSettings };
        emitLocal();
    }
}

/**
 * Register a native vault value that disagrees with this window's live credential.
 *
 * Legacy-copy replacement consent is consent to overwrite a plaintext copy, which is what
 * `canReplaceStoredSettings` and `applyDesktopHydration` use it for. It is not authority to
 * accept a newer vault value here, so the only exemption is an edit this window still owns
 * and hydration has not absorbed: that is what keeps a key re-entered while the keychain was
 * locked saveable by a later retry, which re-hydrates once the reads succeed.
 */
export function registerLegacyVaultConflicts(values: Record<string, string>, touched?: ReadonlySet<string>): void {
    if (!legacyCredentialsPresent) return;
    const live = providerSecretsForVault();
    const scopes = credentialScopes(currentSettings.ai.providers);
    registerCredentialRecoveryConflicts(Object.entries(values).filter(([id, value]) => scopes[id] !== undefined && value !== live[id]
        && !touched?.has(id)).map(([id]) => id));
}

export function acceptCredentialRecovery(values: Record<string, string>): void {
    // Recovery consent is a new unsaved intent, not a successful keychain receipt.
    if (Object.keys(values).length) secretsVaulted = false;
    for (const id of Object.keys(values)) {
        credentialRecoveryConflicts.delete(id);
        explicitLegacyReplacements.add(id);
    }
    stageCredentialDrafts(values, credentialScopes(currentSettings.ai.providers));
    const before = currentSettings;
    applyVaultSecrets(values, true);
    if (currentSettings === before) {
        currentSettings = { ...currentSettings };
        emitLocal();
    }
}

/** Marks whether the current credential writes completed. */
export function setSecretsVaulted(vaulted: boolean): void {
    const saved = vaulted && getUnsavedCredentialCount() === 0;
    if (secretsVaulted === saved) return;
    secretsVaulted = saved;
    persist();
    void persistToTauriStore();
}

export function areSecretsVaulted(): boolean {
    return secretsVaulted;
}

/** New persistence and event payloads never contain provider secrets. */
function forStorage<T extends { ai: { providers: ProvidersSettings } }>(settings: T): T {
    return redactProviderSecrets(settings);
}

/** Secrets currently in memory, keyed by their keychain id. */
export function providerSecretsForVault(): Record<string, string> {
    return providerSecrets(currentSettings.ai.providers);
}

/**
 * Fold keychain secrets back into the live settings.
 *
 * Values already in memory win, so a migration from plaintext settings keeps
 * whatever the user had before the keychain was in use.
 */
export function applyVaultSecrets(secrets: Record<string, string>, overwrite = false): void {
    let changed = false;
    const connections = { ...currentSettings.ai.providers.connections };
    for (const [id, value] of Object.entries(secrets)) {
        const secret = value.trim();
        if (!secret && !overwrite) continue;
        const header = parseHeaderSecretId(id);
        if (header) {
            const connection = connections[header.id];
            // The name has to be in settings already: a stale keychain entry for
            // a header the user removed must not resurrect itself.
            if (connection && Object.prototype.hasOwnProperty.call(connection.headers, header.name) && (overwrite ? connection.headers[header.name] !== secret : !connection.headers[header.name]?.trim())) {
                connections[header.id] = {
                    ...connection,
                    headers: { ...connection.headers, [header.name]: secret },
                };
                changed = true;
            }
            continue;
        }
        const connection = connections[id as keyof typeof connections];
        if (connection && (overwrite ? connection.apiKey !== secret : !connection.apiKey.trim())) {
            connections[id as keyof typeof connections] = { ...connection, apiKey: secret };
            changed = true;
        }
    }
    const search = currentSettings.ai.providers.services.search;
    const composio = currentSettings.ai.providers.services.composio;
    const searchKey = secrets["service:search"]?.trim();
    const composioKey = secrets["service:composio"]?.trim();
    let services = currentSettings.ai.providers.services;
    if (searchKey !== undefined && (overwrite ? search.apiKey !== searchKey : Boolean(searchKey) && !search.apiKey.trim())) {
        services = { ...services, search: { ...search, apiKey: searchKey } };
        changed = true;
    }
    if (composioKey !== undefined && (overwrite ? composio.apiKey !== composioKey : Boolean(composioKey) && !composio.apiKey.trim())) {
        services = { ...services, composio: { ...composio, apiKey: composioKey } };
        changed = true;
    }
    if (!changed) {
        // Still rewrite both stores: an older build may have left plaintext keys
        // behind, and redaction only takes effect on the next write.
        persist();
        void persistToTauriStore();
        return;
    }
    currentSettings = {
        ...currentSettings,
        ai: {
            ...currentSettings.ai,
            providers: { ...currentSettings.ai.providers, connections, services },
        },
    };
    persist();
    void persistToTauriStore();
    emitLocal();
}

let currentSettings: BetterShapeSettings = {
    ...DEFAULT_SETTINGS,
    editor: { ...DEFAULT_SETTINGS.editor },
    terminal: { ...DEFAULT_SETTINGS.terminal },
    voice: { ...DEFAULT_SETTINGS.voice },
    git: { ...DEFAULT_SETTINGS.git },
    ai: { ...DEFAULT_SETTINGS.ai },
    files: { ...DEFAULT_SETTINGS.files },
    eslint: { ...DEFAULT_SETTINGS.eslint },
    prettier: { ...DEFAULT_SETTINGS.prettier },
    lsp: { ...DEFAULT_SETTINGS.lsp },
    node: { ...DEFAULT_SETTINGS.node },
    python: { ...DEFAULT_SETTINGS.python },
    designAutocomplete: { ...DEFAULT_SETTINGS.designAutocomplete },
    designDiagnostics: { ...DEFAULT_SETTINGS.designDiagnostics },
    tailwindControls: { ...DEFAULT_SETTINGS.tailwindControls },
    designBlame: { ...DEFAULT_SETTINGS.designBlame },
    spacingRefactor: { ...DEFAULT_SETTINGS.spacingRefactor },
    developer: { ...DEFAULT_SETTINGS.developer },
    privacy: { ...DEFAULT_SETTINGS.privacy },
    notifications: { ...DEFAULT_SETTINGS.notifications },
    workspace: { ...DEFAULT_SETTINGS.workspace },
    updates: { ...DEFAULT_SETTINGS.updates },
    appearance: { ...DEFAULT_SETTINGS.appearance },
};
let hydrated = false;
let settingsBridgeInitialized = false;
const listeners = new Set<() => void>();

function mergeAiSettings(
    base: BetterShapeSettings["ai"] | undefined,
    patch: Partial<BetterShapeSettings["ai"]> | undefined,
): BetterShapeSettings["ai"] {
    const merged = { ...DEFAULT_SETTINGS.ai, ...base, ...patch };
    merged.pluginApprovals = {
        ...DEFAULT_SETTINGS.ai.pluginApprovals,
        ...(base?.pluginApprovals ?? {}),
        ...(patch?.pluginApprovals ?? {}),
    };
    merged.pluginDisabledActions = {
        ...DEFAULT_SETTINGS.ai.pluginDisabledActions,
        ...(base?.pluginDisabledActions ?? {}),
        ...(patch?.pluginDisabledActions ?? {}),
    };
    merged.pluginApprovalDefault = patch?.pluginApprovalDefault
        ?? base?.pluginApprovalDefault
        ?? DEFAULT_SETTINGS.ai.pluginApprovalDefault;
    merged.compactInstructions =
        patch?.compactInstructions ?? base?.compactInstructions ?? DEFAULT_SETTINGS.ai.compactInstructions;
    merged.workflows = patch?.workflows ?? base?.workflows ?? DEFAULT_SETTINGS.ai.workflows;
    merged.subagentModels = Array.isArray(patch?.subagentModels)
        ? patch.subagentModels
        : Array.isArray(base?.subagentModels)
          ? base.subagentModels
          : DEFAULT_SETTINGS.ai.subagentModels;
    merged.subagentDefaultModel =
        patch?.subagentDefaultModel
        ?? base?.subagentDefaultModel
        ?? DEFAULT_SETTINGS.ai.subagentDefaultModel;
    merged.providers = normalizeProvidersSettings({
        ...(base?.providers ?? DEFAULT_SETTINGS.ai.providers),
        ...(patch?.providers ?? {}),
        connections: {
            ...(base?.providers?.connections ?? DEFAULT_SETTINGS.ai.providers.connections),
            ...(patch?.providers?.connections ?? {}),
        },
        services: {
            search: {
                ...(base?.providers?.services?.search ?? DEFAULT_SETTINGS.ai.providers.services.search),
                ...(patch?.providers?.services?.search ?? {}),
            },
            composio: {
                ...(base?.providers?.services?.composio ?? DEFAULT_SETTINGS.ai.providers.services.composio),
                ...(patch?.providers?.services?.composio ?? {}),
            },
        },
    });
    // Legacy "System Instructions" fold into Rules — one concept for user guidance.
    const legacy = merged.customSystemPrompt?.trim();
    if (legacy) {
        const rules = merged.customRules?.trim();
        merged.customRules = rules ? `${rules}\n\n${legacy}` : legacy;
        merged.customSystemPrompt = "";
    }
    return merged;
}

function mergeSettings(
    base: BetterShapeSettings,
    patch: Partial<BetterShapeSettings>,
    options?: { preserveSecrets?: boolean },
): BetterShapeSettings {
    const aiPatch = patch.ai ? { ...patch.ai } : undefined;
    const mergedAi = mergeAiSettings(base.ai, aiPatch);
    // Storage carries no keys once the keychain is in use, so a payload coming
    // back from disk (or from the other window) must not blank the live ones.
    const ai = options?.preserveSecrets
        ? { ...mergedAi, providers: mergeProviderConnections(currentSettings.ai.providers, mergedAi.providers) }
        : mergedAi;
    return {
        editor: { ...DEFAULT_SETTINGS.editor, ...base.editor, ...patch.editor },
        terminal: { ...DEFAULT_SETTINGS.terminal, ...base.terminal, ...patch.terminal },
        voice: { ...DEFAULT_SETTINGS.voice, ...base.voice, ...patch.voice },
        git: {
            ...DEFAULT_SETTINGS.git,
            ...base.git,
            ...patch.git,
            blame: {
                ...DEFAULT_SETTINGS.git.blame,
                ...(base.git?.blame ?? {}),
                ...(patch.git?.blame ?? {}),
            },
        },
        ai,
        skills: {
            ...DEFAULT_SETTINGS.skills,
            ...base.skills,
            ...patch.skills,
            folders: Array.isArray(patch.skills?.folders)
                ? patch.skills.folders
                : Array.isArray(base.skills?.folders)
                  ? base.skills.folders
                  : DEFAULT_SETTINGS.skills.folders,
        },
        files: { ...DEFAULT_SETTINGS.files, ...base.files, ...patch.files },
        eslint: { ...DEFAULT_SETTINGS.eslint, ...base.eslint, ...patch.eslint },
        prettier: { ...DEFAULT_SETTINGS.prettier, ...base.prettier, ...patch.prettier },
        lsp: { ...DEFAULT_SETTINGS.lsp, ...base.lsp, ...patch.lsp },
        node: { ...DEFAULT_SETTINGS.node, ...base.node, ...patch.node },
        python: { ...DEFAULT_SETTINGS.python, ...base.python, ...patch.python },
        designAutocomplete: { ...DEFAULT_SETTINGS.designAutocomplete, ...base.designAutocomplete, ...patch.designAutocomplete },
        designDiagnostics: { ...DEFAULT_SETTINGS.designDiagnostics, ...base.designDiagnostics, ...patch.designDiagnostics },
        tailwindControls: {
            ...DEFAULT_SETTINGS.tailwindControls,
            ...(base as BetterShapeSettings & { inlinePickers?: { enable: boolean } }).tailwindControls,
            ...(base as BetterShapeSettings & { inlinePickers?: { enable: boolean } }).inlinePickers,
            ...patch.tailwindControls,
            ...(patch as Partial<BetterShapeSettings & { inlinePickers?: { enable: boolean } }>).inlinePickers,
        },
        designBlame: {
            ...DEFAULT_SETTINGS.designBlame,
            ...base.designBlame,
            ...patch.designBlame,
        },
        spacingRefactor: {
            ...DEFAULT_SETTINGS.spacingRefactor,
            ...base.spacingRefactor,
            ...patch.spacingRefactor,
        },
        privacy: { ...DEFAULT_SETTINGS.privacy, ...base.privacy, ...patch.privacy },
        notifications: {
            ...DEFAULT_SETTINGS.notifications,
            ...base.notifications,
            ...patch.notifications,
        },
        developer: { ...DEFAULT_SETTINGS.developer, ...base.developer, ...patch.developer },
        workspace: { ...DEFAULT_SETTINGS.workspace, ...base.workspace, ...patch.workspace },
        updates: {
            ...DEFAULT_SETTINGS.updates,
            ...base.updates,
            ...patch.updates,
            channel: normalizeUpdateChannel(
                patch.updates?.channel ?? base.updates?.channel ?? DEFAULT_SETTINGS.updates.channel,
            ),
        },
        appearance: {
            ...DEFAULT_SETTINGS.appearance,
            ...base.appearance,
            ...patch.appearance,
            colorTheme: normalizeColorTheme(
                patch.appearance?.colorTheme ??
                    base.appearance?.colorTheme ??
                    DEFAULT_SETTINGS.appearance.colorTheme,
            ),
            motionPreference: normalizeMotionPreference(
                patch.appearance?.motionPreference ??
                    base.appearance?.motionPreference ??
                    DEFAULT_SETTINGS.appearance.motionPreference,
            ),
        },
    };
}

export function resolveDefaultTerminalShell(): "powershell" | "cmd" | "gitbash" {
    const shell = getSettings().terminal.defaultShell;
    if (shell === "cmd") return "cmd";
    if (shell === "git-bash") return "gitbash";
    if (shell === "powershell") return "powershell";
    if (isWindows()) {
        return "powershell";
    }
    // The shell union has no POSIX member yet, so macOS / Linux still land here.
    return "powershell";
}

export function isLspLanguageEnabled(language: string, settings: BetterShapeSettings = getSettings()): boolean {
    switch (language) {
        case "typescript":
            return settings.lsp.typescript;
        case "css":
            return settings.lsp.css;
        case "html":
            return settings.lsp.html;
        case "json":
            return settings.lsp.json;
        case "tailwindcss":
            return settings.lsp.tailwindcss;
        default:
            return true;
    }
}

export function getFileExcludePatterns(): string {
    return getSettings().files.exclude;
}

function applySettingsFromPayload(next: Partial<BetterShapeSettings> | BetterShapeSettings) {
    currentSettings = mergeRedactedPreferences(currentSettings, next);
    hydrated = true;
    applyAppearanceSettings(currentSettings);
}

function emitLocal() {
    listeners.forEach((l) => l());
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("bettershape-settings-changed", { detail: currentSettings }));
    }
}

let settingsRefreshGeneration = 0;

/** Events only invalidate a snapshot. Their delayed payloads never become storage authority. */
async function reconcileSettingsNotification(): Promise<void> {
    const generation = ++settingsRefreshGeneration;
    const local = localPersistenceFailed ? undefined : readLocalPreferences(false);
    if (local) {
        applySettingsFromPayload(local);
        emitLocal();
        return;
    }
    if (!desktopInitializationFinished) return;
    const pending = pendingDesktopPersistence;
    const before = currentSettings;
    await pending;
    if (nativePersistenceFailed) return;
    try {
        const { loadDesktopStore } = await import("./desktop-store");
        const store = await loadDesktopStore("settings-preferences.json");
        const next = await store.get<Partial<BetterShapeSettings>>("settings");
        if (generation !== settingsRefreshGeneration || pending !== pendingDesktopPersistence || before !== currentSettings) return;
        if (next) {
            applySettingsFromPayload(next);
            emitLocal();
        }
    } catch { /* An unavailable store supplies no replacement authority. */ }
}

/** Sync settings across Tauri windows (settings window -> main editor window). */
export function initSettingsBridge(): void {
    if (settingsBridgeInitialized || typeof window === "undefined") return;
    settingsBridgeInitialized = true;

    window.addEventListener("storage", (event) => {
        if (!event.newValue) return;
        try {
            if (event.key !== localSettingsKey()) return;
            void reconcileSettingsNotification();
        } catch {
            /* ignore malformed storage payload */
        }
    });

    if ("__TAURI_INTERNALS__" in window) {
        void import("@tauri-apps/api/event").then(({ listen }) =>
            listen("bettershape-settings-changed", () => { void reconcileSettingsNotification(); }),
        ).catch(() => { /* The same-origin storage bridge remains available. */ });
    }
}

/** Reading preferences never grants authority to rewrite an unreadable original record. */
function readLocalPreferences(overlayOnly = true): Partial<BetterShapeSettings> | undefined {
    try {
        const key = localSettingsKey();
        if (overlayOnly && key !== REDACTED_STORAGE_KEY) return;
        const raw = localStorage.getItem(key);
        const parsed: unknown = raw ? JSON.parse(raw) : undefined;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed as Partial<BetterShapeSettings> : undefined;
    } catch { return; }
}

/** Preferences may restore ordinary fields, but cannot carry keys or rebind a retained credential. */
function mergeRedactedPreferences(base: BetterShapeSettings, patch: Partial<BetterShapeSettings>): BetterShapeSettings {
    const overlay = mergeSettingsOverlay(DEFAULT_SETTINGS, base, patch) as Partial<BetterShapeSettings>;
    const merged = forStorage(mergeSettings(base, overlay));
    return { ...merged, ai: { ...merged.ai, providers: mergeProviderConnections(base.ai.providers, merged.ai.providers) } };
}

function loadFromLocalStorage() {
    if (typeof window === "undefined") return;
    try {
        const raw = localStorage.getItem(SETTINGS_STORAGE_NAMESPACE);
        let parsed: Partial<BetterShapeSettings> | undefined;
        try { parsed = raw ? JSON.parse(raw) as Partial<BetterShapeSettings> : undefined; } catch { /* Preserve malformed legacy bytes. */ }
        if (parsed) {
            currentSettings = mergeSettings(DEFAULT_SETTINGS, parsed);
            legacyCredentialsPresent ||= Object.keys(providerSecretsForVault()).length > 0;
        }
        const preferences = readLocalPreferences();
        if (preferences) currentSettings = mergeRedactedPreferences(currentSettings, preferences);
        if (parsed?.updates?.channel && parsed.updates.channel !== currentSettings.updates.channel) persist();
    } catch { /* Storage denial does not discard this window's settings. */ }
}

// Keep a legacy copy until migration succeeds, without copying it elsewhere.
function canReplaceStoredSettings(stored: Partial<BetterShapeSettings> | null | undefined): boolean {
    const legacy = Object.entries(providerSecrets(normalizeProvidersSettings(stored?.ai?.providers)));
    if (legacy.length === 0) return true;
    if (credentialRecoveryConflicts.size > 0) return false;
    const live = providerSecretsForVault();
    return secretsVaulted && getUnsavedCredentialCount() === 0 && legacy.every(([id, value]) => live[id] === value || explicitLegacyReplacements.has(id));
}

let localPersistenceFailed = false;
let nativePersistenceFailed = false;

function persist() {
    if (typeof window === "undefined") return;
    try {
        let key = localSettingsKey();
        const raw = localStorage.getItem(key);
        if (key === SETTINGS_STORAGE_NAMESPACE && raw && !canReplaceStoredSettings(JSON.parse(raw))) key = REDACTED_STORAGE_KEY;
        localStorage.setItem(key, JSON.stringify(desktopPreferenceSnapshot(currentSettings, pendingDesktopHydration?.preferences)));
        if (key === SETTINGS_STORAGE_NAMESPACE) localStorage.removeItem(REDACTED_STORAGE_KEY);
        localPersistenceFailed = false;
    } catch { localPersistenceFailed = true; }
}

/** An unreadable primary grants no replacement authority, but need not block redacted preferences. */
async function readDesktopPrimary(load: typeof import("./desktop-store").loadDesktopStore) {
    try {
        const store = await load("settings.json");
        return { store, settings: await store.get<Partial<BetterShapeSettings>>("settings") };
    } catch { return undefined; }
}

interface DesktopHydration {
    before: BetterShapeSettings;
    localPreferences: Partial<BetterShapeSettings> | undefined;
    localRecord: Partial<BetterShapeSettings> | undefined;
    primaryApplied: boolean;
    preferences?: Partial<BetterShapeSettings>;
}

let pendingDesktopPersistence: Promise<void> = Promise.resolve();
let desktopInitializationFinished = false;
// An attempted read is not authority to replace a file. Retain the original
// edit baseline until canonical preferences have actually been read and merged.
let pendingDesktopHydration: DesktopHydration | undefined;

function desktopPreferenceSnapshot(live: BetterShapeSettings, preferences: Partial<BetterShapeSettings> | undefined) {
    const redacted = forStorage(live);
    const context = pendingDesktopHydration;
    return context && !context.primaryApplied
        ? projectSettingsOverlay(forStorage(DEFAULT_SETTINGS), redacted, preferences, context.localRecord, context.localPreferences) as Partial<BetterShapeSettings>
        : redacted;
}

function applyDesktopHydration(
    primary: Awaited<ReturnType<typeof readDesktopPrimary>>,
    preferences: Partial<BetterShapeSettings> | undefined,
    context: DesktopHydration,
) {
    const stored = primary?.settings;
    let incoming = stored ? mergeSettings(DEFAULT_SETTINGS, stored, { preserveSecrets: true }) : context.before;
    if (preferences) incoming = mergeRedactedPreferences(incoming, preferences);
    if (!primary && context.localRecord) incoming = mergeRedactedPreferences(incoming, context.localRecord);
    if (context.localPreferences) incoming = mergeRedactedPreferences(incoming, context.localPreferences);
    const localSecrets = providerSecretsForVault();
    if (stored) {
        const localScopes = credentialScopes(currentSettings.ai.providers);
        const storedProviders = normalizeProvidersSettings(stored.ai?.providers);
        const storedSecrets = providerSecrets(storedProviders);
        const storedScopes = credentialScopes(storedProviders);
        legacyCredentialsPresent ||= Object.keys(storedSecrets).length > 0;
        for (const [id, value] of Object.entries(localSecrets)) {
            if (((storedSecrets[id] !== undefined && storedSecrets[id] !== value) || storedScopes[id] !== localScopes[id]) && !explicitLegacyReplacements.has(id)) credentialRecoveryConflicts.add(id);
        }
    }
    currentSettings = mergeSettingsHydration(context.before, currentSettings, incoming);
    // A vault receipt for the earlier state cannot acknowledge newly recovered keys.
    if (Object.entries(providerSecretsForVault()).some(([id, value]) => localSecrets[id] !== value)) secretsVaulted = false;
    persist();
    applyAppearanceSettings(currentSettings);
    emitLocal();
    return incoming;
}

/** Serialize redacted writes; protected legacy credentials remain only in their original file. */
function queueDesktopPersistence(): Promise<void> {
    pendingDesktopPersistence = pendingDesktopPersistence.then(async () => {
        const { loadDesktopStore: load } = await import("./desktop-store");
        const primary = await readDesktopPrimary(load);
        const context = pendingDesktopHydration;
        if (context && primary && !context.primaryApplied) {
            // A preferences outage must not hide a readable legacy credential.
            // Rebase the comparison baseline so this automatic hydration is not
            // mistaken for a user edit when canonical preferences recover.
            context.before = applyDesktopHydration(primary, context.preferences, context);
            context.primaryApplied = true;
        }
        const preferences = await load("settings-preferences.json");
        const storedPreferences = await preferences.get<Partial<BetterShapeSettings>>("settings");
        if (context) context.before = applyDesktopHydration(primary, storedPreferences, context);
        const live = currentSettings;
        const snapshot = desktopPreferenceSnapshot(live, storedPreferences);
        // The preferences file is this app's own redacted record and the write below replaces
        // it wholesale, so a field this build does not model would be deleted just by touching a
        // setting. `mergeSettingsOverlay` keeps every key of the record read above that the
        // snapshot does not set and takes the snapshot's value for the ones it does, so unknown
        // fields - and unknown entries inside maps such as `ai.providers` - survive the rewrite.
        // Credentials are not preserved by accident: `redactProviderSecrets` already ran inside
        // the snapshot, and the native validator still refuses a record that carries one.
        const preserved = storedPreferences
            ? mergeSettingsOverlay(DEFAULT_SETTINGS, storedPreferences, snapshot) as Partial<BetterShapeSettings>
            : snapshot;
        // Reuse the hydration read's adapter/revision. A fresh read here would
        // grant authority to overwrite settings this window never hydrated.
        await preferences.set("settings", preserved);
        await preferences.save();
        nativePersistenceFailed = false;
        if (context) {
            if (context.primaryApplied) pendingDesktopHydration = undefined;
            else {
                // Keep retrying an unread primary without serializing its unknown
                // fields as defaults or treating committed edits as forever dirty.
                context.before = live;
                context.preferences = snapshot;
                context.localPreferences = undefined;
                context.localRecord = undefined;
            }
        }
        if (primary?.store.replaceable && canReplaceStoredSettings(primary.settings)) {
            // The canonical file keeps this build's model: unknown top-level keys are refused by
            // the native guard rather than dropped, while nested fields inside the branches this
            // build models are owned by this snapshot. Preserving them here is not an option -
            // this file is exactly where an unmigrated plaintext credential can still live, and
            // re-emitting it would undo the redaction this save performs.
            await primary.store.set("settings", snapshot);
            // Compatibility cleanup cannot revoke a committed preferences write.
            await primary.store.save().catch(() => undefined);
        }
    }).catch(() => { nativePersistenceFailed = true; });
    return pendingDesktopPersistence;
}

function persistToTauriStore(): Promise<void> {
    return desktopInitializationFinished ? queueDesktopPersistence() : Promise.resolve();
}

export function initSettings(): Promise<void> {
    if (!desktopInitialization || (desktopInitializationFinished && pendingDesktopHydration)) {
        desktopInitializationFinished = false;
        desktopInitialization = hydrateDesktopSettings();
    }
    return desktopInitialization;
}

async function hydrateDesktopSettings(): Promise<void> {
    initSettingsBridge();
    pendingDesktopHydration ??= {
        before: getSettings(),
        localPreferences: readLocalPreferences(),
        localRecord: readLocalPreferences(false),
        primaryApplied: false,
    };
    await queueDesktopPersistence();
    desktopInitializationFinished = true;
    hydrated = true;
    applyAppearanceSettings(currentSettings);
    emitLocal();
    // Keep the Rust indexer embeddings flag in sync with persisted settings.
    void import("@/lib/backend").then(({ commands }) => {
        commands.setIndexEmbeddings(currentSettings.ai.indexEmbeddings).catch(() => {
            /* desktop bridge may not be ready yet */
        });
        commands.setChatMemoryEnabled(currentSettings.ai.chatMemoryEnabled).catch(() => {
            /* desktop bridge may not be ready yet */
        });
    });
}

export function getSettings(): BetterShapeSettings {
    if (!hydrated && typeof window !== "undefined") {
        loadFromLocalStorage();
        hydrated = true;
        applyAppearanceSettings(currentSettings);
    }
    return currentSettings;
}

export function updateSettings(patch: Partial<BetterShapeSettings>): void {
    getSettings();
    const previous = providerSecretsForVault();
    const previousScopes = credentialScopes(currentSettings.ai.providers);
    currentSettings = mergeSettings(currentSettings, patch);
    const next = providerSecretsForVault();
    const scopes = credentialScopes(currentSettings.ai.providers);
    const changes = Object.fromEntries([...new Set([...Object.keys(previous), ...Object.keys(next)])]
        .filter((id) => previous[id] !== next[id] || Boolean(next[id]) && previousScopes[id] !== scopes[id]).map((id) => [id, next[id] ?? ""]));
    stageCredentialDrafts(changes, scopes);
    for (const id of Object.keys(changes)) {
        credentialRecoveryConflicts.delete(id);
        explicitLegacyReplacements.add(id);
    }
    if (Object.keys(changes).length) secretsVaulted = false;
    persist();
    applyAppearanceSettings(currentSettings);
    void persistToTauriStore();
    emitLocal();
}

/**
 * Put every setting back to its default and drop the stored copy.
 *
 * The storage key belongs to this module. The settings screen used to repeat its literal,
 * so renaming the namespace would have left the stored payload behind for the next start
 * to load straight back over the reset.
 */
export function resetSettings(): void {
    if (typeof window !== "undefined") {
        try {
            localStorage.removeItem(SETTINGS_STORAGE_NAMESPACE);
        } catch {
            /* a storage failure leaves the in-memory reset below untouched */
        }
    }
    updateSettings(DEFAULT_SETTINGS);
}

/** `true` uses the system default. A saved device id is requested exactly. */
export function microphoneConstraints(deviceId: string): MediaTrackConstraints | boolean {
    if (!deviceId || deviceId === "default") return true;
    return { deviceId: { exact: deviceId } };
}

/** One-line reason a `getUserMedia` call failed. */
export function microphoneErrorMessage(err: unknown): string {
    const name = err instanceof Error ? err.name : "";
    switch (name) {
        case "NotAllowedError":
        case "SecurityError":
            return "Microphone access is blocked. Allow it for BetterShape in Windows privacy settings.";
        case "NotFoundError":
        case "OverconstrainedError":
            return "No microphone was found.";
        case "NotReadableError":
        case "AbortError":
            return "The microphone is in use by another app.";
        default:
            return "The microphone couldn't be started.";
    }
}

export function updateSettingSection<K extends keyof BetterShapeSettings>(
    section: K,
    patch: Partial<BetterShapeSettings[K]>
): void {
    updateSettings({ [section]: { ...currentSettings[section], ...patch } } as Partial<BetterShapeSettings>);
}

/**
 * Read the settings through a store so every consumer re-renders on a change.
 *
 * The server snapshot is `DEFAULT_SETTINGS`, never `getSettings()`. This app is a
 * static export, so every settings route is prerendered with the defaults and
 * hydrated on the client. `getSettings()` reads `localStorage` on its first call,
 * so passing it as the server snapshot made the first client render return the
 * stored settings, React compared that against the prerendered defaults and
 * reported a hydration mismatch on every attribute that settings feed. The QA
 * crawl caught it on `/settings` as a button whose `title` differed.
 *
 * React then re-renders with the client snapshot once hydration finishes, so the
 * stored settings still appear, and the first paint agrees with the HTML.
 */
export function useSettings(): BetterShapeSettings {
    return useSyncExternalStore(
        (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        () => getSettings(),
        () => DEFAULT_SETTINGS,
    );
}

export function subscribeSettings(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function paintDarkTheme() {
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = "dark";
    document.documentElement.classList.add("dark");
}

export function applyAppearanceSettings(settings: BetterShapeSettings) {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty("--editor-font-family", settings.editor.fontFamily);
    document.documentElement.style.setProperty("--editor-font-size", `${settings.editor.fontSize}px`);
    document.documentElement.style.setProperty("--font-mono", settings.editor.fontFamily);
    if (settings.appearance.motionPreference === "reduced") {
        document.documentElement.dataset.motionPreference = "reduced";
    } else {
        delete document.documentElement.dataset.motionPreference;
    }
    paintDarkTheme();
}

export function getEditorOptionsFromSettings(settings: BetterShapeSettings = getSettings()) {
    return {
        fontFamily: settings.editor.fontFamily,
        fontSize: settings.editor.fontSize,
        tabSize: settings.editor.tabSize,
        insertSpaces: settings.editor.insertSpaces,
        defaultEol: settings.files.defaultEol,
        wordWrap: settings.editor.wordWrap as "off" | "on" | "wordWrapColumn" | "bounded",
        minimap: { enabled: settings.editor.minimap },
        lineNumbers: settings.editor.lineNumbers as "on" | "off" | "relative" | "interval" | (number & {}),
        renderWhitespace: settings.editor.renderWhitespace as "none" | "boundary" | "selection" | "trailing" | "all",
        bracketPairColorization: { enabled: settings.editor.bracketPairColorization },
        fontLigatures: settings.editor.fontLigatures,
        cursorStyle: settings.editor.cursorStyle as "line" | "block" | "underline" | "line-thin" | "block-outline" | "underline-thin",
        cursorBlinking: settings.editor.cursorBlinking as "blink" | "smooth" | "phase" | "expand" | "solid",
        detectIndentation: settings.editor.detectIndentation,
        smoothScrolling: settings.editor.smoothScrolling,
        scrollBeyondLastLine: settings.editor.scrollBeyondLastLine,
        renderLineHighlight: settings.editor.renderLineHighlight,
        guides: {
            indentation: settings.editor.showIndentGuides,
            highlightActiveIndentation: settings.editor.showIndentGuides,
            bracketPairs: settings.editor.showBracketGuides,
            bracketPairsHorizontal: settings.editor.showBracketGuides,
        },
    };
}
