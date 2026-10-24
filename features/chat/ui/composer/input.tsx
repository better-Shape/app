"use client";

import { Add20Regular } from "@fluentui/react-icons/headless/svg/add";
import { ArrowMaximize20Regular } from "@fluentui/react-icons/headless/svg/arrow-maximize";
import { ArrowMinimize20Regular } from "@fluentui/react-icons/headless/svg/arrow-minimize";
import { ArrowUp20Regular } from "@fluentui/react-icons/headless/svg/arrow-up";
import { Checkmark20Regular } from "@fluentui/react-icons/headless/svg/checkmark";
import { CodeTextEdit20Filled } from "@fluentui/react-icons/headless/svg/code-text-edit";
import { ChatMultiple20Filled } from "@fluentui/react-icons/headless/svg/chat-multiple";
import { CalendarMultiple24Filled } from "@fluentui/react-icons/headless/svg/calendar-multiple";
import { ColorLine24Filled } from "@fluentui/react-icons/headless/svg/color-line";
import { Incognito24Filled } from "@fluentui/react-icons/headless/svg/incognito";
import { Document20Regular } from "@fluentui/react-icons/headless/svg/document";
import { DocumentText20Regular } from "@fluentui/react-icons/headless/svg/document-text";
import { FolderAdd24Filled } from "@fluentui/react-icons/headless/svg/folder-add";
import { Connected24Filled } from "@fluentui/react-icons/headless/svg/connected";
import { DocumentEdit24Filled } from "@fluentui/react-icons/headless/svg/document-edit";
import { Dismiss16Regular } from "@fluentui/react-icons/headless/svg/dismiss";
import { MoviesAndTv24Filled } from "@fluentui/react-icons/headless/svg/movies-and-tv";
import { TextQuote16Regular } from "@fluentui/react-icons/headless/svg/text-quote";




import React from "react";
import { Arc } from "loading-dev";
import { Icon } from "@/components/ui/icon";



import { cn } from "@/lib/utils";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuCheckboxItem,
    DropdownMenuTrigger,
    DropdownMenuLabel,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent,
} from "@/components/ui/dropdown";
import { Button } from "@/components/ui/button";
import { SwapText } from "@/components/ui/swap";
import { Tooltip } from "@/components/ui/tooltip";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuShortcut,
    ContextMenuTrigger,
} from "@/components/ui/context";
import { BetterShapeAutoIcon, providerIcon } from "@/lib/ui/provider-icon";
import { MentionPicker } from "./mentions";
import { PendingEditsPanel } from "./edits";
import { WorkspaceBranchSwitch } from "@/features/agent/workspace/branch-switch";
import {
    ComposerTasksStrip,
    type ComposerTaskItem,
} from "./activity";
import { QueuedMessagesPanel, type QueuedMessage } from "./queue";
import { ComposerAttachments, isImageFile, isAudioFile, type ComposerAttachment } from "./attachments";
import { DictationButton } from "./dictation-button";
import { MediaLightbox } from "../blocks/lightbox";
import { formatMentionToken, mentionRanges, shortenMentionTokensInText } from "@/lib/chat/mentions";
import {
    BETTERSHAPE_CLIP_CODE,
    codeAttachmentFile,
    matchRememberedClip,
    pasteIsLarge,
    pastedTextFile,
    terminalAttachmentFile,
} from "@/features/chat/lib/bettershape-clip";
import type { BrowserPickedElement } from "@/lib/backend/types";
import { registerElementMention } from "@/lib/chat/element-mentions";
import { slashCommandRanges } from "@/lib/chat/workflows";
import {
    buildComposerScrollMaskImage,
    computeComposerScrollMask,
    syncComposerOverlayScroll,
} from "@/lib/chat/composer-scroll";
import {
    canStepPromptHistoryUp,
    insertTextareaRangeWithUndo,
    isCaretOnLastLogicalLine,
    isUnmodifiedHistoryRecall,
    mergeNewestFirstPrompts,
    stepPromptHistoryDown,
    stepPromptHistoryUp,
    tryWrapMarkdownLinkOnPaste,
    type PromptHistoryCursor,
} from "@/lib/chat/prompt-history";
import { listSkills, subscribeSkills, type Skill } from "@/lib/chat/skills";
import { warmComposerResources } from "@/lib/chat/mention-warm-cache";
import { getProjectPath } from "@/lib/backend";
import { fetchPlugins, peekPluginsCache, type PluginRow } from "@/lib/plugins/api";
import { PluginLogo } from "@/components/ui/plugin-logo";
import { getVisibleModels, resolveChatModels, sanitizeEnabledModels, type ModelInfo } from "@/lib/settings/models";
import { hasAnyUsableProvider } from "@/lib/ai/providers";
import {
    getCatalogDefaultEnabledIds,
    getCatalogModels,
    getCatalogProviderOrder,
    useBetterShapeCatalog,
} from "@/lib/catalog/store";
import { useSettings } from "@/lib/settings";
import { SearchInput } from "@/components/ui/search";
import { notify } from "@/features/notifications";
import { openSettingsWindow } from "@/lib/window/open-settings";
import { effortDisplayLabel, modelSupportsSuperThinking, type ReasoningEffort } from "./reasoning-effort";
import { ThinkingEffortControl } from "./thinking-bar";
import type { QuotedExcerpt } from "../quote-selection";
export type { ReasoningEffort };

/**
 * When a line begins with horizontal whitespace followed by a long unbroken token (e.g.
 * `" ccffffffff..."` or `" https://..."`), CSS `pre-wrap` + `break-words` treats the leading
 * space as a soft-wrap opportunity and pushes the token onto line 2, leaving a blank top row.
 * Switching both the mirror overlay and `<textarea>` to `break-all` in lockstep keeps line 1
 * filled from column 0 while preserving normal word wrapping for ordinary prose.
 */
export function shouldComposerBreakAll(value: string): boolean {
    if (!value) return false;
    return /^(?:[ \t]+\S{16,}|[ \t]{10,}\S+)/m.test(value);
}

function formatPasteSizeLabel(text: string): string {
    let lines = 1;
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === 10) lines += 1;
    }
    const chars =
        text.length >= 1000
            ? `${(text.length / 1000).toFixed(1)}k chars`
            : `${text.length} chars`;
    return `${lines.toLocaleString()} ${lines === 1 ? "line" : "lines"} (${chars})`;
}

type ChatInputProps = {
    inputValue: string;
    isLoading: boolean;
    isPreparing?: boolean;
    webSearch: string;
    uploadedFiles: ComposerAttachment[];
    onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
    onSendMessage: () => void;
    onStopMessage: () => void;
    setWebSearch: (s: string) => void;
    setUploadedFiles: React.Dispatch<React.SetStateAction<ComposerAttachment[]>>;
    addUploadedFiles: (files: File[], peaks?: number[][]) => void;
    handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    selectedModel: string;
    setSelectedModel: (m: string) => void;
    selectedWorkerModels?: string[];
    setSelectedWorkerModels?: (models: string[]) => void;
    multiSelectModels?: boolean;
    hideModeSelect?: boolean;
    selectedMode: string;
    setSelectedMode: (m: string) => void;
    reasoningEffort: ReasoningEffort;
    setReasoningEffort: (e: ReasoningEffort) => void;
    pendingEdits?: { id: string; file: string; original: string; replacement: string; baseline?: string }[];
    onAcceptAllEdits?: () => void;
    onRejectAllEdits?: () => void;
    onAcceptEdit?: (id: string) => void;
    onRejectEdit?: (id: string) => void;
    taskItems?: ComposerTaskItem[];
    queuedMessages?: QueuedMessage[];
    onEditQueuedMessage?: (id: string) => void;
    onRemoveQueuedMessage?: (id: string) => void;
    onSendQueuedNow?: (id: string) => void;
    projectRuleFiles?: string[];
    quotedExcerpts?: QuotedExcerpt[];
    onRemoveQuote?: (id: string) => void;
    promptHistory?: string[];
    onNewChat?: () => void;
    /** Tighter chrome for empty-chat centered layout */
    variant?: "default" | "empty";
};

function formatContextWindow(raw?: string): string {
    const t = (raw ?? "").trim();
    if (!t) return "";
    return t.replace(/(?<![0-9.])([0-9.]+)\s*K\b/i, "$1k").replace(/(?<![0-9.])([0-9.]+)\s*M\b/i, "$1m");
}

const ModelTooltip = ({
    model,
    effort,
    resolvedAutoModel,
}: {
    model: ModelInfo;
    effort: ReasoningEffort;
    resolvedAutoModel?: ModelInfo | null;
}) => {
    const isAuto = model.id === "auto" || model.id === "openrouter/auto";
    const ctx = formatContextWindow(
        isAuto && resolvedAutoModel?.contextWindow
            ? resolvedAutoModel.contextWindow
            : model.contextWindow,
    );
    const effortName = effortDisplayLabel(effort).toLowerCase();

    return (
        <div className="flex flex-col gap-1 min-w-[220px] max-w-[280px] p-3 select-none">
            <div className="text-sm font-medium leading-tight text-text-primary">
                {isAuto ? "Auto" : model.name}
            </div>
            <p className="text-xs leading-snug text-text-secondary">
                {isAuto
                    ? resolvedAutoModel
                        ? `Routes to ${resolvedAutoModel.name} (${resolvedAutoModel.provider}).`
                        : "Picks a fast model for everyday work."
                    : model.description}
            </p>
            {ctx ? (
                <p className="mt-1 text-xs text-text-muted">{ctx} context window</p>
            ) : null}
            <p className="mt-0.5 text-xs italic text-text-muted">
                Version: {effortName} reasoning effort
            </p>
        </div>
    );
};

const ModelItem = ({
    model,
    isSelected,
    onSelect,
    effort,
    resolvedAutoModel,
    disabled = false,
    disabledReason,
}: {
    model: ModelInfo,
    isSelected: boolean,
    onSelect: (id: string) => void,
    effort: ReasoningEffort,
    resolvedAutoModel?: ModelInfo | null,
    disabled?: boolean,
    disabledReason?: string,
}) => {
    const isAuto = model.id === "auto" || model.id === "openrouter/auto";
    const unavailableTooltip =
        disabledReason ??
        "Direct model selection for this model is limited to paid plans. Upgrade to use.";

    return (
        <Tooltip
            side="right"
            align="start"
            sideOffset={6}
            delayDuration={200}
            className="p-0!"
            content={
                disabled ? (
                    <span className="text-xs text-text-muted px-1">{unavailableTooltip}</span>
                ) : (
                    <ModelTooltip
                        model={model}
                        effort={effort}
                        resolvedAutoModel={resolvedAutoModel}
                    />
                )
            }
        >
            <DropdownMenuItem
                onClick={(event) => {
                    if (disabled) {
                        event.preventDefault();
                        return;
                    }
                    onSelect(model.id);
                }}
                onKeyDown={(event) => {
                    if (disabled && (event.key === "Enter" || event.key === " ")) {
                        event.preventDefault();
                    }
                }}
                aria-disabled={disabled || undefined}
                className={cn(
                    "flex items-center cursor-pointer w-full",
                    isSelected && "bg-panel-hover",
                    disabled && "opacity-40 cursor-not-allowed",
                )}
            >
                <div className="flex items-center gap-1.5 w-full min-w-0">
                    {providerIcon(
                        isAuto && resolvedAutoModel
                            ? resolvedAutoModel.id.split("/")[0] || resolvedAutoModel.id
                            : model.id,
                        16,
                    )}
                    <span className="flex-1 truncate font-regular text-sm text-text-primary group-hover:text-text-primary transition-colors">
                        {model.name}
                    </span>
                    {isAuto && resolvedAutoModel ? (
                        <span className="shrink-0 text-xs text-text-muted">
                            {resolvedAutoModel.provider}
                        </span>
                    ) : null}
                    {isSelected && <Icon icon={Checkmark20Regular} className="shrink-0 text-text-primary font-bold" />}
                </div>
            </DropdownMenuItem>
        </Tooltip>
    );
};

// Allowed file extensions for upload
const IMAGE_EXTENSIONS = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'tif', 'avif', 'heic', 'heif'
]);

const CODE_EXTENSIONS = new Set([
    'ts', 'tsx', 'js', 'jsx', 'rs', 'py', 'go', 'java', 'c', 'cpp', 'h', 'hpp',
    'css', 'scss', 'less', 'html', 'xml', 'svg', 'json', 'toml', 'yaml', 'yml',
    'md', 'mdx', 'sh', 'bat', 'ps1', 'rb', 'php', 'swift', 'kt', 'kts', 'dart',
    'lua', 'r', 'sql', 'graphql', 'gql', 'proto', 'dockerfile', 'makefile',
    'gitignore', 'env', 'ini', 'cfg', 'conf', 'txt', 'log', 'csv', 'lock'
]);

/** Binary assets the agent can write into the project (fonts, icons, etc.). */
const ASSET_EXTENSIONS = new Set([
    'ttf', 'otf', 'woff', 'woff2', 'eot',
    'ico', 'icns',
    'pdf',
]);

const VIDEO_EXTENSIONS = new Set([
    'mp4', 'mov', 'webm', 'avi', 'mkv', 'm4v', 'wmv', 'flv', 'mpeg', 'mpg',
]);

const ACCEPT_STRING = [
    ...Array.from(IMAGE_EXTENSIONS).map((ext) => `.${ext}`),
    ...Array.from(CODE_EXTENSIONS).map((ext) => `.${ext}`),
    ...Array.from(ASSET_EXTENSIONS).map((ext) => `.${ext}`),
    ".mp3",
    ".wav",
    ".m4a",
    ".ogg",
    ".flac",
    ".aac",
    ".wma",
].join(",");

function getFileExtension(name: string): string {
    const parts = name.split('.');
    return parts.length > 1 ? (parts.pop() ?? '').toLowerCase() : '';
}

function isCodeFile(file: File): boolean {
    return CODE_EXTENSIONS.has(getFileExtension(file.name));
}

function isAssetFile(file: File): boolean {
    return ASSET_EXTENSIONS.has(getFileExtension(file.name));
}

function isVideoFile(file: File): boolean {
    if (file.type.startsWith("video/")) return true;
    return VIDEO_EXTENSIONS.has(getFileExtension(file.name));
}

function isAllowedFile(file: File): boolean {
    if (isVideoFile(file)) return false;
    return isImageFile(file) || isCodeFile(file) || isAudioFile(file) || isAssetFile(file);
}

function ComposerContextHighlight({ text }: { text: string }) {
    return (
        <span className="relative">
            <span
                aria-hidden
                className="absolute inset-y-0 -inset-x-0.5 rounded-md bg-accent-text-bg"
            />
            <span className="relative text-accent-text">{text}</span>
        </span>
    );
}

const CHAT_MODES = [
    { id: "Code", icon: CodeTextEdit20Filled, color: "#3B82F6", bg: "rgba(59, 130, 246, 0.16)", description: "Build and edit files in the project" },
    { id: "Ask", icon: ChatMultiple20Filled, color: "#22C55E", bg: "rgba(34, 197, 94, 0.16)", description: "Answer questions without making changes" },
    { id: "Plan", icon: CalendarMultiple24Filled, color: "#F97316", bg: "rgba(249, 115, 22, 0.16)", description: "Create a plan before proceeding" },
    { id: "Visual", icon: ColorLine24Filled, color: "#F43F5E", bg: "rgba(244, 63, 94, 0.16)", description: "Design and iterate on the UI" },
    { id: "Review", icon: Incognito24Filled, color: "#A855F7", bg: "rgba(168, 85, 247, 0.16)", description: "Review code for bugs and edge cases" },
] as const;

const IDLE_COMPOSER_HINTS = [
    "Ask a task. @ for files, / for workflows.",
    "Drop a screenshot or file to inspect",
    "Paste a stack trace to debug",
    "Visual: ask to compare UI directions",
] as const;

const SETUP_COMPOSER_HINTS = [
    "Add an API key in Settings → Providers to chat",
    "Ask a task. @ for files, / for workflows.",
    "Drop a screenshot or file to inspect",
    "Paste a stack trace to debug",
] as const;

const MISSING_MODELS_COMPOSER_HINTS = [
    "Add or import a model ID in Settings → Providers to chat",
    "Ask a task. @ for files, / for workflows.",
    "Drop a screenshot or file to inspect",
] as const;

const ACTIVE_COMPOSER_HINTS = [
    "Queue a follow-up, or press Esc to stop",
    "Type ahead to queue your next message",
] as const;

const PREPARING_COMPOSER_HINT = "Preparing context... Esc to cancel";
const COMPOSER_LINE_HEIGHT = 22;

const RotatingComposerHint = React.memo(function RotatingComposerHint({
    paused,
    mode,
    needsProvider = false,
    missingModels = false,
}: {
    paused: boolean;
    mode: "idle" | "active" | "preparing";
    needsProvider?: boolean;
    missingModels?: boolean;
}) {
    const hints =
        mode === "active"
            ? ACTIVE_COMPOSER_HINTS
            : needsProvider
              ? missingModels
                  ? MISSING_MODELS_COMPOSER_HINTS
                  : SETUP_COMPOSER_HINTS
              : IDLE_COMPOSER_HINTS;
    const modeKey = `${mode}:${needsProvider ? (missingModels ? "models" : "setup") : "ready"}`;
    const [index, setIndex] = React.useState(0);
    const [phase, setPhase] = React.useState<"in" | "out" | "enter">("in");
    const [prevModeKey, setPrevModeKey] = React.useState(modeKey);
    const indexRef = React.useRef(0);

    if (prevModeKey !== modeKey) {
        setPrevModeKey(modeKey);
        setIndex(0);
        setPhase("in");
    }

    const shouldPause = paused || mode === "preparing" || hints.length <= 1;
    if (shouldPause && phase !== "in") setPhase("in");

    React.useLayoutEffect(() => {
        indexRef.current = index;
    }, [index]);

    React.useEffect(() => {
        if (shouldPause) return;
        let exitTimer: ReturnType<typeof setTimeout> | undefined;
        let enterTimer: ReturnType<typeof setTimeout> | undefined;
        const hold = window.setInterval(() => {
            setPhase("out");
            exitTimer = setTimeout(() => {
                const nextIdx = (indexRef.current + 1) % hints.length;
                indexRef.current = nextIdx;
                setIndex(nextIdx);
                setPhase("enter");
                enterTimer = setTimeout(() => setPhase("in"), 30);
            }, 300);
        }, 8000);
        return () => {
            window.clearInterval(hold);
            if (exitTimer) clearTimeout(exitTimer);
            if (enterTimer) clearTimeout(enterTimer);
        };
    }, [shouldPause, hints.length]);

    const label =
        mode === "preparing"
            ? PREPARING_COMPOSER_HINT
            : hints[index % hints.length] ?? IDLE_COMPOSER_HINTS[0];

    return (
        <div className="t-composer-hint px-1.5" aria-hidden>
            <span className="t-composer-hint__text" data-phase={phase}>
                {label}
            </span>
        </div>
    );
});

const ModeMenu = React.memo(function ModeMenu({
    selectedMode,
    setSelectedMode,
    disabled,
}: {
    selectedMode: string;
    setSelectedMode: (m: string) => void;
    disabled?: boolean;
}) {
    const selected = CHAT_MODES.find((m) => m.id === selectedMode) ?? CHAT_MODES[0];
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={disabled}>
                <Button
                    variant="ghost"
                    size="xs"
                    disabled={disabled}
                    className={cn(
                        "h-7 shrink-0 rounded-md bg-transparent px-2 font-medium",
                        "transition-[background-color,color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] motion-reduce:transform-none motion-reduce:transition-none",
                        "hover:bg-[var(--btn-hover)] enabled:active:scale-[0.97]",
                        "data-[state=open]:bg-[var(--btn-open)] data-[state=open]:hover:bg-[var(--btn-open-hover)]",
                    )}
                    style={{ color: selected.color }}
                    aria-label={selected.id}
                >
                    <div className="flex items-center gap-1.5 text-sm">
                        <Icon icon={selected.icon} />
                        <SwapText value={selected.id} />
                    </div>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-80 max-w-[calc(100vw-24px)]">
                {CHAT_MODES.map((mode) => (
                    <DropdownMenuItem
                        key={mode.id}
                        onClick={() => setSelectedMode(mode.id)}
                        className="items-start gap-2.5 py-2"
                    >
                        <Icon
                            icon={mode.icon}
                            className="mt-0.5"
                            style={{ color: mode.color }}
                        />
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="text-sm text-text-primary">{mode.id}</span>
                            <span className="text-sm leading-snug text-text-muted">
                                {mode.description}
                            </span>
                        </span>
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
});


export const ChatInput = React.memo(function ChatInput({
    inputValue,
    isLoading,
    isPreparing = false,
    uploadedFiles,
    onInputChange,
    onKeyDown,
    onSendMessage,
    onStopMessage,
    setUploadedFiles,
    addUploadedFiles,
    selectedModel,
    setSelectedModel,
    selectedWorkerModels = [],
    setSelectedWorkerModels,
    multiSelectModels = false,
    hideModeSelect = false,
    selectedMode,
    setSelectedMode,
    reasoningEffort,
    setReasoningEffort,
    pendingEdits = [],
    onAcceptAllEdits,
    onRejectAllEdits,
    onAcceptEdit,
    onRejectEdit,
    taskItems = [],
    queuedMessages = [],
    onEditQueuedMessage,
    onRemoveQueuedMessage,
    onSendQueuedNow,
    projectRuleFiles = [],
    quotedExcerpts,
    onRemoveQuote,
    promptHistory = [],
    // Wired by `features/chat/ui/chat.tsx` but not consumed by any control yet.
    // Kept so the caller's intent survives; `_` marks it as deliberately unread.
    onNewChat: _onNewChat,
    variant = "default",
}: Omit<ChatInputProps, "webSearch" | "setWebSearch" | "handleFileUpload">) {

    const settings = useSettings();
    // Chat needs at least one BYOK provider with at least one routable model; everything else is local.
    const needsSignIn = !hasAnyUsableProvider(settings.ai.providers);
    const { catalog } = useBetterShapeCatalog();
    const allModels = React.useMemo(() => {
        void catalog;
        return resolveChatModels(getCatalogModels());
    }, [catalog]);
    const concreteAllModels = React.useMemo(
        () => allModels.filter((m) => m.id !== "auto"),
        [allModels],
    );
    const missingModelsOnly = React.useMemo(() => {
        if (!needsSignIn || concreteAllModels.length > 0) return false;
        const connections = settings.ai.providers?.connections ?? {};
        return Object.entries(connections).some(([id, conn]) => {
            if (!conn?.enabled) return false;
            if (id === "custom") return Boolean(conn.baseUrl?.trim());
            if (id === "lmstudio" || id === "vllm") return true;
            return Boolean(conn.apiKey?.trim()) || conn.authStyle === "none";
        });
    }, [concreteAllModels.length, needsSignIn, settings.ai.providers]);
    const resolvedAutoModel = React.useMemo(() => {
        if (concreteAllModels.length === 0) return null;
        const wanted = (settings.ai.providers?.defaultModel ?? "").trim();
        if (wanted && wanted !== "auto") {
            const match = concreteAllModels.find((m) => m.id === wanted);
            if (match) return match;
        }
        return concreteAllModels[0] ?? null;
    }, [concreteAllModels, settings.ai.providers]);
    const textareaRef = React.useRef<HTMLTextAreaElement>(null);
    const mentionOverlayRef = React.useRef<HTMLDivElement>(null);
    const composerBoxRef = React.useRef<HTMLDivElement>(null);
    const historyCursorRef = React.useRef<PromptHistoryCursor | null>(null);
    const [sessionSentPrompts, setSessionSentPrompts] = React.useState<string[]>([]);
    const recallablePrompts = React.useMemo(
        () => mergeNewestFirstPrompts(promptHistory, sessionSentPrompts),
        [promptHistory, sessionSentPrompts],
    );
    const [mentionOpen, setMentionOpen] = React.useState(false);
    const [mentionQuery, setMentionQuery] = React.useState("");
    const [mentionCaret, setMentionCaret] = React.useState(0);
    const [slashOpen, setSlashOpen] = React.useState(false);
    const [slashQuery, setSlashQuery] = React.useState("");

    const canRecordPromptHistory = React.useCallback(
        (trimmed: string) => {
            if (!trimmed) return false;
            if (needsSignIn) return false;
            if (uploadedFiles.some((a) => a.status === "processing")) return false;
            if (isLoading && uploadedFiles.length > 0) return false;
            if (/^\/compact\b/i.test(trimmed)) return false;
            return true;
        },
        [isLoading, needsSignIn, uploadedFiles],
    );

    const handleSendWithHistory = React.useCallback(() => {
        const trimmed = inputValue.trim();
        if (canRecordPromptHistory(trimmed)) {
            setSessionSentPrompts((prev) =>
                prev[prev.length - 1] === trimmed ? prev : [...prev.slice(-49), trimmed],
            );
        }
        historyCursorRef.current = null;
        onSendMessage();
    }, [canRecordPromptHistory, inputValue, onSendMessage]);

    const handleInputChangeWithMentions = React.useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        historyCursorRef.current = null;
        const raw = e.target.value;
        const caretRaw = e.target.selectionStart ?? raw.length;
        const shortened = shortenMentionTokensInText(raw);
        const delta = raw.length - shortened.length;
        const caret = Math.max(0, caretRaw - (delta > 0 && caretRaw > shortened.length ? delta : 0));
        // If we collapsed a long path token, rewrite value + restore caret near the edit.
        if (shortened !== raw) {
            onInputChange({ target: { value: shortened } } as React.ChangeEvent<HTMLTextAreaElement>);
            requestAnimationFrame(() => {
                const el = textareaRef.current;
                if (!el) return;
                const pos = Math.min(caret, shortened.length);
                el.setSelectionRange(pos, pos);
            });
        } else {
            onInputChange(e);
        }
        const val = shortened;
        const caretNow = shortened !== raw ? Math.min(caret, shortened.length) : caretRaw;
        const before = val.slice(0, caretNow);
        // Allow hostnames / paths after @ (sites, files), requiring a leading boundary so emails do not trigger @.
        const atMatch = before.match(/(?:^|[\s([{"'])@([\w./:-]*)$/);
        const slashMatch = before.match(/(?:^|\s)(\/[^\s]*)$/);
        if (atMatch) {
            const atStart = before.lastIndexOf("@");
            setMentionOpen(true);
            setMentionQuery(atMatch[1] ?? "");
            setMentionCaret(Math.max(0, atStart));
            setSlashOpen(false);
            setSlashQuery("");
        } else if (slashMatch) {
            setSlashOpen(true);
            setSlashQuery((slashMatch[1] ?? "/").replace(/^\//, ""));
            setMentionOpen(false);
            setMentionQuery("");
        } else {
            setMentionOpen(false);
            setMentionQuery("");
            setSlashOpen(false);
            setSlashQuery("");
        }
    }, [onInputChange]);

    // Collapse any long path mentions already in the composer (e.g. pasted / leftover).
    React.useEffect(() => {
        const shortened = shortenMentionTokensInText(inputValue);
        if (shortened !== inputValue) {
            onInputChange({ target: { value: shortened } } as React.ChangeEvent<HTMLTextAreaElement>);
        }
    }, [inputValue, onInputChange]);

    const insertMention = React.useCallback((token: string) => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        const val = inputValue;
        const caret = textarea.selectionStart ?? val.length;
        const before = val.slice(0, caret);
        const after = val.slice(caret);
        const atIndex = before.lastIndexOf("@");
        if (atIndex === -1) return;
        const next = `${before.slice(0, atIndex)}${token}${after}`;
        onInputChange({ target: { value: next } } as React.ChangeEvent<HTMLTextAreaElement>);
        setMentionOpen(false);
        setMentionQuery("");
        setSlashOpen(false);
        requestAnimationFrame(() => textarea.focus());
    }, [inputValue, onInputChange]);

    const appendToken = React.useCallback((token: string) => {
        const textarea = textareaRef.current;
        const val = inputValue;
        const caret = textarea?.selectionStart ?? val.length;
        const before = val.slice(0, caret);
        const after = val.slice(caret);
        const pad = before.length > 0 && !/\s$/.test(before) ? " " : "";
        const next = `${before}${pad}${token} ${after.replace(/^\s/, "")}`;
        onInputChange({ target: { value: next } } as React.ChangeEvent<HTMLTextAreaElement>);
        requestAnimationFrame(() => textarea?.focus());
    }, [inputValue, onInputChange]);

    const insertSlash = React.useCallback((token: string) => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        const val = inputValue;
        const caret = textarea.selectionStart ?? val.length;
        const before = val.slice(0, caret);
        const after = val.slice(caret);
        const slashIndex = before.lastIndexOf("/");
        if (slashIndex === -1) return;
        const next = `${before.slice(0, slashIndex)}${token}${after}`;
        onInputChange({ target: { value: next } } as React.ChangeEvent<HTMLTextAreaElement>);
        setSlashOpen(false);
        setSlashQuery("");
        requestAnimationFrame(() => textarea.focus());
    }, [inputValue, onInputChange]);

    const [composerTall, setComposerTall] = React.useState(false);
    const [isExpanded, setIsExpanded] = React.useState(false);
    const [canExpandComposer, setCanExpandComposer] = React.useState(false);
    const [isEditorFocused, setIsEditorFocused] = React.useState(false);
    const [editorHeight, setEditorHeight] = React.useState(COMPOSER_LINE_HEIGHT);
    const [localQuotes, setLocalQuotes] = React.useState<QuotedExcerpt[]>([]);
    const [scrollMask, setScrollMask] = React.useState<{ top: boolean; bottom: boolean }>({
        top: false,
        bottom: false,
    });
    const composerTallRef = React.useRef(false);
    const lastAppliedHeightRef = React.useRef<number>(0);
    const textareaClientWidthRef = React.useRef<number>(0);
    const composerBoxWidthRef = React.useRef<number>(0);
    const stageHeightRef = React.useRef<number>(760);

    React.useEffect(() => {
        if (typeof window === "undefined") return undefined;
        const tauri = (
            window as unknown as {
                __TAURI_INTERNALS__?: { invoke?: unknown; transformCallback?: unknown };
            }
        ).__TAURI_INTERNALS__;
        if (!tauri || typeof tauri.invoke !== "function" || typeof tauri.transformCallback !== "function") {
            return undefined;
        }
        let projectPath: string | null;
        try {
            projectPath = getProjectPath();
        } catch {
            projectPath = null;
        }
        return warmComposerResources(projectPath);
    }, []);

    const activeQuotes = quotedExcerpts ?? localQuotes;
    const handleRemoveQuote = React.useCallback(
        (id: string) => {
            if (onRemoveQuote) onRemoveQuote(id);
            else setLocalQuotes((prev) => prev.filter((q) => q.id !== id));
        },
        [onRemoveQuote],
    );

    React.useEffect(() => {
        if (quotedExcerpts !== undefined) return undefined;
        let focusRaf = 0;
        const onQuote = (e: Event) => {
            const detail = (e as CustomEvent<{ id?: string; text?: string }>).detail;
            const text = detail?.text?.trim();
            if (!text) return;
            const id = detail?.id || `${Date.now()}`;
            setLocalQuotes((prev) =>
                prev.some((q) => q.text === text) ? prev : [...prev.slice(-7), { id, text }],
            );
            if (focusRaf) cancelAnimationFrame(focusRaf);
            focusRaf = requestAnimationFrame(() => {
                focusRaf = 0;
                textareaRef.current?.focus();
            });
        };
        window.addEventListener("bettershape-chat-quote-selection", onQuote as EventListener);
        return () => {
            if (focusRaf) cancelAnimationFrame(focusRaf);
            window.removeEventListener("bettershape-chat-quote-selection", onQuote as EventListener);
        };
    }, [quotedExcerpts]);

    const onComposerKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "e") {
            if (canExpandComposer || isExpanded || (Boolean(inputValue) && composerTall)) {
                e.preventDefault();
                setIsExpanded((prev) => !prev);
                return;
            }
        }
        if (e.defaultPrevented) {
            return;
        }
        if ((mentionOpen || slashOpen) && e.key === "Escape") {
            e.preventDefault();
            setMentionOpen(false);
            setSlashOpen(false);
            return;
        }
        if (
            !e.metaKey &&
            !e.ctrlKey &&
            !e.altKey &&
            !e.shiftKey &&
            !e.nativeEvent.isComposing &&
            e.key === "ArrowUp"
        ) {
            // Claude Code parity: while messages are queued and the composer is empty,
            // ArrowUp pops the latest queued message back into the editor for quick edits.
            if (inputValue.length === 0 && queuedMessages.length > 0 && onEditQueuedMessage) {
                const lastQueued = queuedMessages.at(-1);
                if (lastQueued) {
                    e.preventDefault();
                    onEditQueuedMessage(lastQueued.id);
                    return;
                }
            }
            const el = e.currentTarget;
            if (
                recallablePrompts.length > 0 &&
                canStepPromptHistoryUp(
                    historyCursorRef.current,
                    inputValue,
                    el.selectionStart,
                    el.selectionEnd,
                )
            ) {
                const stepped = stepPromptHistoryUp(historyCursorRef.current, inputValue, recallablePrompts);
                if (stepped) {
                    e.preventDefault();
                    historyCursorRef.current = stepped.cursor;
                    onInputChange({ target: { value: stepped.value } } as React.ChangeEvent<HTMLTextAreaElement>);
                    requestAnimationFrame(() => {
                        const node = textareaRef.current;
                        if (!node) return;
                        node.setSelectionRange(stepped.value.length, stepped.value.length);
                    });
                    return;
                }
            }
        }
        if (
            !e.metaKey &&
            !e.ctrlKey &&
            !e.altKey &&
            !e.shiftKey &&
            !e.nativeEvent.isComposing &&
            e.key === "ArrowDown" &&
            historyCursorRef.current !== null
        ) {
            if (!isUnmodifiedHistoryRecall(historyCursorRef.current, inputValue)) {
                historyCursorRef.current = null;
            } else {
                const el = e.currentTarget;
                if (isCaretOnLastLogicalLine(inputValue, el.selectionStart, el.selectionEnd)) {
                    const stepped = stepPromptHistoryDown(historyCursorRef.current, recallablePrompts);
                    if (stepped) {
                        e.preventDefault();
                        historyCursorRef.current = stepped.cursor;
                        onInputChange({ target: { value: stepped.value } } as React.ChangeEvent<HTMLTextAreaElement>);
                        requestAnimationFrame(() => {
                            const node = textareaRef.current;
                            if (!node) return;
                            node.setSelectionRange(stepped.value.length, stepped.value.length);
                        });
                        return;
                    }
                }
            }
        }
        if (
            !e.metaKey &&
            !e.ctrlKey &&
            !e.altKey &&
            !isLoading &&
            !isPreparing &&
            e.key === "Escape" &&
            historyCursorRef.current !== null
        ) {
            if (!isUnmodifiedHistoryRecall(historyCursorRef.current, inputValue)) {
                historyCursorRef.current = null;
            } else {
                e.preventDefault();
                const restored = historyCursorRef.current.stashedDraft;
                historyCursorRef.current = null;
                onInputChange({ target: { value: restored } } as React.ChangeEvent<HTMLTextAreaElement>);
                requestAnimationFrame(() => {
                    const node = textareaRef.current;
                    if (!node) return;
                    node.setSelectionRange(restored.length, restored.length);
                });
                return;
            }
        }
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            const trimmed = inputValue.trim();
            if (canRecordPromptHistory(trimmed)) {
                setSessionSentPrompts((prev) =>
                    prev[prev.length - 1] === trimmed ? prev : [...prev.slice(-49), trimmed],
                );
            }
            historyCursorRef.current = null;
        }
        onKeyDown(e);
    }, [
        canExpandComposer,
        canRecordPromptHistory,
        composerTall,
        inputValue,
        isExpanded,
        isLoading,
        isPreparing,
        mentionOpen,
        onEditQueuedMessage,
        onInputChange,
        onKeyDown,
        queuedMessages,
        recallablePrompts,
        slashOpen,
    ]);

    const effectiveModelId =
        selectedModel === "auto" && resolvedAutoModel ? resolvedAutoModel.id : selectedModel;

    React.useEffect(() => {
        if (reasoningEffort === "super" && !modelSupportsSuperThinking(effectiveModelId)) {
            setReasoningEffort("max");
        }
    }, [effectiveModelId, reasoningEffort, setReasoningEffort]);

    const syncEditorLayout = React.useCallback(
        (revealCaretEnd = false) => {
            const textarea = textareaRef.current;
            if (!textarea) return;
            const line = COMPOSER_LINE_HEIGHT;
            const hasNewline = inputValue.includes("\n");

            // O(1) zero-reflow fast path for short single-line ASCII prompts that cannot wrap.
            const knownWidth = textareaClientWidthRef.current;
            const safeSingleLineChars =
                knownWidth > 96 ? Math.max(12, Math.floor((knownWidth - 26) / 8.8)) : 16;
            const canUseSingleLineFastPath =
                !isExpanded
                && !composerTallRef.current
                && !hasNewline
                && inputValue.length <= safeSingleLineChars
                && !/[^\x20-\x7e]/.test(inputValue);

            if (canUseSingleLineFastPath) {
                composerTallRef.current = false;
                if (lastAppliedHeightRef.current !== line) {
                    lastAppliedHeightRef.current = line;
                    textarea.style.height = `${line}px`;
                    textarea.style.overflowY = "hidden";
                    textarea.style.overflowX = "hidden";
                }
                setComposerTall((prev) => (prev ? false : prev));
                setEditorHeight((prev) => (prev === line ? prev : line));
                setCanExpandComposer((prev) => (prev ? false : prev));
                setScrollMask((prev) => (prev.top || prev.bottom ? { top: false, bottom: false } : prev));
                return;
            }

            const stageH =
                stageHeightRef.current > 180
                    ? stageHeightRef.current
                    : typeof window !== "undefined" && window.innerHeight > 180
                      ? window.innerHeight
                      : 760;
            const compactMax = Math.min(220, Math.max(96, stageH - 132));
            const expandedMax = Math.max(
                compactMax + 44,
                Math.min(Math.round(stageH * 0.6), 420),
            );
            const expandedFloor = Math.min(expandedMax, 280);
            const max = isExpanded ? expandedMax : compactMax;

            const prevScrollTop = textarea.scrollTop;
            textarea.style.height = "0px";
            const content = textarea.scrollHeight;
            const measuredWidth = textarea.clientWidth;
            if (measuredWidth > 0) {
                textareaClientWidthRef.current = measuredWidth;
            }

            const tall = Boolean(inputValue) && (hasNewline || content > line + 2);
            composerTallRef.current = tall;
            const rawTarget = Math.min(Math.max(content, line), max);
            const next = isExpanded ? Math.max(rawTarget, expandedFloor) : tall ? rawTarget : line;
            lastAppliedHeightRef.current = next;
            textarea.style.height = `${next}px`;
            textarea.style.overflowY = content > max ? "auto" : "hidden";
            textarea.style.overflowX = "hidden";

            const caretAtEnd =
                revealCaretEnd && (textarea.selectionStart ?? inputValue.length) >= inputValue.length;
            const maxScrollTop = Math.max(0, content - next);
            const effectiveScrollTop =
                caretAtEnd && content > next
                    ? maxScrollTop
                    : Math.min(prevScrollTop, maxScrollTop);
            textarea.scrollTop = effectiveScrollTop;

            setComposerTall((prev) => (prev === tall ? prev : tall));
            setEditorHeight((prev) => (prev === next ? prev : next));

            const nextCanExpand = Boolean(inputValue) && content >= line * 3 - 2;
            setCanExpandComposer((prev) => (prev === nextCanExpand ? prev : nextCanExpand));

            syncComposerOverlayScroll(
                {
                    scrollLeft: 0,
                    scrollTop: effectiveScrollTop,
                    clientWidth: measuredWidth > 0 ? measuredWidth : undefined,
                },
                mentionOverlayRef.current,
            );
            const nextMask = computeComposerScrollMask({
                scrollTop: effectiveScrollTop,
                scrollHeight: content,
                clientHeight: next,
            });
            setScrollMask((prev) =>
                prev.top === nextMask.top && prev.bottom === nextMask.bottom ? prev : nextMask,
            );
        },
        [inputValue, isExpanded],
    );

    const syncEditorLayoutRef = React.useRef(syncEditorLayout);
    React.useLayoutEffect(() => {
        syncEditorLayoutRef.current = syncEditorLayout;
    }, [syncEditorLayout]);

    if (!inputValue && isExpanded) {
        setIsExpanded(false);
    }

    React.useLayoutEffect(() => {
        syncEditorLayout(true);
    }, [syncEditorLayout]);

    React.useEffect(() => {
        const box = composerBoxRef.current;
        if (!box || typeof ResizeObserver === "undefined") return undefined;
        const stageEl = box.closest<HTMLElement>("[data-chat-stage]");
        if (stageEl && stageEl.clientHeight > 180) {
            stageHeightRef.current = stageEl.clientHeight;
        }
        const ta = textareaRef.current;
        if (ta && ta.clientWidth > 0) {
            textareaClientWidthRef.current = ta.clientWidth;
        }
        composerBoxWidthRef.current = box.clientWidth;

        const observer = new ResizeObserver((entries) => {
            let shouldSync = false;
            for (const entry of entries) {
                if (entry.target === stageEl) {
                    const h = entry.contentRect.height;
                    if (h > 180 && Math.abs(h - stageHeightRef.current) > 1) {
                        stageHeightRef.current = h;
                        shouldSync = true;
                    }
                } else if (entry.target === box) {
                    const w = entry.contentRect.width;
                    if (Math.abs(w - composerBoxWidthRef.current) > 0.5) {
                        composerBoxWidthRef.current = w;
                        if (textareaRef.current && textareaRef.current.clientWidth > 0) {
                            textareaClientWidthRef.current = textareaRef.current.clientWidth;
                        }
                        shouldSync = true;
                    }
                } else if (entry.target === ta) {
                    const tw = entry.contentRect.width;
                    if (tw > 0 && Math.abs(tw - textareaClientWidthRef.current) > 0.5) {
                        textareaClientWidthRef.current = tw;
                        shouldSync = true;
                    }
                }
            }
            if (shouldSync) {
                syncEditorLayoutRef.current(false);
            }
        });
        observer.observe(box);
        if (ta) observer.observe(ta);
        if (stageEl) observer.observe(stageEl);
        return () => observer.disconnect();
    }, []);

    React.useEffect(() => {
        let caretRaf = 0;
        const onFocusInput = (e: Event) => {
            const detail = (e as CustomEvent<{ caretEnd?: boolean } | undefined>).detail;
            const el = textareaRef.current;
            if (!el) return;
            el.focus();
            if (detail?.caretEnd) {
                if (caretRaf) cancelAnimationFrame(caretRaf);
                caretRaf = requestAnimationFrame(() => {
                    caretRaf = 0;
                    const node = textareaRef.current;
                    if (!node) return;
                    const len = node.value.length;
                    node.setSelectionRange(len, len);
                });
            }
        };
        window.addEventListener("bettershape-chat-focus-input", onFocusInput as EventListener);
        return () => {
            if (caretRaf) cancelAnimationFrame(caretRaf);
            window.removeEventListener("bettershape-chat-focus-input", onFocusInput as EventListener);
        };
    }, []);

    React.useEffect(() => {
        if (!isLoading && !isPreparing) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
            if (mentionOpen || slashOpen) return;
            const t = e.target instanceof HTMLElement ? e.target : null;
            if (t?.closest(".cm-editor, [role='dialog']")) return;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA") && t !== textareaRef.current) {
                return;
            }
            e.preventDefault();
            onStopMessage();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [isLoading, isPreparing, mentionOpen, slashOpen, onStopMessage]);

    const inputValueRef = React.useRef(inputValue);
    React.useLayoutEffect(() => {
        inputValueRef.current = inputValue;
    }, [inputValue]);

    const swapAttachmentInline = React.useCallback(
        (targetFile: File, rawText: string) => {
            setUploadedFiles((prev) => prev.filter((att) => att.file !== targetFile));
            const cur = inputValueRef.current;
            const pad = cur.trim().length > 0 ? `${cur.trimEnd()}\n\n` : "";
            const next = `${pad}${rawText}`;
            onInputChange({
                target: { value: next },
            } as React.ChangeEvent<HTMLTextAreaElement>);
            requestAnimationFrame(() => {
                const node = textareaRef.current;
                if (!node) return;
                node.focus();
                node.setSelectionRange(next.length, next.length);
            });
        },
        [onInputChange, setUploadedFiles],
    );

    // Files stay files. Huge text, terminal copies, and editor selections become attachments.
    const handlePaste = React.useCallback((e: React.ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        let hadFileItem = false;
        const filesToAdd: File[] = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === "file") {
                hadFileItem = true;
                const file = item.getAsFile();
                if (file && isAllowedFile(file)) {
                    filesToAdd.push(file);
                }
            }
        }

        if (filesToAdd.length > 0) {
            e.preventDefault();
            addUploadedFiles(filesToAdd);
            notify.info(
                filesToAdd.length === 1
                    ? "Pasted from clipboard"
                    : `Pasted ${filesToAdd.length} files`,
                filesToAdd.length === 1
                    ? filesToAdd[0].name || "Clipboard media attached to your message."
                    : filesToAdd
                          .map((f) => f.name)
                          .filter(Boolean)
                          .slice(0, 3)
                          .join(", "),
            );
            return;
        }

        const text = e.clipboardData.getData("text/plain");
        if (!text) {
            if (hadFileItem) {
                e.preventDefault();
                notify.warning(
                    "Unsupported clipboard file",
                    "That clipboard file format cannot be attached here.",
                );
            }
            return;
        }
        const remembered = matchRememberedClip(text);
        if (e.clipboardData.types.includes("application/x-bettershape-terminal") || remembered?.kind === "terminal") {
            e.preventDefault();
            const file = terminalAttachmentFile(text, remembered?.label);
            addUploadedFiles([file]);
            notify.info(
                "Terminal output attached",
                remembered?.label
                    ? `Attached selection from ${remembered.label}.`
                    : `${formatPasteSizeLabel(text)} attached to your message.`,
                text.length <= 24_000
                    ? {
                          action: {
                              label: "Insert inline",
                              onClick: () => swapAttachmentInline(file, text),
                          },
                      }
                    : undefined,
            );
            return;
        }
        if (e.clipboardData.types.includes(BETTERSHAPE_CLIP_CODE) || remembered?.kind === "code") {
            e.preventDefault();
            const raw = e.clipboardData.getData(BETTERSHAPE_CLIP_CODE);
            let path = remembered?.label || "selection.ts";
            try {
                const parsed = JSON.parse(raw) as { path?: string };
                if (parsed?.path) path = parsed.path;
            } catch {
                /* plain text is enough */
            }
            const file = codeAttachmentFile(text, path);
            addUploadedFiles([file]);
            notify.info(
                "Code selection attached",
                `Attached ${file.name} (${formatPasteSizeLabel(text)}).`,
                text.length <= 24_000
                    ? {
                          action: {
                              label: "Insert inline",
                              onClick: () => swapAttachmentInline(file, text),
                          },
                      }
                    : undefined,
            );
            return;
        }
        if (pasteIsLarge(text)) {
            e.preventDefault();
            const file = pastedTextFile(text);
            addUploadedFiles([file]);
            notify.info(
                "Pasted as attachment",
                `${formatPasteSizeLabel(text)} attached to keep the composer tidy.`,
                text.length <= 24_000
                    ? {
                          action: {
                              label: "Insert inline",
                              onClick: () => swapAttachmentInline(file, text),
                          },
                      }
                    : undefined,
            );
            return;
        }
        const textarea = textareaRef.current;
        if (textarea) {
            const wrapped = tryWrapMarkdownLinkOnPaste(
                inputValue,
                textarea.selectionStart,
                textarea.selectionEnd,
                text,
            );
            if (wrapped) {
                e.preventDefault();
                insertTextareaRangeWithUndo(
                    textarea,
                    wrapped.start,
                    wrapped.end,
                    wrapped.replacement,
                    wrapped.nextValue,
                    (nextValue, nextCaret) => {
                        onInputChange({
                            target: { value: nextValue },
                        } as React.ChangeEvent<HTMLTextAreaElement>);
                        requestAnimationFrame(() => {
                            const node = textareaRef.current;
                            if (!node) return;
                            node.focus();
                            node.setSelectionRange(nextCaret, nextCaret);
                        });
                    },
                );
                notify.info(
                    "Formatted as Markdown link",
                    "Press Ctrl/Cmd+Z to keep the raw URL.",
                );
            }
        }
    }, [addUploadedFiles, inputValue, onInputChange, swapAttachmentInline]);

    const [dragOver, setDragOver] = React.useState(false);
    const dragDepth = React.useRef(0);

    const handleDrop = React.useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragDepth.current = 0;
        setDragOver(false);
        const codePayload = e.dataTransfer.getData(BETTERSHAPE_CLIP_CODE);
        if (codePayload) {
            try {
                const parsed = JSON.parse(codePayload) as { path?: string; text?: string };
                if (parsed.text) {
                    const file = codeAttachmentFile(parsed.text, parsed.path || "selection.ts");
                    addUploadedFiles([file]);
                    notify.info("Code selection attached", `Attached ${file.name}.`);
                    return;
                }
            } catch {
                /* fall through to files */
            }
        }
        const rawFiles = Array.from(e.dataTransfer.files);
        const files = rawFiles.filter(isAllowedFile);
        if (files.length > 0) {
            addUploadedFiles(files);
            notify.info(
                files.length === 1 ? "Attached dropped file" : `Attached ${files.length} files`,
                files.length === 1
                    ? files[0].name
                    : files
                          .map((f) => f.name)
                          .slice(0, 3)
                          .join(", "),
            );
        } else if (rawFiles.length > 0) {
            notify.warning(
                "Unsupported file format",
                "That dropped file format cannot be attached here.",
            );
        } else {
            const droppedText = e.dataTransfer.getData("text/plain");
            if (droppedText) {
                const el = textareaRef.current;
                const current = el ? el.value : inputValue;
                const start = el ? el.selectionStart : current.length;
                const end = el ? el.selectionEnd : current.length;
                const nextValue = `${current.slice(0, start)}${droppedText}${current.slice(end)}`;
                if (el) {
                    insertTextareaRangeWithUndo(
                        el,
                        start,
                        end,
                        droppedText,
                        nextValue,
                        (fallbackVal, nextCaret) => {
                            onInputChange({
                                target: { value: fallbackVal },
                            } as React.ChangeEvent<HTMLTextAreaElement>);
                            requestAnimationFrame(() => {
                                el.focus();
                                el.setSelectionRange(nextCaret, nextCaret);
                            });
                        },
                    );
                } else {
                    onInputChange({
                        target: { value: nextValue },
                    } as React.ChangeEvent<HTMLTextAreaElement>);
                }
            }
        }
    }, [addUploadedFiles, inputValue, onInputChange]);

    const handleDragEnter = React.useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragDepth.current += 1;
        const types = e.dataTransfer.types;
        if (types.includes("Files") || types.includes(BETTERSHAPE_CLIP_CODE)) setDragOver(true);
    }, []);

    const handleDragLeave = React.useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragOver(false);
    }, []);

    const handleDragOver = React.useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    // Elements picked in the Browser tab become @element mentions at the caret.
    React.useEffect(() => {
        let focusRaf = 0;
        const onElement = (e: Event) => {
            const detail = (e as CustomEvent<BrowserPickedElement>).detail;
            if (!detail?.tag) return;
            const token = registerElementMention(detail);
            const textarea = textareaRef.current;
            const val = inputValue;
            const caret = textarea?.selectionStart ?? val.length;
            const before = val.slice(0, caret);
            const after = val.slice(caret);
            const lead = before && !/\s$/.test(before) ? " " : "";
            const trail = after && !/^\s/.test(after) ? " " : after ? "" : " ";
            const next = `${before}${lead}${token}${trail}${after}`;
            onInputChange({ target: { value: next } } as React.ChangeEvent<HTMLTextAreaElement>);
            const pos = before.length + lead.length + token.length + trail.length;
            if (focusRaf) cancelAnimationFrame(focusRaf);
            focusRaf = requestAnimationFrame(() => {
                focusRaf = 0;
                textarea?.focus();
                textarea?.setSelectionRange(pos, pos);
            });
        };
        window.addEventListener("bettershape-chat-attach-element", onElement as EventListener);
        return () => {
            if (focusRaf) cancelAnimationFrame(focusRaf);
            window.removeEventListener("bettershape-chat-attach-element", onElement as EventListener);
        };
    }, [inputValue, onInputChange]);

    // External surfaces (e.g. Terminal selection) can attach files directly into the composer.
    React.useEffect(() => {
        let focusRaf = 0;
        const onAttachFiles = (e: Event) => {
            const detail = (e as CustomEvent<{ files?: File[]; prompt?: string }>).detail;
            const incoming = (detail?.files ?? []).filter(Boolean);
            if (incoming.length > 0) {
                addUploadedFiles(incoming);
            }
            if (detail?.prompt) {
                const pad = inputValue.trim().length > 0 ? `${inputValue.trimEnd()}\n` : "";
                const next = `${pad}${detail.prompt}`;
                onInputChange({ target: { value: next } } as React.ChangeEvent<HTMLTextAreaElement>);
            }
            if (focusRaf) cancelAnimationFrame(focusRaf);
            focusRaf = requestAnimationFrame(() => {
                focusRaf = 0;
                textareaRef.current?.focus();
            });
        };
        window.addEventListener("bettershape-chat-attach-files", onAttachFiles as EventListener);
        return () => {
            if (focusRaf) cancelAnimationFrame(focusRaf);
            window.removeEventListener("bettershape-chat-attach-files", onAttachFiles as EventListener);
        };
    }, [addUploadedFiles, inputValue, onInputChange]);

    // Filter file uploads to only allowed types
    const handleFilteredFileUpload = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const allowed = Array.from(e.target.files).filter(isAllowedFile);
            if (allowed.length > 0) {
                addUploadedFiles(allowed);
            }
        }
        // Reset input so same file can be re-selected
        e.target.value = "";
    }, [addUploadedFiles]);

    const [modelMenuOpen, setModelMenuOpen] = React.useState(false);
    const [plusMenuOpen, setPlusMenuOpen] = React.useState(false);
    const [modelQuery, setModelQuery] = React.useState("");
    const MODELS = React.useMemo(() => {
        const enabled = sanitizeEnabledModels(
            settings.ai.enabledModels,
            allModels.map((m) => m.id),
            getCatalogDefaultEnabledIds(),
        );
        return getVisibleModels(allModels, enabled);
    }, [allModels, settings.ai.enabledModels]);
    const autoModel = React.useMemo(
        () =>
            allModels.find((m) => m.id === "auto") ?? {
                id: "auto",
                name: "Auto",
                description: "Picks a fast model for everyday work.",
                provider: "Auto",
                inputCost: 0,
                cachedInputCost: 0,
                outputCost: 0,
                contextWindow: "200K",
                releaseDate: "Rolling",
            },
        [allModels],
    );
    const modelInfo = MODELS.find((m) => m.id === selectedModel) || autoModel;
    const isAutoSelected = selectedModel === "auto" || modelInfo.name === "auto";
    const workerExtra = multiSelectModels
        ? selectedWorkerModels.filter((id) => id && id !== selectedModel)
        : [];
    const modelNameBase = isAutoSelected
        ? resolvedAutoModel
            ? `Auto · ${resolvedAutoModel.provider}`
            : "Auto"
        : modelInfo.name;
    const modelName =
        multiSelectModels && workerExtra.length > 0
            ? `${modelNameBase} +${workerExtra.length}`
            : modelNameBase;
    const activeTriggerIconId = isAutoSelected
        ? resolvedAutoModel
            ? resolvedAutoModel.id.split("/")[0] || resolvedAutoModel.id
            : "auto"
        : modelInfo.id;
    const providerOrder = React.useMemo(() => {
        const seen = new Set<string>();
        const order: string[] = [];
        for (const p of getCatalogProviderOrder()) {
            if (seen.has(p)) continue;
            seen.add(p);
            order.push(p);
        }
        for (const m of allModels) {
            if (seen.has(m.provider)) continue;
            seen.add(m.provider);
            order.push(m.provider);
        }
        return order;
    }, [allModels]);
    const modelSearch = modelQuery.trim().toLowerCase();
    const modelMatches = (m: { id: string; name: string; provider: string }) => {
        if (!modelSearch) return true;
        return (
            m.name.toLowerCase().includes(modelSearch) ||
            m.id.toLowerCase().includes(modelSearch) ||
            m.provider.toLowerCase().includes(modelSearch)
        );
    };

    const [plusPlugins, setPlusPlugins] = React.useState<PluginRow[]>(() => peekPluginsCache()?.plugins ?? []);
    const [pluginQuery, setPluginQuery] = React.useState("");
    const [skills, setSkills] = React.useState<Skill[]>(() => listSkills());
    React.useEffect(() => subscribeSkills(() => setSkills(listSkills())), []);

    const concreteModels = React.useMemo(
        () => MODELS.filter((m) => m.id !== "auto"),
        [MODELS],
    );
    React.useEffect(() => {
        if (selectedModel === "auto") return;
        if (concreteModels.length === 0) return;
        if (!concreteModels.some((m) => m.id === selectedModel)) {
            setSelectedModel("auto");
        }
    }, [concreteModels, selectedModel, setSelectedModel]);

    const [mediaViewer, setMediaViewer] = React.useState<{
        src?: string;
        title?: string;
        kind: "image" | "html";
    } | null>(null);

    React.useEffect(() => {
        const onOpen = (e: Event) => {
            const detail = (e as CustomEvent<{ src: string; title?: string; kind?: "image" | "html" }>).detail;
            if (!detail?.src) return;
            setMediaViewer({
                src: detail.src,
                title: detail.title,
                kind: detail.kind || "image",
            });
        };
        window.addEventListener("bettershape-open-media", onOpen as EventListener);
        return () => {
            window.removeEventListener("bettershape-open-media", onOpen as EventListener);
        };
    }, []);

    React.useEffect(() => {
        let focusRaf = 0;
        const onDictation = (e: Event) => {
            const text = (e as CustomEvent<{ text?: string }>).detail?.text;
            if (!text) return;
            const textarea = textareaRef.current;
            const val = inputValue;
            const caret = textarea?.selectionStart ?? val.length;
            const before = val.slice(0, caret);
            const after = val.slice(caret);
            const pad = before.length > 0 && !/\s$/.test(before) ? " " : "";
            const next = `${before}${pad}${text}${after.replace(/^\s/, "")}`;
            onInputChange({ target: { value: next } } as React.ChangeEvent<HTMLTextAreaElement>);
            if (focusRaf) cancelAnimationFrame(focusRaf);
            focusRaf = requestAnimationFrame(() => {
                focusRaf = 0;
                textarea?.focus();
            });
        };
        window.addEventListener("bettershape-dictation-text", onDictation as EventListener);
        return () => {
            if (focusRaf) cancelAnimationFrame(focusRaf);
            window.removeEventListener("bettershape-dictation-text", onDictation as EventListener);
        };
    }, [inputValue, onInputChange]);

    const hasContextStrip =
        (pendingEdits?.length ?? 0) > 0 ||
        queuedMessages.length > 0 ||
        projectRuleFiles.length > 0 ||
        taskItems.length > 0;

    const canStop = isPreparing || (isLoading && !inputValue.trim() && activeQuotes.length === 0);
    const attachmentsProcessing = uploadedFiles.some((a) => a.status === "processing");
    const queueBlockedByAttachments = isLoading && uploadedFiles.length > 0;
    const hasSendablePayload =
        Boolean(inputValue.trim()) || uploadedFiles.length > 0 || activeQuotes.length > 0;
    const sendDisabled =
        !canStop
        && (needsSignIn || attachmentsProcessing || queueBlockedByAttachments || !hasSendablePayload);
    const sendActive =
        canStop
        || (!needsSignIn
            && !queueBlockedByAttachments
            && (hasSendablePayload || isLoading)
            && !attachmentsProcessing);
    const hasContextAttachments = uploadedFiles.length > 0 || activeQuotes.length > 0;
    const isExpandedLayout = composerTall || isExpanded || hasContextAttachments;
    const showExpandButton = canExpandComposer || isExpanded;
    const hasThreeOrMoreNewlines = React.useMemo(() => {
        let nl = 0;
        for (let i = 0; i < inputValue.length; i++) {
            if (inputValue.charCodeAt(i) === 10 && ++nl >= 2) return true;
        }
        return false;
    }, [inputValue]);
    const vesselRadiusClass =
        isExpanded
        || hasContextAttachments
        || hasThreeOrMoreNewlines
        || editorHeight >= COMPOSER_LINE_HEIGHT * 3 - 2
            ? "rounded-[16px]"
            : composerTall
              ? "rounded-[18px]"
              : "rounded-[22px]";
    const composerBreakAll = React.useMemo(
        () => shouldComposerBreakAll(inputValue),
        [inputValue],
    );

    const editorMaskImage = buildComposerScrollMaskImage(scrollMask, 18);
    const hintMode: "idle" | "active" | "preparing" = isPreparing
        ? "preparing"
        : isLoading
          ? "active"
          : "idle";

    return (
        <div
            className={cn(
                "relative shrink-0 overflow-visible",
                variant === "empty" ? "w-full px-0 pb-0 pt-0" : "px-0 pb-3 pt-0",
            )}
        >
            <div className="relative z-10 flex w-full flex-col gap-1.5">
                {hasContextStrip ? (
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5 px-1">
                        {pendingEdits.length > 0 ? (
                        <PendingEditsPanel
                            edits={pendingEdits}
                            onAcceptAll={onAcceptAllEdits ?? (() => {})}
                            onRejectAll={onRejectAllEdits ?? (() => {})}
                            onAccept={onAcceptEdit}
                            onReject={onRejectEdit}
                        />
                        ) : null}
                        {queuedMessages.length > 0 && onEditQueuedMessage && onRemoveQueuedMessage ? (
                            <QueuedMessagesPanel
                                items={queuedMessages}
                                onEdit={onEditQueuedMessage}
                                onRemove={onRemoveQueuedMessage}
                                onSendNow={onSendQueuedNow}
                            />
                        ) : null}
                        {projectRuleFiles.length > 0 ? (
                            <Tooltip content={projectRuleFiles.join("\n")}>
                                <span className="flex h-6.5 min-w-0 max-w-56 items-center gap-1.5 rounded-full border border-border-subtle bg-surface-3/90 px-2.5 text-xs font-medium text-text-secondary">
                                    <Icon icon={Document20Regular} className="size-3.5 shrink-0 text-text-muted" />
                                    <span className="truncate">
                                        {projectRuleFiles
                                            .map((name) => name.split(/[\\/]/).pop() || name)
                                            .join(", ")}
                                    </span>
                                </span>
                            </Tooltip>
                        ) : null}
                        {taskItems.length > 0 ? <ComposerTasksStrip items={taskItems} /> : null}
                    </div>
                ) : null}

                <div
                    ref={composerBoxRef}
                    data-expanded-layout={isExpandedLayout ? "true" : "false"}
                    data-expanded-sheet={isExpanded ? "true" : "false"}
                    className={cn(
                        "relative flex w-full cursor-text flex-col border p-[5px]",
                        "border-border-subtle bg-surface-4 shadow-2xs focus-within:border-border-secondary",
                        "transition-[border-radius,background-color,border-color,box-shadow] duration-[var(--spring-panel-dur)] ease-[var(--spring-panel)] motion-reduce:transition-none",
                        vesselRadiusClass,
                        dragOver && "border-border bg-surface-3/90",
                    )}
                    onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        const target = e.target instanceof HTMLElement ? e.target : null;
                        if (
                            target?.closest(
                                "button, a, input, textarea, [role='menuitem'], [data-radix-collection-item], [data-composer-quotes]",
                            )
                        ) {
                            return;
                        }
                        requestAnimationFrame(() => textareaRef.current?.focus());
                    }}
                    onDrop={handleDrop}
                    onDragEnter={handleDragEnter}
                    onDragLeave={handleDragLeave}
                    onDragOver={handleDragOver}
                >
                    {dragOver ? (
                        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] border-2 border-border-subtle bg-surface-3/95">
                            <p className="text-sm font-medium text-text-primary">Drop files to attach</p>
                        </div>
                    ) : null}
                    <MentionPicker
                        open={mentionOpen || slashOpen}
                        query={slashOpen ? slashQuery : mentionQuery}
                        mode={slashOpen ? "slash" : "mention"}
                        workflows={settings.ai.workflows}
                        onPick={slashOpen ? insertSlash : insertMention}
                        onClose={() => {
                            setMentionOpen(false);
                            setSlashOpen(false);
                        }}
                        anchorRef={textareaRef}
                        boxRef={composerBoxRef}
                        caretIndex={mentionCaret}
                    />
                    {activeQuotes.length > 0 ? (
                        <div
                            data-composer-quotes
                            className="flex flex-col gap-1 px-1.5 pt-1 pb-0.5"
                        >
                            {activeQuotes.map((q, idx) => (
                                <div
                                    key={q.id}
                                    className="group/quote flex min-w-0 items-start gap-2 rounded-lg border border-border-subtle bg-surface-2 px-2.5 py-1.5 text-xs text-text-secondary transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:border-border-secondary"
                                >
                                    <Icon
                                        icon={TextQuote16Regular}
                                        className="mt-0.5 size-3.5 shrink-0 text-text-muted"
                                    />
                                    <span className="min-w-0 flex-1 line-clamp-2 break-words leading-[16px] text-text-secondary">
                                        {q.text.replace(/\s*\n+\s*/g, " ↵ ").trim()}
                                    </span>
                                    <Tooltip content="Remove quote">
                                        <button
                                            type="button"
                                            aria-label={`Remove quote ${idx + 1}`}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleRemoveQuote(q.id);
                                            }}
                                            className="flex size-[20px] shrink-0 items-center justify-center rounded-md text-text-muted opacity-70 transition-[background-color,color,opacity,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary hover:opacity-100 active:scale-[0.94]"
                                        >
                                            <Icon icon={Dismiss16Regular} className="size-3" />
                                        </button>
                                    </Tooltip>
                                </div>
                            ))}
                        </div>
                    ) : null}
                    <ComposerAttachments
                        attachments={uploadedFiles}
                        onRemove={(id) =>
                            setUploadedFiles((prev) => prev.filter((a) => a.id !== id))
                        }
                        onInsertInline={(id, text) => {
                            setUploadedFiles((prev) => prev.filter((a) => a.id !== id));
                            const pad = inputValue.trim().length > 0 ? `${inputValue.trimEnd()}\n\n` : "";
                            const next = `${pad}${text}`;
                            onInputChange({ target: { value: next } } as React.ChangeEvent<HTMLTextAreaElement>);
                            requestAnimationFrame(() => {
                                const node = textareaRef.current;
                                if (!node) return;
                                node.focus();
                                node.setSelectionRange(next.length, next.length);
                            });
                        }}
                    />
                    <input
                        type="file"
                        id="chat-media-upload"
                        className="hidden"
                        multiple
                        accept={ACCEPT_STRING}
                        onChange={handleFilteredFileUpload}
                    />
                    <input
                        type="file"
                        id="chat-folder-upload"
                        className="hidden"
                        multiple
                        {...{ webkitdirectory: "", directory: "" }}
                        onChange={handleFilteredFileUpload}
                    />
                    <div className="relative flex w-full items-end gap-1 px-0.5">
                        <div className="flex shrink-0 items-center self-end">
                            <DropdownMenu
                                open={plusMenuOpen}
                                onOpenChange={(open) => {
                                    setPlusMenuOpen(open);
                                    if (!open) return;
                                    const cached = peekPluginsCache()?.plugins;
                                    if (cached) setPlusPlugins(cached);
                                    void fetchPlugins()
                                        .then((data) => setPlusPlugins(data.plugins))
                                        .catch(() => {
                                            if (!cached) setPlusPlugins([]);
                                        });
                                }}
                            >
                                <DropdownMenuTrigger asChild>
                                    <button
                                        type="button"
                                        className={cn(
                                            "flex size-[32px] shrink-0 items-center justify-center rounded-full p-0",
                                            "text-text-muted hover:text-text-primary",
                                            "transition-[background-color,color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]",
                                            "hover:bg-[var(--btn-hover)] active:scale-[0.96]",
                                            "data-[state=open]:bg-[var(--btn-open)] data-[state=open]:hover:bg-[var(--btn-open-hover)] data-[state=open]:text-text-primary",
                                        )}
                                        aria-label="Add"
                                    >
                                        <Icon icon={Add20Regular} />
                                    </button>
                                </DropdownMenuTrigger>
                                {plusMenuOpen ? (
                                <DropdownMenuContent align="start" className="w-56">
                                    <DropdownMenuItem
                                        onClick={() => document.getElementById("chat-media-upload")?.click()}
                                    >
                                        <Icon icon={MoviesAndTv24Filled} />
                                        Upload photos & file
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={() => document.getElementById("chat-folder-upload")?.click()}
                                    >
                                        <Icon icon={FolderAdd24Filled} />
                                        Attach folder
                                    </DropdownMenuItem>
                                    <DropdownMenuSub>
                                        <DropdownMenuSubTrigger>
                                            <Icon icon={Connected24Filled} />
                                            Plugins
                                        </DropdownMenuSubTrigger>
                                        <DropdownMenuSubContent className="w-56">
                                            <SearchInput
                                                borderless
                                                placeholder="Search plugins"
                                                autoFocus
                                                value={pluginQuery}
                                                onChange={(e) => setPluginQuery(e.target.value)}
                                                onKeyDown={(e) => e.stopPropagation()}
                                                onKeyUp={(e) => e.stopPropagation()}
                                                onPointerDown={(e) => e.stopPropagation()}
                                            />
                                            <div className="max-h-40 overflow-y-auto">
                                                {(() => {
                                                    const q = pluginQuery.trim().toLowerCase();
                                                    const matches = plusPlugins.filter(
                                                        (plugin) =>
                                                            !q
                                                            || plugin.name.toLowerCase().includes(q)
                                                            || plugin.toolkit.toLowerCase().includes(q),
                                                    );
                                                    if (matches.length === 0) {
                                                        return (
                                                            <DropdownMenuItem disabled>
                                                                {plusPlugins.length === 0 ? "No plugins" : "No matches"}
                                                            </DropdownMenuItem>
                                                        );
                                                    }
                                                    return matches.map((plugin) => (
                                                        <DropdownMenuItem
                                                            key={plugin.toolkit}
                                                            onClick={() =>
                                                                appendToken(
                                                                    formatMentionToken({
                                                                        kind: "plugin",
                                                                        id: plugin.toolkit,
                                                                        path: plugin.toolkit,
                                                                        label: plugin.name,
                                                                    }),
                                                                )
                                                            }
                                                        >
                                                            <PluginLogo toolkit={plugin.toolkit} name={plugin.name} size={14} />
                                                            <span className="min-w-0 flex-1 truncate">{plugin.name}</span>
                                                        </DropdownMenuItem>
                                                    ));
                                                })()}
                                            </div>
                                        </DropdownMenuSubContent>
                                    </DropdownMenuSub>
                                    <DropdownMenuSub>
                                        <DropdownMenuSubTrigger>
                                            <Icon icon={DocumentEdit24Filled} />
                                            Skills
                                        </DropdownMenuSubTrigger>
                                        <DropdownMenuSubContent className="w-56">
                                            {skills.length === 0 ? (
                                                <DropdownMenuItem disabled>No skills yet</DropdownMenuItem>
                                            ) : (
                                                skills.map((skill) => (
                                                    <DropdownMenuItem
                                                        key={skill.id}
                                                        onClick={() =>
                                                            appendToken(
                                                                formatMentionToken({
                                                                    kind: "skill",
                                                                    id: skill.id,
                                                                    path: skill.id,
                                                                    label: skill.name,
                                                                }),
                                                            )
                                                        }
                                                    >
                                                        <Icon icon={DocumentText20Regular} />
                                                        <span className="min-w-0 flex-1 truncate">{skill.name}</span>
                                                    </DropdownMenuItem>
                                                ))
                                            )}
                                        </DropdownMenuSubContent>
                                    </DropdownMenuSub>
                                </DropdownMenuContent>
                                ) : null}
                            </DropdownMenu>
                        </div>

                        <div
                            className={cn(
                                "relative min-h-[32px] min-w-0 flex-1 py-[5px] transition-[height] motion-reduce:transition-none",
                                isExpanded
                                    ? "duration-[var(--spring-panel-dur)] ease-[var(--spring-panel)]"
                                    : "duration-[var(--spring-quick-dur)] ease-[var(--spring-quick)]",
                            )}
                            style={{
                                height: `${editorHeight + 10}px`,
                            }}
                        >
                            <div
                                className="relative h-full min-h-[22px] w-full overflow-hidden"
                                style={{
                                    maskImage: editorMaskImage,
                                    WebkitMaskImage: editorMaskImage,
                                }}
                            >
                                {!inputValue ? (
                                    <RotatingComposerHint
                                        paused={isEditorFocused}
                                        mode={hintMode}
                                        needsProvider={needsSignIn}
                                        missingModels={missingModelsOnly}
                                    />
                                ) : null}
                                <div
                                    ref={mentionOverlayRef}
                                    aria-hidden
                                    className={cn(
                                        "pointer-events-none absolute inset-0 z-0 overflow-hidden whitespace-pre-wrap px-1.5 py-0 text-sm font-medium leading-[22px] text-text-primary",
                                        composerBreakAll ? "break-all" : "break-words",
                                    )}
                                >
                                {(() => {
                                    const trailingBreak = inputValue.endsWith("\n") ? "\u200b" : "";
                                    if (!inputValue.includes("@") && !inputValue.includes("/")) {
                                        return inputValue ? `${inputValue}${trailingBreak}` : "\u00a0";
                                    }
                                    const mentionRs = mentionRanges(inputValue);
                                    const slashRs = slashCommandRanges(inputValue, settings.ai.workflows ?? []);
                                    const ranges = [
                                        ...mentionRs.map((r) => ({ kind: "mention" as const, ...r })),
                                        ...slashRs.map((r) => ({ kind: "slash" as const, ...r })),
                                    ].sort((a, b) => a.start - b.start);
                                    const merged: typeof ranges = [];
                                    for (const r of ranges) {
                                        const prev = merged[merged.length - 1];
                                        if (prev && r.start < prev.end) continue;
                                        merged.push(r);
                                    }
                                    if (merged.length === 0) {
                                        return inputValue ? `${inputValue}${trailingBreak}` : "\u00a0";
                                    }
                                    const nodes: React.ReactNode[] = [];
                                    let cursor = 0;
                                    merged.forEach((range, i) => {
                                        if (range.start > cursor) {
                                            nodes.push(inputValue.slice(cursor, range.start));
                                        }
                                        nodes.push(
                                            <ComposerContextHighlight
                                                key={`${range.kind}-${i}`}
                                                text={inputValue.slice(range.start, range.end)}
                                            />,
                                        );
                                        cursor = range.end;
                                    });
                                    if (cursor < inputValue.length) {
                                        nodes.push(inputValue.slice(cursor));
                                    }
                                    if (trailingBreak) {
                                        nodes.push(trailingBreak);
                                    }
                                    return nodes;
                                })()}
                            </div>
                            <ContextMenu>
                                <ContextMenuTrigger asChild>
                                    <textarea
                                        ref={textareaRef}
                                        value={inputValue}
                                        onChange={handleInputChangeWithMentions}
                                        onKeyDown={onComposerKeyDown}
                                        onPaste={handlePaste}
                                        onSelect={(e) => {
                                            if (!mentionOpen && !slashOpen) return;
                                            const el = e.currentTarget;
                                            const caret = el.selectionStart ?? 0;
                                            const before = el.value.slice(0, caret);
                                            const atMatch = before.match(/(?:^|[\s([{"'])@([\w./:-]*)$/);
                                            const slashMatch = before.match(/(?:^|\s)(\/[^\s]*)$/);
                                            if (atMatch) {
                                                setMentionCaret(Math.max(0, before.lastIndexOf("@")));
                                                setMentionQuery(atMatch[1] ?? "");
                                                setMentionOpen(true);
                                                setSlashOpen(false);
                                            } else if (slashMatch) {
                                                setSlashQuery((slashMatch[1] ?? "/").replace(/^\//, ""));
                                                setSlashOpen(true);
                                                setMentionOpen(false);
                                            } else {
                                                setMentionOpen(false);
                                                setSlashOpen(false);
                                            }
                                        }}
                                        onScroll={(e) => {
                                            const el = e.currentTarget;
                                            syncComposerOverlayScroll(el, mentionOverlayRef.current);
                                            const nextMask = computeComposerScrollMask(el);
                                            setScrollMask((prev) =>
                                                prev.top === nextMask.top && prev.bottom === nextMask.bottom
                                                    ? prev
                                                    : nextMask,
                                            );
                                        }}
                                        onFocus={() => {
                                            setIsEditorFocused(true);
                                            const tauri = (
                                                window as unknown as {
                                                    __TAURI_INTERNALS__?: {
                                                        invoke?: unknown;
                                                        transformCallback?: unknown;
                                                    };
                                                }
                                            ).__TAURI_INTERNALS__;
                                            if (
                                                tauri &&
                                                typeof tauri.invoke === "function" &&
                                                typeof tauri.transformCallback === "function"
                                            ) {
                                                warmComposerResources(getProjectPath());
                                            }
                                        }}
                                        onBlur={() => setIsEditorFocused(false)}
                                        placeholder=""
                                        aria-label={
                                            needsSignIn
                                                ? "Add an API key in Settings → Providers to chat"
                                                : IDLE_COMPOSER_HINTS[0]
                                        }
                                        rows={1}
                                        className={cn(
                                            "custom-scrollbar relative z-[1] block min-h-[22px] w-full resize-none overflow-x-hidden border-none bg-transparent px-1.5 py-0 text-sm font-medium leading-[22px] text-transparent outline-none placeholder:text-text-muted selection:bg-accent/30 whitespace-pre-wrap",
                                            composerBreakAll ? "break-all" : "break-words",
                                        )}
                                        style={{ caretColor: "var(--text-primary)" }}
                                    />
                                </ContextMenuTrigger>
                                <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
                                    <ContextMenuItem onClick={() => document.execCommand("cut")}>
                                        Cut
                                        <ContextMenuShortcut>Ctrl+X</ContextMenuShortcut>
                                    </ContextMenuItem>
                                    <ContextMenuItem onClick={() => document.execCommand("copy")}>
                                        Copy
                                        <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
                                    </ContextMenuItem>
                                    <ContextMenuItem
                                        onClick={() => {
                                            void navigator.clipboard
                                                .readText()
                                                .then((text) => {
                                                    const el = textareaRef.current;
                                                    if (!el || !text) return;
                                                    if (pasteIsLarge(text)) {
                                                        const file = pastedTextFile(text);
                                                        addUploadedFiles([file]);
                                                        notify.info(
                                                            "Pasted as attachment",
                                                            `${formatPasteSizeLabel(text)} attached to keep the composer tidy.`,
                                                            text.length <= 24_000
                                                                ? {
                                                                      action: {
                                                                          label: "Insert inline",
                                                                          onClick: () =>
                                                                              swapAttachmentInline(file, text),
                                                                      },
                                                                  }
                                                                : undefined,
                                                        );
                                                        return;
                                                    }
                                                    const start = el.selectionStart;
                                                    const end = el.selectionEnd;
                                                    const wrapped = tryWrapMarkdownLinkOnPaste(
                                                        inputValue,
                                                        start,
                                                        end,
                                                        text,
                                                    );
                                                    const replacement = wrapped
                                                        ? `[${inputValue.slice(start, end)}](${text.trim()})`
                                                        : text;
                                                    el.focus();
                                                    el.setSelectionRange(start, end);
                                                    let insertedNatively: boolean;
                                                    try {
                                                        insertedNatively = document.execCommand(
                                                            "insertText",
                                                            false,
                                                            replacement,
                                                        );
                                                    } catch {
                                                        insertedNatively = false;
                                                    }
                                                    if (!insertedNatively) {
                                                        const nextValue = wrapped
                                                            ? wrapped.nextValue
                                                            : inputValue.slice(0, start) +
                                                              text +
                                                              inputValue.slice(end);
                                                        const nextCaret = wrapped
                                                            ? wrapped.nextCaret
                                                            : start + text.length;
                                                        onInputChange({
                                                            target: { value: nextValue },
                                                        } as React.ChangeEvent<HTMLTextAreaElement>);
                                                        requestAnimationFrame(() => {
                                                            el.focus();
                                                            el.setSelectionRange(nextCaret, nextCaret);
                                                        });
                                                    }
                                                    if (wrapped) {
                                                        notify.info(
                                                            "Formatted as Markdown link",
                                                            "Press Ctrl/Cmd+Z to keep the raw URL.",
                                                        );
                                                    }
                                                })
                                                .catch(() => {
                                                    /* clipboard read denied or unavailable */
                                                });
                                        }}
                                    >
                                        Paste
                                        <ContextMenuShortcut>Ctrl+V</ContextMenuShortcut>
                                    </ContextMenuItem>
                                    <ContextMenuSeparator />
                                    <ContextMenuItem
                                        onClick={() => {
                                            const el = textareaRef.current;
                                            if (!el) return;
                                            el.focus();
                                            el.select();
                                        }}
                                    >
                                        Select All
                                        <ContextMenuShortcut>Ctrl+A</ContextMenuShortcut>
                                    </ContextMenuItem>
                                </ContextMenuContent>
                            </ContextMenu>
                            </div>
                        </div>

                        <div className="relative flex shrink-0 flex-col items-end justify-end self-stretch">
                            <div
                                aria-hidden={!showExpandButton || undefined}
                                className={cn(
                                    "absolute top-0 right-0 flex items-center transition-[opacity,transform] duration-[var(--spring-quick-dur)] ease-[var(--spring-quick)] motion-reduce:transform-none motion-reduce:transition-none",
                                    showExpandButton
                                        ? "pointer-events-auto scale-100 opacity-100 delay-75"
                                        : "pointer-events-none scale-90 opacity-0 delay-0",
                                )}
                            >
                                <Tooltip
                                    content={isExpanded ? "Collapse composer" : "Expand composer"}
                                    shortcut="Ctrl+Shift+E"
                                >
                                    <button
                                        type="button"
                                        tabIndex={showExpandButton ? 0 : -1}
                                        aria-label={isExpanded ? "Collapse composer" : "Expand composer"}
                                        aria-pressed={isExpanded}
                                        onClick={() => {
                                            setIsExpanded((prev) => !prev);
                                            requestAnimationFrame(() => textareaRef.current?.focus());
                                        }}
                                        className="flex size-[28px] shrink-0 items-center justify-center rounded-full text-text-muted transition-[background-color,color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary active:scale-[0.96]"
                                    >
                                        <Icon icon={isExpanded ? ArrowMinimize20Regular : ArrowMaximize20Regular} />
                                    </button>
                                </Tooltip>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                                <DictationButton />
                                <Tooltip
                                    content={
                                        canStop
                                            ? "Stop"
                                            : isLoading
                                              ? "Queue message"
                                              : "Send"
                                    }
                                    shortcut={canStop ? "Esc" : "Enter"}
                                >
                                    <button
                                        type="button"
                                        onClick={canStop ? onStopMessage : handleSendWithHistory}
                                        disabled={sendDisabled}
                                        className={cn(
                                            "flex size-[32px] shrink-0 items-center justify-center rounded-full transition-[background-color,border-color,color,opacity,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] active:scale-[0.95] disabled:pointer-events-none disabled:opacity-40",
                                            canStop && !isPreparing
                                                ? "border border-border bg-surface-2 text-text-primary hover:bg-[var(--btn-hover)]"
                                                : sendActive
                                                  ? "bg-accent text-white hover:opacity-90"
                                                  : "bg-surface-3 text-text-muted",
                                        )}
                                        aria-label={canStop ? "Stop" : isLoading ? "Queue message" : "Send"}
                                    >
                                        {canStop ? (
                                            <span
                                                role="status"
                                                aria-label={isPreparing ? "Preparing message" : "Generating"}
                                                className="inline-flex items-center justify-center"
                                            >
                                                {isPreparing ? (
                                                    <Arc size={16} />
                                                ) : (
                                                    <span className="block size-2.5 rounded-[2.5px] bg-current" />
                                                )}
                                            </span>
                                        ) : (
                                            <Icon icon={ArrowUp20Regular} />
                                        )}
                                    </button>
                                </Tooltip>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex min-w-0 items-center justify-between gap-1.5 px-1">
                    <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
                        {hideModeSelect ? null : (
                            <ModeMenu
                                selectedMode={selectedMode}
                                setSelectedMode={setSelectedMode}
                            />
                        )}
                        <WorkspaceBranchSwitch />
                    </div>

                    <div className="flex min-w-0 shrink items-center gap-0.5">
                        {needsSignIn ? (
                            <Tooltip
                                content={
                                    missingModelsOnly
                                        ? "Add or import a model ID in Settings → Providers"
                                        : "Configure an API key or local runtime in Settings → Providers"
                                }
                            >
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="xs"
                                    onClick={() => {
                                        setModelMenuOpen(false);
                                        void openSettingsWindow({ category: "providers" });
                                    }}
                                    className={cn(
                                        "h-7 min-w-0 shrink rounded-md px-2 font-normal text-text-secondary",
                                        "transition-[background-color,color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] motion-reduce:transform-none motion-reduce:transition-none",
                                        "hover:bg-[var(--btn-hover)] hover:text-text-primary enabled:active:scale-[0.97]",
                                    )}
                                    aria-label="Open Providers"
                                >
                                    <div className="flex min-w-0 items-center gap-1.5 text-sm">
                                        <BetterShapeAutoIcon size={14} marquee />
                                        <span className="min-w-0 truncate">Open Providers</span>
                                    </div>
                                </Button>
                            </Tooltip>
                        ) : (
                            <>
                                <DropdownMenu
                                    open={modelMenuOpen}
                                    onOpenChange={(open) => {
                                        setModelMenuOpen(open);
                                        if (!open) setModelQuery("");
                                    }}
                                >
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="xs"
                                            className={cn(
                                                "h-7 min-w-0 max-w-44 shrink rounded-md px-2 font-normal text-text-muted sm:max-w-[220px]",
                                                "transition-[background-color,color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] motion-reduce:transform-none motion-reduce:transition-none",
                                                "hover:bg-[var(--btn-hover)] hover:text-text-primary enabled:active:scale-[0.97]",
                                                "data-[state=open]:bg-[var(--btn-open)] data-[state=open]:hover:bg-[var(--btn-open-hover)] data-[state=open]:text-text-primary",
                                            )}
                                            aria-label={modelName}
                                        >
                                            <div className="flex min-w-0 items-center gap-1.5 text-sm">
                                                {providerIcon(activeTriggerIconId, 14)}
                                                <span className="min-w-0 truncate">{modelName}</span>
                                            </div>
                                        </Button>
                                    </DropdownMenuTrigger>
                                    {modelMenuOpen ? (
                                    <DropdownMenuContent align="end" className="w-70 max-w-[calc(100vw-24px)]">
                                                <SearchInput
                                                    borderless
                                                    placeholder="Search models"
                                                    autoFocus
                                                    value={modelQuery}
                                                    onChange={(e) => setModelQuery(e.target.value)}
                                                    onKeyDown={(e) => e.stopPropagation()}
                                                    onKeyUp={(e) => e.stopPropagation()}
                                                    onPointerDown={(e) => e.stopPropagation()}
                                                />
                                                <div className="custom-scrollbar max-h-[280px] overflow-y-auto">
                                                    {multiSelectModels ? (
                                                        <div className="px-2.5 py-1.5 text-xs text-text-muted">
                                                            Orchestrator uses the primary model. Extra picks become the worker pool.
                                                        </div>
                                                    ) : null}
                                                    {modelMatches(autoModel) ? (
                                                        multiSelectModels ? (
                                                            <DropdownMenuCheckboxItem
                                                                checked={selectedModel === "auto" || selectedWorkerModels.includes("auto")}
                                                                onCheckedChange={(checked) => {
                                                                    if (checked) {
                                                                        setSelectedModel("auto");
                                                                        setSelectedWorkerModels?.(
                                                                            selectedWorkerModels.filter((id) => id !== "auto"),
                                                                        );
                                                                    }
                                                                }}
                                                            >
                                                                Auto
                                                            </DropdownMenuCheckboxItem>
                                                        ) : (
                                                            <ModelItem
                                                                model={autoModel}
                                                                isSelected={selectedModel === "auto"}
                                                                onSelect={() => setSelectedModel("auto")}
                                                                effort={reasoningEffort}
                                                                resolvedAutoModel={resolvedAutoModel}
                                                            />
                                                        )
                                                    ) : null}
                                                    {providerOrder.filter((p) => p !== "Auto").map((provider) => {
                                                        const providerModels = MODELS.filter(
                                                            (m) => m.provider === provider && modelMatches(m),
                                                        );
                                                        if (providerModels.length === 0) return null;
                                                        return (
                                                            <div key={provider}>
                                                                <DropdownMenuLabel className="text-xs font-regular text-text-muted">
                                                                    {provider}
                                                                </DropdownMenuLabel>
                                                                {providerModels.map((m) => {
                                                                    // Every listed model is usable: it comes from a
                                                                    // provider the user configured, or from local search.
                                                                    const allowed = true;
                                                                    if (multiSelectModels) {
                                                                        const inPool =
                                                                            selectedModel === m.id
                                                                            || selectedWorkerModels.includes(m.id);
                                                                        return (
                                                                            <DropdownMenuCheckboxItem
                                                                                key={m.id}
                                                                                checked={inPool}
                                                                                disabled={!allowed}
                                                                                onCheckedChange={(checked) => {
                                                                                    if (!allowed) return;
                                                                                    if (checked) {
                                                                                        if (selectedModel === "auto" || !selectedWorkerModels.length) {
                                                                                            if (selectedModel !== m.id) {
                                                                                                setSelectedWorkerModels?.(
                                                                                                    [...selectedWorkerModels.filter((id) => id !== m.id), m.id],
                                                                                                );
                                                                                            }
                                                                                        } else if (selectedModel !== m.id) {
                                                                                            setSelectedWorkerModels?.(
                                                                                                [...selectedWorkerModels.filter((id) => id !== m.id), m.id],
                                                                                            );
                                                                                        }
                                                                                    } else if (selectedModel === m.id) {
                                                                                        const [next, ...rest] = selectedWorkerModels;
                                                                                        if (next) {
                                                                                            setSelectedModel(next);
                                                                                            setSelectedWorkerModels?.(rest);
                                                                                        }
                                                                                    } else {
                                                                                        setSelectedWorkerModels?.(
                                                                                            selectedWorkerModels.filter((id) => id !== m.id),
                                                                                        );
                                                                                    }
                                                                                }}
                                                                            >
                                                                                <span className="flex min-w-0 items-center gap-1.5">
                                                                                    {providerIcon(m.id, 14)}
                                                                                    <span className="truncate">{m.name}</span>
                                                                                </span>
                                                                            </DropdownMenuCheckboxItem>
                                                                        );
                                                                    }
                                                                    return (
                                                                        <ModelItem
                                                                            key={m.id}
                                                                            model={m}
                                                                            isSelected={selectedModel === m.id}
                                                                            onSelect={setSelectedModel}
                                                                            effort={reasoningEffort}
                                                                            disabled={!allowed}
                                                                            disabledReason="This model is not available on your plan. Upgrade on the website or keep Auto selected."
                                                                        />
                                                                    );
                                                                })}
                                                            </div>
                                                        );
                                                    })}
                                                    {!modelMatches(autoModel) && !MODELS.some(modelMatches) ? (
                                                        <div className="px-2.5 py-3 text-sm text-text-muted">
                                                            No models match
                                                        </div>
                                                    ) : null}
                                                </div>
                                    </DropdownMenuContent>
                                    ) : null}
                                </DropdownMenu>
                                <ThinkingEffortControl
                                    effort={reasoningEffort}
                                    modelId={effectiveModelId}
                                    onChange={setReasoningEffort}
                                />
                            </>
                        )}
                    </div>
                </div>
            </div>
            {mediaViewer ? (
                <MediaLightbox
                    open
                    onClose={() => setMediaViewer(null)}
                    src={mediaViewer.src}
                    title={mediaViewer.title}
                    kind={mediaViewer.kind}
                />
            ) : null}
        </div>
    );
});


