import {
  BETTERSHAPE_CLIP_CODE,
  codeAttachmentFile,
  matchRememberedClip,
  pasteIsLarge,
  pastedTextFile,
  terminalAttachmentFile,
} from "@/features/chat/lib/bettershape-clip";
import { isSupportedTextFileName } from "@/features/chat/lib/send-attachments";
import { isAudioFile, isImageFile } from "./attachments";
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
  stepPromptHistoryDown,
  stepPromptHistoryUp,
  tryWrapMarkdownLinkOnPaste,
  type PromptHistoryCursor,
} from "@/lib/chat/prompt-history";
import { getCatalogProviderOrder } from "@/lib/catalog/store";
import {
  PROVIDER_ALIASES,
  type ProvidersSettings,
} from "@/lib/ai/providers";
import type { ModelInfo } from "@/lib/settings/models";
import { notify } from "@/features/notifications";

export const COMPOSER_LINE_HEIGHT = 22;

const IMAGE_EXTENSIONS = new Set(
  "png jpg jpeg gif bmp webp svg ico tiff tif avif heic heif".split(" "),
);

const CODE_EXTENSIONS = new Set(
  "ts tsx js jsx rs py go java c cpp h hpp css scss less html xml svg json toml yaml yml md mdx sh bat ps1 rb php swift kt kts dart lua r sql graphql gql proto dockerfile makefile gitignore env ini cfg conf txt log csv lock".split(
    " ",
  ),
);

const ASSET_EXTENSIONS = new Set(
  "ttf otf woff woff2 eot ico icns pdf".split(" "),
);

const VIDEO_EXTENSIONS = new Set(
  "mp4 mov webm avi mkv m4v wmv flv mpeg mpg".split(" "),
);

export const ACCEPT_STRING = [
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

/** Autofocuses a search input once per DOM mount. */
export const focusSearchOnMount = (node: HTMLInputElement | null): void => {
  if (!node || node.dataset.autofocused === "1") return;
  node.dataset.autofocused = "1";
  node.focus();
};

/**
 * Determines whether the composer `<textarea>` and mirror overlay should use `break-all`.
 *
 * Only activates when the entire prompt is a single leading-whitespace unbroken token
 * (no internal word breaks and no newlines), preventing line 1's leading spaces from
 * leaving a blank top row while never breaking multi-line or multi-word prose mid-word.
 */
export const shouldComposerBreakAll = (value: string): boolean => {
  if (!value || value.includes("\n") || /\S[ \t]+\S/.test(value)) return false;
  return /^(?:[ \t]+\S{16,}|[ \t]{10,}\S+)$/.test(value);
};

/** Formats a line and character count summary for pasted clipboard text. */
export const formatPasteSizeLabel = (text: string): string => {
  let lines = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) lines += 1;
  }
  const chars =
    text.length >= 1000
      ? `${(text.length / 1000).toFixed(1)}k chars`
      : `${text.length} chars`;
  const unit = lines === 1 ? "line" : "lines";
  return `${lines.toLocaleString()} ${unit} (${chars})`;
};

/** Formats context window strings with lowercase `k`/`m` suffixes. */
export const formatContextWindow = (raw?: string): string => {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  return trimmed
    .replace(/(?<![0-9.])([0-9.]+)\s*K\b/i, "$1k")
    .replace(/(?<![0-9.])([0-9.]+)\s*M\b/i, "$1m");
};

/** Extracts the lowercase file extension from `name`. */
export const getFileExtension = (name: string): string => {
  const parts = name.split(".");
  if (parts.length <= 1) return "";
  return (parts.pop() ?? "").toLowerCase();
};

/** Checks whether `file` has a supported code/text extension or basename. */
export const isCodeFile = (file: File): boolean =>
  isSupportedTextFileName(file.name);

/** Checks whether `file` is a supported binary project asset. */
export const isAssetFile = (file: File): boolean =>
  ASSET_EXTENSIONS.has(getFileExtension(file.name));

/** Checks whether `file` is a video file that should be rejected by the composer. */
export const isVideoFile = (file: File): boolean => {
  if (file.type.startsWith("video/")) return true;
  return VIDEO_EXTENSIONS.has(getFileExtension(file.name));
};

/** Checks whether an attachment file type is allowed in the composer. */
export const isAllowedFile = (file: File): boolean => {
  if (isVideoFile(file)) return false;
  if (isImageFile(file) || isCodeFile(file)) return true;
  return isAudioFile(file) || isAssetFile(file);
};

/** Checks whether the runtime window exposes an active Tauri IPC bridge. */
export const hasActiveTauriBridge = (): boolean => {
  if (typeof window === "undefined") return false;
  const tauri = (
    window as unknown as {
      __TAURI_INTERNALS__?: { invoke?: unknown; transformCallback?: unknown };
    }
  ).__TAURI_INTERNALS__;
  if (!tauri) return false;
  return (
    typeof tauri.invoke === "function" &&
    typeof tauri.transformCallback === "function"
  );
};

const NEEDS_BASE_URL_IDS = new Set([
  "azure",
  "cloudflare-gateway",
  "cloudflare",
  "databricks",
  "custom",
]);
const KEYLESS_PROVIDER_IDS = new Set(["ollama", "lmstudio", "vllm", "custom"]);
const PRESET_MODELLESS_IDS = new Set(["lmstudio", "vllm", "custom"]);

type ProviderConnEntry = {
  enabled?: boolean;
  baseUrl?: string;
  apiKey?: string;
  authStyle?: string;
  models?: string[];
  extraModels?: string[];
};

/** Checks whether `conn` has an API key or permits keyless authentication. */
const hasConnectionCredentials = (id: string, conn: ProviderConnEntry): boolean =>
  Boolean(conn.apiKey?.trim()) ||
  KEYLESS_PROVIDER_IDS.has(id) ||
  conn.authStyle === "none";

/** Checks whether an enabled connection has both credentials and any required `baseUrl`. */
const isUsableConfiguredEntry = (
  id: string,
  conn: ProviderConnEntry | undefined,
): boolean => {
  if (!conn?.enabled || !hasConnectionCredentials(id, conn)) return false;
  return NEEDS_BASE_URL_IDS.has(id) ? Boolean(conn.baseUrl?.trim()) : true;
};

/** Checks whether an enabled authenticated/keyless connection lacks only its required `baseUrl`. */
const isMissingBaseUrlEntry = (
  id: string,
  conn: ProviderConnEntry | undefined,
): conn is ProviderConnEntry => {
  if (!conn?.enabled || !NEEDS_BASE_URL_IDS.has(id) || Boolean(conn.baseUrl?.trim())) {
    return false;
  }
  return hasConnectionCredentials(id, conn);
};

/** Checks whether `items` contains at least one non-blank string entry. */
const hasNonBlankEntry = (items: string[] | undefined): boolean =>
  Boolean(items?.some((item) => typeof item === "string" && item.trim().length > 0));

/** Checks whether `conn` has user-configured model IDs (`models` or `extraModels`). */
const hasUserPinnedModels = (conn: ProviderConnEntry): boolean =>
  hasNonBlankEntry(conn.models) || hasNonBlankEntry(conn.extraModels);

/** Checks whether `conn` has built-in preset models or user-added model IDs. */
const entryHasAnyModelIds = (id: string, conn: ProviderConnEntry): boolean =>
  !PRESET_MODELLESS_IDS.has(id) || hasUserPinnedModels(conn);

/** Formats missing-`baseUrl` guidance for an enabled provider entry `[id, conn]`. */
const findMissingBaseUrlGuidance = (
  entries: Array<[string, ProviderConnEntry | undefined]>,
): string | null => {
  for (const [id, conn] of entries) {
    if (isMissingBaseUrlEntry(id, conn)) {
      return entryHasAnyModelIds(id, conn)
        ? "Set a base URL in Settings → Providers"
        : "Set a base URL and model ID in Settings → Providers";
    }
  }
  return null;
};

/** Checks whether a keyless entry holds user-saved endpoint or model configuration. */
const hasSavedKeylessEntryConfig = (
  id: string,
  conn: ProviderConnEntry,
): boolean => {
  if (!hasConnectionCredentials(id, conn)) return false;
  return NEEDS_BASE_URL_IDS.has(id)
    ? Boolean(conn.baseUrl?.trim())
    : hasUserPinnedModels(conn);
};

/** Checks whether a disabled entry already holds a saved API key or user-configured keyless setup. */
const isDisabledSavedEntry = (
  id: string,
  conn: ProviderConnEntry | undefined,
): boolean => {
  if (!conn || conn.enabled) return false;
  return (
    Boolean(conn.apiKey?.trim()) || hasSavedKeylessEntryConfig(id, conn)
  );
};

/** Formats enable-provider guidance when credentials are already saved on a disabled entry. */
const findDisabledSavedGuidance = (
  entries: Array<[string, ProviderConnEntry | undefined]>,
): string | null =>
  entries.some(([id, conn]) => isDisabledSavedEntry(id, conn))
    ? "Enable a provider in Settings → Providers"
    : null;

/** Checks whether setup is blocked solely because usable providers have zero models. */
const hasUsableEntryWithoutModels = (
  concreteCount: number,
  entries: Array<[string, ProviderConnEntry | undefined]>,
): boolean =>
  concreteCount === 0 &&
  entries.some(([id, conn]) => isUsableConfiguredEntry(id, conn));

/** Resolves missing-base-URL, disabled-provider, or missing-API-key fallback guidance. */
const resolveUnconfiguredEntriesGuidance = (
  entries: Array<[string, ProviderConnEntry | undefined]>,
): string =>
  findMissingBaseUrlGuidance(entries) ??
  findDisabledSavedGuidance(entries) ??
  "Add an API key in Settings → Providers";

/** Resolves BYOK setup guidance for the composer without pulling runtime provider presets. */
export const resolveComposerSetupGap = (
  needsSignIn: boolean,
  concreteCount: number,
  providers: Partial<ProvidersSettings> | undefined,
): string | null => {
  if (!needsSignIn) return null;
  const entries = Object.entries(providers?.connections ?? {}) as Array<
    [string, ProviderConnEntry | undefined]
  >;
  return hasUsableEntryWithoutModels(concreteCount, entries)
    ? "Add or import a model ID in Settings → Providers"
    : resolveUnconfiguredEntriesGuidance(entries);
};

/** Rewrites aliased `provider/model` prefixes onto canonical preset IDs when known. */
const canonicalizeWantedModelId = (wanted: string): string => {
  const slash = wanted.indexOf("/");
  if (slash <= 0) return wanted;
  const canonical = PROVIDER_ALIASES[wanted.slice(0, slash).toLowerCase()];
  return canonical ? `${canonical}/${wanted.slice(slash + 1)}` : wanted;
};

/** Checks whether a normalized chat-mode selector refers to a concrete model ID. */
const isConcreteChatModeId = (wanted: string): boolean =>
  Boolean(wanted) && wanted !== "auto" && wanted !== "ask";

/** Finds an explicit non-auto default model when present in `concreteAllModels`. */
const findWantedDefaultModel = (
  concreteAllModels: ModelInfo[],
  defaultModel: string | undefined,
): ModelInfo | undefined => {
  const wanted = canonicalizeWantedModelId((defaultModel ?? "").trim());
  if (!isConcreteChatModeId(wanted)) return undefined;
  return concreteAllModels.find((m) => m.id === wanted);
};

/** Resolves the concrete model targeted when `Auto` is active. */
export const resolveAutoTargetModel = (
  concreteAllModels: ModelInfo[],
  defaultModel: string | undefined,
): ModelInfo | null => {
  if (concreteAllModels.length === 0) return null;
  return (
    findWantedDefaultModel(concreteAllModels, defaultModel) ??
    concreteAllModels[0]
  );
};

export type ActiveTriggerState = {
  mentionOpen: boolean;
  mentionQuery: string;
  mentionCaret: number;
  slashOpen: boolean;
  slashQuery: string;
};

/** Detects active `@` mention or `/` workflow trigger state before `caret`. */
export const detectComposerTrigger = (
  value: string,
  caret: number,
): ActiveTriggerState => {
  const before = value.slice(0, caret);
  const atMatch = before.match(/(?:^|[\s([{"'])@([\w./:-]*)$/);
  if (atMatch) {
    return {
      mentionOpen: true,
      mentionQuery: atMatch[1] ?? "",
      mentionCaret: Math.max(0, before.lastIndexOf("@")),
      slashOpen: false,
      slashQuery: "",
    };
  }
  const slashMatch = before.match(/(?:^|\s)(\/[^\s]*)$/);
  if (slashMatch) {
    return {
      mentionOpen: false,
      mentionQuery: "",
      mentionCaret: 0,
      slashOpen: true,
      slashQuery: (slashMatch[1] ?? "/").replace(/^\//, ""),
    };
  }
  return {
    mentionOpen: false,
    mentionQuery: "",
    mentionCaret: 0,
    slashOpen: false,
    slashQuery: "",
  };
};

/** Checks whether every character in `value` is single-line printable ASCII (`32..126`). */
export const isPrintableAsciiLine = (value: string): boolean => {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 || code > 126) return false;
  }
  return true;
};

/** Checks whether `value` contains at least two newline characters (3+ lines). */
export const hasAtLeastTwoNewlines = (value: string): boolean => {
  let count = 0;
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) === 10) {
      count += 1;
      if (count >= 2) return true;
    }
  }
  return false;
};

/** Checks whether the composer should use the sheet-grade `16px` radius. */
const isSheetRadiusState = (opts: {
  isExpanded: boolean;
  hasContextAttachments: boolean;
  hasThreeOrMoreNewlines: boolean;
  editorHeight: number;
}): boolean => {
  if (opts.isExpanded || opts.hasContextAttachments) return true;
  return (
    opts.hasThreeOrMoreNewlines ||
    opts.editorHeight >= COMPOSER_LINE_HEIGHT * 3 - 2
  );
};

/** Resolves the composer vessel border-radius token class for the current height/state. */
export const resolveVesselRadiusClass = (opts: {
  isExpanded: boolean;
  hasContextAttachments: boolean;
  hasThreeOrMoreNewlines: boolean;
  editorHeight: number;
  composerTall: boolean;
}): string => {
  if (isSheetRadiusState(opts)) return "rounded-[16px]";
  return opts.composerTall ? "rounded-[18px]" : "rounded-[22px]";
};

/** Resolves the effective stage height in pixels for composer max-height calculations. */
const resolveEffectiveStageHeight = (knownStageHeight: number): number => {
  if (knownStageHeight > 180) return knownStageHeight;
  if (typeof window !== "undefined" && window.innerHeight > 180) {
    return window.innerHeight;
  }
  return 760;
};

/** Computes worst-case single-line ASCII character capacity for `knownWidth`. */
const computeSafeSingleLineChars = (knownWidth: number): number =>
  knownWidth > 120 ? Math.max(0, Math.floor((knownWidth - 32) / 16)) : 0;

/** Checks whether the O(1) single-line layout fast path applies. */
const canSkipLayoutReflow = (opts: {
  inputValue: string;
  isExpanded: boolean;
  wasTall: boolean;
  knownWidth: number;
}): boolean => {
  if (opts.isExpanded || opts.wasTall || opts.inputValue.includes("\n")) {
    return false;
  }
  if (opts.inputValue.length > computeSafeSingleLineChars(opts.knownWidth)) {
    return false;
  }
  return isPrintableAsciiLine(opts.inputValue);
};

export type LayoutSyncSnapshot = {
  tall: boolean;
  height: number;
  canExpand: boolean;
  mask: { top: boolean; bottom: boolean };
};

/** Applies the single-line height fast-path onto `<textarea>` and returns its snapshot. */
const applySingleLineFastPath = (
  textarea: HTMLTextAreaElement,
  composerTallRef: { current: boolean },
  lastAppliedHeightRef: { current: number },
): LayoutSyncSnapshot => {
  composerTallRef.current = false;
  if (lastAppliedHeightRef.current !== COMPOSER_LINE_HEIGHT) {
    lastAppliedHeightRef.current = COMPOSER_LINE_HEIGHT;
    textarea.style.height = `${COMPOSER_LINE_HEIGHT}px`;
    textarea.style.overflowY = "hidden";
    textarea.style.overflowX = "hidden";
  }
  return {
    tall: false,
    height: COMPOSER_LINE_HEIGHT,
    canExpand: false,
    mask: { top: false, bottom: false },
  };
};

/** Resolves target pixel height for a measured `<textarea>` scrollHeight. */
const resolveMeasuredEditorHeight = (opts: {
  content: number;
  max: number;
  expandedFloor: number;
  isExpanded: boolean;
  tall: boolean;
}): number => {
  const rawTarget = Math.min(Math.max(opts.content, COMPOSER_LINE_HEIGHT), opts.max);
  if (opts.isExpanded) return Math.max(rawTarget, opts.expandedFloor);
  return opts.tall ? rawTarget : COMPOSER_LINE_HEIGHT;
};

/** Resolves effective `scrollTop` after resizing the `<textarea>`. */
const resolveSyncedScrollTop = (opts: {
  textarea: HTMLTextAreaElement;
  inputLength: number;
  revealCaretEnd: boolean;
  content: number;
  nextHeight: number;
  prevScrollTop: number;
}): number => {
  const maxScrollTop = Math.max(0, opts.content - opts.nextHeight);
  const caretPos = opts.textarea.selectionStart ?? opts.inputLength;
  const stickEnd =
    opts.revealCaretEnd &&
    caretPos >= opts.inputLength &&
    opts.content > opts.nextHeight;
  return stickEnd ? maxScrollTop : Math.min(opts.prevScrollTop, maxScrollTop);
};

/** Resolves compact/expanded maximum height and floor bounds for a stage height. */
const computeComposerHeightBounds = (
  stageH: number,
  isExpanded: boolean,
): { max: number; expandedFloor: number } => {
  const compactCap = Math.min(stageH - 140, Math.round(stageH * 0.36));
  const compactMax = Math.min(220, Math.max(76, compactCap));
  const expandedMax = Math.max(
    compactMax + 44,
    Math.min(Math.round(stageH * 0.6), 420),
  );
  return {
    max: isExpanded ? expandedMax : compactMax,
    expandedFloor: Math.min(expandedMax, 280),
  };
};

/** Checks whether the prompt spans multiple lines or exceeds a single-line height. */
const isComposerContentTall = (inputValue: string, content: number): boolean => {
  if (!inputValue) return false;
  return inputValue.includes("\n") || content > COMPOSER_LINE_HEIGHT + 2;
};

/** Parses a CSS pixel value or falls back when layout styles are unavailable. */
const parseCssPxOrFallback = (raw: string, fallback: number): number => {
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** Measures an inline composer action element's rendered width with fallback. */
const measureElementWidth = (
  element: HTMLElement | null,
  fallback: number,
): number => (element ? element.getBoundingClientRect().width : fallback);

/** Computes horizontal padding and flex gaps consumed by the compact composer row. */
const measureRowChromeOffset = (row: HTMLElement): number => {
  const rowStyles = window.getComputedStyle(row);
  const padLeft = parseCssPxOrFallback(rowStyles.paddingLeft, 0);
  const padRight = parseCssPxOrFallback(rowStyles.paddingRight, 0);
  const colGap = parseCssPxOrFallback(rowStyles.columnGap, 3.25);
  return padLeft + padRight + colGap * 2;
};

/** Measures combined inline action widths (`+` button and dictation/send cluster). */
const measureInlineActionWidths = (row: HTMLElement): number => {
  const leftAction = row.querySelector<HTMLElement>(
    "[data-composer-left-action]",
  );
  const rightActions = row.querySelector<HTMLElement>(
    "[data-composer-right-actions]",
  );
  return (
    measureElementWidth(leftAction, 32) + measureElementWidth(rightActions, 68)
  );
};

/** Resolves the exact `<textarea>` width it would occupy in the compact single-row rail. */
const resolveCompactProbeWidth = (
  textarea: HTMLTextAreaElement,
  clientWidth: number,
): number | null => {
  if (clientWidth <= 120) return null;
  const row = textarea.closest<HTMLElement>("[data-composer-row]");
  if (!row || row.clientWidth <= 120) return clientWidth - 106;
  const available =
    row.clientWidth -
    measureRowChromeOffset(row) -
    measureInlineActionWidths(row);
  return Math.max(60, available);
};

/** Probes whether a currently wide `<textarea>` would still wrap at compact single-row width. */
const wrapsAtCompactRailWidth = (
  textarea: HTMLTextAreaElement,
  clientWidth: number,
): boolean => {
  const probeWidth = resolveCompactProbeWidth(textarea, clientWidth);
  if (probeWidth === null) return false;
  textarea.style.width = `${probeWidth}px`;
  const compactContent = textarea.scrollHeight;
  textarea.style.width = "";
  return compactContent > COMPOSER_LINE_HEIGHT + 2;
};

/** Applies measured height, scrollTop, and mirror overlay sync onto `<textarea>`. */
const commitMeasuredTextareaStyles = (opts: {
  textarea: HTMLTextAreaElement;
  overlay: HTMLDivElement | null;
  inputLength: number;
  revealCaretEnd: boolean;
  content: number;
  max: number;
  nextHeight: number;
  prevScrollTop: number;
  clientWidth: number;
}): number => {
  opts.textarea.style.height = `${opts.nextHeight}px`;
  opts.textarea.style.overflowY = opts.content > opts.max ? "auto" : "hidden";
  opts.textarea.style.overflowX = "hidden";
  const scrollTop = resolveSyncedScrollTop(opts);
  opts.textarea.scrollTop = scrollTop;
  syncComposerOverlayScroll(
    {
      scrollLeft: 0,
      scrollTop,
      clientWidth: opts.clientWidth || undefined,
    },
    opts.overlay,
  );
  return scrollTop;
};

/** Synchronizes `<textarea>` height, scrollTop, mirror scroll, and edge mask state. */
export const measureAndSyncComposerTextarea = (opts: {
  textarea: HTMLTextAreaElement;
  overlay: HTMLDivElement | null;
  inputValue: string;
  isExpanded: boolean;
  revealCaretEnd: boolean;
  composerTallRef: { current: boolean };
  lastAppliedHeightRef: { current: number };
  textareaClientWidthRef: { current: number };
  stageHeightRef: { current: number };
}): LayoutSyncSnapshot => {
  const { textarea, inputValue, isExpanded } = opts;
  if (
    canSkipLayoutReflow({
      inputValue,
      isExpanded,
      wasTall: opts.composerTallRef.current,
      knownWidth: opts.textareaClientWidthRef.current,
    })
  ) {
    return applySingleLineFastPath(
      textarea,
      opts.composerTallRef,
      opts.lastAppliedHeightRef,
    );
  }

  const { max, expandedFloor } = computeComposerHeightBounds(
    resolveEffectiveStageHeight(opts.stageHeightRef.current),
    isExpanded,
  );
  const prevScrollTop = textarea.scrollTop;
  textarea.style.height = "0px";
  const content = textarea.scrollHeight;
  const cw = textarea.clientWidth;
  if (cw > 0) opts.textareaClientWidthRef.current = cw;

  const tall =
    isComposerContentTall(inputValue, content) ||
    (opts.composerTallRef.current && wrapsAtCompactRailWidth(textarea, cw));
  opts.composerTallRef.current = tall;
  const nextHeight = resolveMeasuredEditorHeight({
    content,
    max,
    expandedFloor,
    isExpanded,
    tall,
  });
  opts.lastAppliedHeightRef.current = nextHeight;
  const scrollTop = commitMeasuredTextareaStyles({
    textarea,
    overlay: opts.overlay,
    inputLength: inputValue.length,
    revealCaretEnd: opts.revealCaretEnd,
    content,
    max,
    nextHeight,
    prevScrollTop,
    clientWidth: cw,
  });
  return {
    tall,
    height: nextHeight,
    canExpand: Boolean(inputValue) && content >= COMPOSER_LINE_HEIGHT * 3 - 2,
    mask: computeComposerScrollMask({
      scrollTop,
      scrollHeight: content,
      clientHeight: nextHeight,
    }),
  };
};

/** Updates stage height reference if `h` changed meaningfully. */
const updateStageHeightRef = (
  h: number,
  stageHeightRef: { current: number },
): boolean => {
  if (h <= 180 || Math.abs(h - stageHeightRef.current) <= 1) return false;
  stageHeightRef.current = h;
  return true;
};

/** Updates box width and live textarea clientWidth references if `w` changed meaningfully. */
const updateBoxWidthRef = (
  w: number,
  ta: HTMLTextAreaElement | null,
  composerBoxWidthRef: { current: number },
  textareaClientWidthRef: { current: number },
): boolean => {
  if (Math.abs(w - composerBoxWidthRef.current) <= 0.5) return false;
  composerBoxWidthRef.current = w;
  if (ta && ta.clientWidth > 0) textareaClientWidthRef.current = ta.clientWidth;
  return true;
};

/** Updates textarea width reference if `tw` changed meaningfully. */
const updateTextareaWidthRef = (
  tw: number,
  textareaClientWidthRef: { current: number },
): boolean => {
  if (tw <= 0 || Math.abs(tw - textareaClientWidthRef.current) <= 0.5) {
    return false;
  }
  textareaClientWidthRef.current = tw;
  return true;
};

/** Updates inline action cluster width ref when dictation or send controls resize. */
const updateInlineControlWidthRef = (
  nextWidth: number,
  rightActionsWidthRef: { current: number },
): boolean => {
  if (
    nextWidth <= 0 ||
    Math.abs(nextWidth - rightActionsWidthRef.current) <= 0.5
  ) {
    return false;
  }
  rightActionsWidthRef.current = nextWidth;
  return true;
};

/** Updates stage or composer-box geometry refs when those outer containers resize. */
const updateOuterContainerDimension = (
  entry: ResizeObserverEntry,
  targets: {
    stageEl: HTMLElement | null;
    box: HTMLDivElement;
    ta: HTMLTextAreaElement | null;
  },
  refs: {
    stageHeightRef: { current: number };
    composerBoxWidthRef: { current: number };
    textareaClientWidthRef: { current: number };
  },
): boolean => {
  if (entry.target === targets.stageEl) {
    return updateStageHeightRef(entry.contentRect.height, refs.stageHeightRef);
  }
  if (entry.target === targets.box) {
    return updateBoxWidthRef(
      entry.contentRect.width,
      targets.ta,
      refs.composerBoxWidthRef,
      refs.textareaClientWidthRef,
    );
  }
  return false;
};

/** Updates tracked resize dimensions for one `ResizeObserverEntry`. */
const updateObservedDimension = (
  entry: ResizeObserverEntry,
  targets: {
    stageEl: HTMLElement | null;
    box: HTMLDivElement;
    ta: HTMLTextAreaElement | null;
    rightActions: HTMLElement | null;
  },
  refs: {
    stageHeightRef: { current: number };
    composerBoxWidthRef: { current: number };
    textareaClientWidthRef: { current: number };
    rightActionsWidthRef: { current: number };
  },
): boolean => {
  if (updateOuterContainerDimension(entry, targets, refs)) return true;
  if (entry.target === targets.ta) {
    return updateTextareaWidthRef(
      entry.contentRect.width,
      refs.textareaClientWidthRef,
    );
  }
  if (entry.target === targets.rightActions) {
    return updateInlineControlWidthRef(
      entry.contentRect.width,
      refs.rightActionsWidthRef,
    );
  }
  return false;
};

/** Seeds initial geometry measurements onto refs before observing. */
const seedComposerGeometryRefs = (
  stageEl: HTMLElement | null,
  box: HTMLDivElement,
  ta: HTMLTextAreaElement | null,
  refs: {
    stageHeightRef: { current: number };
    composerBoxWidthRef: { current: number };
    textareaClientWidthRef: { current: number };
  },
): void => {
  if (stageEl && stageEl.clientHeight > 180) {
    refs.stageHeightRef.current = stageEl.clientHeight;
  }
  if (ta && ta.clientWidth > 0) {
    refs.textareaClientWidthRef.current = ta.clientWidth;
  }
  refs.composerBoxWidthRef.current = box.clientWidth;
};

/** Registers non-null targets onto `observer`. */
const observeNonNullTargets = (
  observer: ResizeObserver,
  targets: Array<Element | null>,
): void => {
  for (const target of targets) {
    if (target) observer.observe(target);
  }
};

/** Updates all observed geometry refs for a `ResizeObserver` batch without short-circuiting. */
const applyObservedGeometryEntries = (
  entries: readonly ResizeObserverEntry[],
  targets: {
    stageEl: HTMLElement | null;
    box: HTMLDivElement;
    ta: HTMLTextAreaElement | null;
    rightActions: HTMLElement | null;
  },
  refs: {
    stageHeightRef: { current: number };
    composerBoxWidthRef: { current: number };
    textareaClientWidthRef: { current: number };
    rightActionsWidthRef: { current: number };
  },
): boolean => {
  let anyChanged = false;
  for (const entry of entries) {
    if (updateObservedDimension(entry, targets, refs)) {
      anyChanged = true;
    }
  }
  return anyChanged;
};

/** Attaches a `ResizeObserver` to the composer box, textarea, action cluster, and stage container. */
export const observeComposerGeometry = (
  box: HTMLDivElement | null,
  ta: HTMLTextAreaElement | null,
  refs: {
    stageHeightRef: { current: number };
    composerBoxWidthRef: { current: number };
    textareaClientWidthRef: { current: number };
  },
  onGeometryChanged: () => void,
): (() => void) | undefined => {
  if (!box || typeof ResizeObserver === "undefined") return undefined;
  const stageEl = box.closest<HTMLElement>("[data-chat-stage]");
  const rightActions = box.querySelector<HTMLElement>(
    "[data-composer-right-actions]",
  );
  const rightActionsWidthRef = {
    current: rightActions ? rightActions.getBoundingClientRect().width : 0,
  };
  const allRefs = { ...refs, rightActionsWidthRef };
  seedComposerGeometryRefs(stageEl, box, ta, refs);
  const observer = new ResizeObserver((entries) => {
    if (
      applyObservedGeometryEntries(
        entries,
        { stageEl, box, ta, rightActions },
        allRefs,
      )
    ) {
      onGeometryChanged();
    }
  });
  observeNonNullTargets(observer, [box, ta, stageEl, rightActions]);
  return () => observer.disconnect();
};

/** Builds an inline swap toast option when pasted text is within inline size limits. */
const inlineSwapToastOpts = (
  file: File,
  text: string,
  swapInline: (file: File, text: string) => void,
) =>
  text.length <= 24_000
    ? {
        action: {
          label: "Insert inline",
          onClick: () => swapInline(file, text),
        },
      }
    : undefined;

/** Collects allowed clipboard `File` items from a `DataTransferItemList`. */
const extractClipboardFiles = (
  items: DataTransferItemList,
): { hadFileItem: boolean; filesToAdd: File[] } => {
  let hadFileItem = false;
  const filesToAdd: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== "file") continue;
    hadFileItem = true;
    const file = item.getAsFile();
    if (file && isAllowedFile(file)) filesToAdd.push(file);
  }
  return { hadFileItem, filesToAdd };
};

/** Notifies the user after attaching pasted clipboard files. */
const notifyPastedFiles = (files: File[]): void => {
  const title =
    files.length === 1
      ? "Pasted from clipboard"
      : `Pasted ${files.length} files`;
  const detail =
    files.length === 1
      ? files[0].name || "Clipboard media attached to your message."
      : files
          .map((f) => f.name)
          .filter(Boolean)
          .slice(0, 3)
          .join(", ");
  notify.info(title, detail);
};

/** Resolves the source file path from a `BETTERSHAPE_CLIP_CODE` JSON payload. */
const parseClipCodePath = (raw: string, fallback: string): string => {
  try {
    const parsed = JSON.parse(raw) as { path?: string };
    return parsed?.path || fallback;
  } catch {
    return fallback;
  }
};

/** Attaches a terminal selection clip and surfaces a toast. */
const attachTerminalPaste = (
  text: string,
  label: string | undefined,
  addUploadedFiles: (files: File[]) => void,
  swapAttachmentInline: (file: File, text: string) => void,
): void => {
  const file = terminalAttachmentFile(text, label);
  addUploadedFiles([file]);
  const body = label
    ? `Attached selection from ${label}.`
    : `${formatPasteSizeLabel(text)} attached to your message.`;
  notify.info(
    "Terminal output attached",
    body,
    inlineSwapToastOpts(file, text, swapAttachmentInline),
  );
};

/** Attaches an editor code clip and surfaces a toast. */
const attachCodePaste = (
  clipboardData: DataTransfer,
  text: string,
  fallbackLabel: string | undefined,
  addUploadedFiles: (files: File[]) => void,
  swapAttachmentInline: (file: File, text: string) => void,
): void => {
  const raw = clipboardData.getData(BETTERSHAPE_CLIP_CODE);
  const path = parseClipCodePath(raw, fallbackLabel || "selection.ts");
  const file = codeAttachmentFile(text, path);
  addUploadedFiles([file]);
  notify.info(
    "Code selection attached",
    `Attached ${file.name} (${formatPasteSizeLabel(text)}).`,
    inlineSwapToastOpts(file, text, swapAttachmentInline),
  );
};

/** Attaches a large plain-text paste as an attachment and surfaces a toast. */
const attachLargeTextPaste = (
  text: string,
  addUploadedFiles: (files: File[]) => void,
  swapAttachmentInline: (file: File, text: string) => void,
): void => {
  const file = pastedTextFile(text);
  addUploadedFiles([file]);
  notify.info(
    "Pasted as attachment",
    `${formatPasteSizeLabel(text)} attached to keep the composer tidy.`,
    inlineSwapToastOpts(file, text, swapAttachmentInline),
  );
};

/** Checks whether clipboard types or remembered clip represent terminal output. */
const isTerminalClip = (types: readonly string[], kind?: string): boolean =>
  types.includes("application/x-bettershape-terminal") || kind === "terminal";

/** Checks whether clipboard types or remembered clip represent a code selection. */
const isCodeClip = (types: readonly string[], kind?: string): boolean =>
  types.includes(BETTERSHAPE_CLIP_CODE) || kind === "code";

/** Attaches terminal/code/large-text clipboard clips when applicable; returns `true` if handled. */
const tryAttachRichTextPaste = (opts: {
  clipboardData: DataTransfer;
  text: string;
  addUploadedFiles: (files: File[]) => void;
  swapAttachmentInline: (file: File, text: string) => void;
}): boolean => {
  const remembered = matchRememberedClip(opts.text);
  const types = opts.clipboardData.types;
  if (isTerminalClip(types, remembered?.kind)) {
    attachTerminalPaste(
      opts.text,
      remembered?.label,
      opts.addUploadedFiles,
      opts.swapAttachmentInline,
    );
    return true;
  }
  if (isCodeClip(types, remembered?.kind)) {
    attachCodePaste(
      opts.clipboardData,
      opts.text,
      remembered?.label,
      opts.addUploadedFiles,
      opts.swapAttachmentInline,
    );
    return true;
  }
  if (!pasteIsLarge(opts.text)) return false;
  attachLargeTextPaste(
    opts.text,
    opts.addUploadedFiles,
    opts.swapAttachmentInline,
  );
  return true;
};

/** Wraps selected composer text as a Markdown link when pasting a URL. */
const tryPasteMarkdownUrl = (opts: {
  textarea: HTMLTextAreaElement | null;
  inputValue: string;
  text: string;
  clearHistoryCursor: () => void;
  applyProgrammaticInputValue: (next: string) => void;
}): boolean => {
  const { textarea } = opts;
  if (!textarea) return false;
  const wrapped = tryWrapMarkdownLinkOnPaste(
    opts.inputValue,
    textarea.selectionStart,
    textarea.selectionEnd,
    opts.text,
  );
  if (!wrapped) return false;
  opts.clearHistoryCursor();
  insertTextareaRangeWithUndo(
    textarea,
    wrapped.start,
    wrapped.end,
    wrapped.replacement,
    wrapped.nextValue,
    (nextValue, nextCaret) => {
      opts.applyProgrammaticInputValue(nextValue);
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(nextCaret, nextCaret);
      });
    },
  );
  notify.info("Formatted as Markdown link", "Press Ctrl/Cmd+Z to keep the raw URL.");
  return true;
};

/** Handles text-portion paste rules after file clipboard items have been ruled out. */
const processClipboardTextBranch = (opts: {
  clipboardData: DataTransfer;
  hadFileItem: boolean;
  event: { preventDefault: () => void };
  textarea: HTMLTextAreaElement | null;
  inputValue: string;
  addUploadedFiles: (files: File[]) => void;
  swapAttachmentInline: (file: File, text: string) => void;
  clearHistoryCursor: () => void;
  applyProgrammaticInputValue: (next: string) => void;
}): void => {
  const text = opts.clipboardData.getData("text/plain");
  if (!text) {
    if (opts.hadFileItem) {
      opts.event.preventDefault();
      notify.warning(
        "Unsupported clipboard file",
        "That clipboard file format cannot be attached here.",
      );
    }
    return;
  }
  const handled =
    tryAttachRichTextPaste({
      clipboardData: opts.clipboardData,
      text,
      addUploadedFiles: opts.addUploadedFiles,
      swapAttachmentInline: opts.swapAttachmentInline,
    }) ||
    tryPasteMarkdownUrl({
      textarea: opts.textarea,
      inputValue: opts.inputValue,
      text,
      clearHistoryCursor: opts.clearHistoryCursor,
      applyProgrammaticInputValue: opts.applyProgrammaticInputValue,
    });
  if (handled) opts.event.preventDefault();
};

/** Handles clipboard `paste` events on the composer `<textarea>`. */
export const processComposerPasteEvent = (opts: {
  event: { clipboardData: DataTransfer | null; preventDefault: () => void };
  textarea: HTMLTextAreaElement | null;
  inputValue: string;
  addUploadedFiles: (files: File[]) => void;
  swapAttachmentInline: (file: File, text: string) => void;
  clearHistoryCursor: () => void;
  applyProgrammaticInputValue: (next: string) => void;
}): void => {
  const clipboardData = opts.event.clipboardData;
  if (!clipboardData?.items) return;
  const { hadFileItem, filesToAdd } = extractClipboardFiles(clipboardData.items);
  if (filesToAdd.length > 0) {
    opts.event.preventDefault();
    opts.addUploadedFiles(filesToAdd);
    notifyPastedFiles(filesToAdd);
    return;
  }
  processClipboardTextBranch({ ...opts, clipboardData, hadFileItem });
};

/** Commits programmatic textarea text and schedules caret restoration on the next frame. */
const applyFallbackClipboardCaret = (
  textarea: HTMLTextAreaElement,
  applyProgrammaticInputValue: (next: string) => void,
  nextValue: string,
  nextCaret: number,
): void => {
  applyProgrammaticInputValue(nextValue);
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(nextCaret, nextCaret);
  });
};

/** Resolves replacement range and resulting value for inline clipboard insertion. */
const resolveInlineClipboardEdit = (
  inputValue: string,
  start: number,
  end: number,
  text: string,
): {
  rangeStart: number;
  rangeEnd: number;
  replacement: string;
  nextValue: string;
  wrapped: boolean;
} => {
  const mdLink = tryWrapMarkdownLinkOnPaste(inputValue, start, end, text);
  if (mdLink) {
    return {
      rangeStart: mdLink.start,
      rangeEnd: mdLink.end,
      replacement: mdLink.replacement,
      nextValue: mdLink.nextValue,
      wrapped: true,
    };
  }
  return {
    rangeStart: start,
    rangeEnd: end,
    replacement: text,
    nextValue: `${inputValue.slice(0, start)}${text}${inputValue.slice(end)}`,
    wrapped: false,
  };
};

/** Inserts inline context-menu clipboard text into `textarea` after size checks. */
const insertInlineContextMenuClipboard = (opts: {
  text: string;
  textarea: HTMLTextAreaElement;
  inputValue: string;
  clearHistoryCursor: () => void;
  applyProgrammaticInputValue: (next: string) => void;
}): void => {
  const edit = resolveInlineClipboardEdit(
    opts.inputValue,
    opts.textarea.selectionStart,
    opts.textarea.selectionEnd,
    opts.text,
  );
  opts.clearHistoryCursor();
  insertTextareaRangeWithUndo(
    opts.textarea,
    edit.rangeStart,
    edit.rangeEnd,
    edit.replacement,
    edit.nextValue,
    /** Applies controlled fallback value and restores caret when native undo insert fails. */
    (val, caret) =>
      applyFallbackClipboardCaret(
        opts.textarea,
        opts.applyProgrammaticInputValue,
        val,
        caret,
      ),
  );
  if (edit.wrapped) {
    notify.info("Formatted as Markdown link", "Press Ctrl/Cmd+Z to keep the raw URL.");
  }
};

/** Returns a bound clipboard reader when the environment exposes `navigator.clipboard.readText`. */
const getClipboardTextReader = (): (() => Promise<string>) | null => {
  if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
    return null;
  }
  return () => navigator.clipboard.readText();
};

/** Warns when clipboard access is unavailable or denied and refocuses `textarea`. */
const warnClipboardReadBlocked = (
  textarea: HTMLTextAreaElement | null,
  title: string,
): void => {
  textarea?.focus();
  notify.warn(title, "Press Cmd+V or Ctrl+V to paste directly.");
};

/** Invokes `onText` safely so paste callback errors never masquerade as clipboard denial. */
const applyReadClipboardText = (
  textarea: HTMLTextAreaElement | null,
  text: string,
  onText: (value: string) => void,
): void => {
  try {
    onText(text);
  } catch {
    textarea?.focus();
    notify.error("Paste failed", "Could not insert the clipboard contents.");
  }
};

/** Reads clipboard text for the composer context-menu `Paste` item, warning when blocked. */
export const readComposerClipboardTextWithFeedback = (
  textarea: HTMLTextAreaElement | null,
  onText: (text: string) => void,
): void => {
  const readClipboard = getClipboardTextReader();
  if (!readClipboard) {
    warnClipboardReadBlocked(textarea, "Clipboard unavailable");
    return;
  }
  textarea?.focus();
  readClipboard().then(
    (text) => applyReadClipboardText(textarea, text, onText),
    () => warnClipboardReadBlocked(textarea, "Clipboard access denied"),
  );
};

/** Inserts clipboard text invoked from the custom context-menu `Paste` item. */
export const pasteClipboardTextViaContextMenu = (opts: {
  text: string;
  textarea: HTMLTextAreaElement | null;
  inputValue: string;
  addUploadedFiles: (files: File[]) => void;
  swapAttachmentInline: (file: File, text: string) => void;
  clearHistoryCursor: () => void;
  applyProgrammaticInputValue: (next: string) => void;
}): void => {
  const { textarea, text } = opts;
  if (!textarea || !text) return;
  if (pasteIsLarge(text)) {
    attachLargeTextPaste(text, opts.addUploadedFiles, opts.swapAttachmentInline);
    return;
  }
  insertInlineContextMenuClipboard({ ...opts, textarea });
};

/** Attaches a dropped `BETTERSHAPE_CLIP_CODE` payload if valid. */
const tryAttachDroppedCodeClip = (
  codePayload: string,
  addUploadedFiles: (files: File[]) => void,
): boolean => {
  if (!codePayload) return false;
  try {
    const parsed = JSON.parse(codePayload) as { path?: string; text?: string };
    if (!parsed.text) return false;
    const file = codeAttachmentFile(parsed.text, parsed.path || "selection.ts");
    addUploadedFiles([file]);
    notify.info("Code selection attached", `Attached ${file.name}.`);
    return true;
  } catch {
    return false;
  }
};

/** Resolves current value and selection bounds for dropped text insertion. */
const resolveDropSelectionTarget = (
  el: HTMLTextAreaElement | null,
  fallbackValue: string,
): { current: string; start: number; end: number } => {
  if (!el) {
    return {
      current: fallbackValue,
      start: fallbackValue.length,
      end: fallbackValue.length,
    };
  }
  return {
    current: el.value,
    start: el.selectionStart,
    end: el.selectionEnd,
  };
};

/** Inserts plain dropped text at the current `<textarea>` selection. */
const insertDroppedPlainText = (opts: {
  droppedText: string;
  textarea: HTMLTextAreaElement | null;
  inputValue: string;
  clearHistoryCursor: () => void;
  applyProgrammaticInputValue: (next: string) => void;
}): void => {
  if (!opts.droppedText) return;
  const el = opts.textarea;
  const { current, start, end } = resolveDropSelectionTarget(el, opts.inputValue);
  const nextValue = `${current.slice(0, start)}${opts.droppedText}${current.slice(end)}`;
  opts.clearHistoryCursor();
  if (!el) {
    opts.applyProgrammaticInputValue(nextValue);
    return;
  }
  insertTextareaRangeWithUndo(
    el,
    start,
    end,
    opts.droppedText,
    nextValue,
    (fallbackVal, nextCaret) => {
      opts.applyProgrammaticInputValue(fallbackVal);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(nextCaret, nextCaret);
      });
    },
  );
};

/** Notifies the user after attaching dropped files. */
const notifyDroppedFiles = (files: File[]): void => {
  const title =
    files.length === 1
      ? "Attached dropped file"
      : `Attached ${files.length} files`;
  const body =
    files.length === 1
      ? files[0].name
      : files
          .map((f) => f.name)
          .slice(0, 3)
          .join(", ");
  notify.info(title, body);
};

/** Filters picker-selected `File` items through `isAllowedFile` and warns when unsupported files were skipped. */
export const processSelectedPickerFiles = (
  rawFiles: File[],
  addUploadedFiles: (files: File[]) => void,
): void => {
  const allowed = rawFiles.filter(isAllowedFile);
  if (allowed.length > 0) addUploadedFiles(allowed);
  if (allowed.length < rawFiles.length) {
    notify.warning(
      "Unsupported file format",
      "Unsupported or video files cannot be attached here.",
    );
  }
};

/** Handles drag-and-drop payloads onto the composer surface. */
export const processComposerDropTransfer = (opts: {
  dataTransfer: DataTransfer;
  textarea: HTMLTextAreaElement | null;
  inputValue: string;
  addUploadedFiles: (files: File[]) => void;
  clearHistoryCursor: () => void;
  applyProgrammaticInputValue: (next: string) => void;
}): void => {
  const codePayload = opts.dataTransfer.getData(BETTERSHAPE_CLIP_CODE);
  if (tryAttachDroppedCodeClip(codePayload, opts.addUploadedFiles)) return;
  const rawFiles = Array.from(opts.dataTransfer.files);
  const files = rawFiles.filter(isAllowedFile);
  if (files.length > 0) {
    opts.addUploadedFiles(files);
    notifyDroppedFiles(files);
    return;
  }
  if (rawFiles.length > 0) {
    notify.warning(
      "Unsupported file format",
      "That dropped file format cannot be attached here.",
    );
    return;
  }
  insertDroppedPlainText({
    droppedText: opts.dataTransfer.getData("text/plain"),
    textarea: opts.textarea,
    inputValue: opts.inputValue,
    clearHistoryCursor: opts.clearHistoryCursor,
    applyProgrammaticInputValue: opts.applyProgrammaticInputValue,
  });
};

/** Checks whether any modifier key (`meta`, `ctrl`, `alt`, `shift`) is pressed. */
const hasAnyModifierKey = (e: {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean => e.metaKey || e.ctrlKey || e.altKey || e.shiftKey;

/** Checks whether a keyboard event has zero modifier keys and is not IME-composing. */
const isPlainUnmodifiedKey = (e: {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  nativeEvent: { isComposing?: boolean };
}): boolean => !hasAnyModifierKey(e) && !e.nativeEvent.isComposing;

/** Checks whether `Ctrl/Cmd+Shift+E` should toggle expanded composer mode. */
export const isToggleExpandShortcut = (
  e: {
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    key: string;
  },
  canToggle: boolean,
): boolean => {
  if (!canToggle || !e.shiftKey || !(e.metaKey || e.ctrlKey)) return false;
  return e.key.toLowerCase() === "e";
};

/** Steps prompt history upward when the caret is eligible. */
const tryStepPromptHistoryUpFromTextarea = (
  el: HTMLTextAreaElement,
  historyCursor: PromptHistoryCursor | null,
  inputValue: string,
  recallablePrompts: string[],
): { kind: "step"; cursor: PromptHistoryCursor | null; value: string } | null => {
  if (recallablePrompts.length === 0) return null;
  if (
    !canStepPromptHistoryUp(
      historyCursor,
      inputValue,
      el.selectionStart,
      el.selectionEnd,
    )
  ) {
    return null;
  }
  const stepped = stepPromptHistoryUp(historyCursor, inputValue, recallablePrompts);
  return stepped ? { kind: "step", ...stepped } : null;
};

/** Resolves queued-message edit ID when pressing `ArrowUp` in an empty composer. */
const resolveQueuedEditIdOnArrowUp = (
  inputValue: string,
  queuedIds: string[],
  hasEditQueuedHandler: boolean,
): string | null => {
  if (inputValue.length > 0 || !hasEditQueuedHandler) return null;
  return queuedIds.at(-1) ?? null;
};

/** Resolves `ArrowUp` history or queued-message recall action when applicable. */
export const resolveArrowUpAction = (opts: {
  e: {
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    key: string;
    currentTarget: HTMLTextAreaElement;
    nativeEvent: { isComposing?: boolean };
  };
  inputValue: string;
  queuedIds: string[];
  hasEditQueuedHandler: boolean;
  historyCursor: PromptHistoryCursor | null;
  recallablePrompts: string[];
}):
  | { kind: "edit-queued"; id: string }
  | { kind: "step"; cursor: PromptHistoryCursor | null; value: string }
  | null => {
  if (opts.e.key !== "ArrowUp" || !isPlainUnmodifiedKey(opts.e)) return null;
  const queuedId = resolveQueuedEditIdOnArrowUp(
    opts.inputValue,
    opts.queuedIds,
    opts.hasEditQueuedHandler,
  );
  if (queuedId) return { kind: "edit-queued", id: queuedId };
  return tryStepPromptHistoryUpFromTextarea(
    opts.e.currentTarget,
    opts.historyCursor,
    opts.inputValue,
    opts.recallablePrompts,
  );
};

/** Steps prompt history downward when caret is on the last logical line. */
const stepDownOnLastLine = (
  el: HTMLTextAreaElement,
  historyCursor: PromptHistoryCursor,
  inputValue: string,
  recallablePrompts: string[],
): { kind: "step"; cursor: PromptHistoryCursor | null; value: string } | null => {
  if (!isCaretOnLastLogicalLine(inputValue, el.selectionStart, el.selectionEnd)) {
    return null;
  }
  const stepped = stepPromptHistoryDown(historyCursor, recallablePrompts);
  return stepped ? { kind: "step", ...stepped } : null;
};

/** Resolves `ArrowDown` prompt-history step or cursor reset when applicable. */
export const resolveArrowDownAction = (opts: {
  e: {
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    key: string;
    currentTarget: HTMLTextAreaElement;
    nativeEvent: { isComposing?: boolean };
  };
  inputValue: string;
  historyCursor: PromptHistoryCursor | null;
  recallablePrompts: string[];
}):
  | { kind: "clear-cursor" }
  | { kind: "step"; cursor: PromptHistoryCursor | null; value: string }
  | null => {
  if (
    opts.e.key !== "ArrowDown" ||
    opts.historyCursor === null ||
    !isPlainUnmodifiedKey(opts.e)
  ) {
    return null;
  }
  if (!isUnmodifiedHistoryRecall(opts.historyCursor, opts.inputValue)) {
    return { kind: "clear-cursor" };
  }
  return stepDownOnLastLine(
    opts.e.currentTarget,
    opts.historyCursor,
    opts.inputValue,
    opts.recallablePrompts,
  );
};

/** Checks whether `e` is an unmodified `Escape` press (allowing Shift). */
const isEscapeWithoutSystemModifiers = (e: {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  key: string;
}): boolean => e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey;

/** Resolves `Escape` draft restoration when browsing unmodified prompt history. */
export const resolveEscapeDraftRestore = (opts: {
  e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean; key: string };
  isBusy: boolean;
  inputValue: string;
  historyCursor: PromptHistoryCursor | null;
}): { kind: "clear-cursor" } | { kind: "restore"; draft: string } | null => {
  if (
    opts.isBusy ||
    opts.historyCursor === null ||
    !isEscapeWithoutSystemModifiers(opts.e)
  ) {
    return null;
  }
  if (!isUnmodifiedHistoryRecall(opts.historyCursor, opts.inputValue)) {
    return { kind: "clear-cursor" };
  }
  return { kind: "restore", draft: opts.historyCursor.stashedDraft };
};

/** Checks whether a target element blocks global Escape stop handling. */
const isEscapeBlockedTarget = (
  target: HTMLElement | null,
  composerTextarea: HTMLTextAreaElement | null,
): boolean => {
  if (!target) return false;
  if (target.closest(".cm-editor, [role='dialog']")) return true;
  if (target === composerTextarea) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA";
};

/** Checks whether `e` is an eligible non-IME `Escape` keydown event. */
const isEligibleEscapeKeyEvent = (e: KeyboardEvent): boolean => {
  if (e.key !== "Escape" || e.defaultPrevented) return false;
  return !e.isComposing && e.keyCode !== 229;
};

/** Checks whether global `Escape` should stop generation. */
export const shouldGlobalEscapeStop = (
  e: KeyboardEvent,
  popoverOpen: boolean,
  composerTextarea: HTMLTextAreaElement | null,
): boolean => {
  if (popoverOpen || !isEligibleEscapeKeyEvent(e)) return false;
  const target = e.target instanceof HTMLElement ? e.target : null;
  return !isEscapeBlockedTarget(target, composerTextarea);
};

/** Persists inline-swapped attachment text when the composer has unmounted. */
export const persistUnmountedInlineSwap = (rawText: string): void => {
  try {
    const saved = localStorage.getItem("bettershape-chat-input") ?? "";
    const merged =
      saved.trim().length > 0 ? `${saved.trimEnd()}\n\n${rawText}` : rawText;
    localStorage.setItem("bettershape-chat-input", merged);
  } catch {
    /* ignore storage errors */
  }
};

/** Builds deduplicated provider display ordering for the model dropdown. */
export const buildProviderDisplayOrder = (allModels: ModelInfo[]): string[] => {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const provider of getCatalogProviderOrder()) {
    if (!seen.has(provider)) {
      seen.add(provider);
      order.push(provider);
    }
  }
  for (const model of allModels) {
    if (!seen.has(model.provider)) {
      seen.add(model.provider);
      order.push(model.provider);
    }
  }
  return order;
};

/** Checks whether `model` matches the normalized lowercase search query. */
export const matchesModelSearchQuery = (
  model: { id: string; name: string; provider: string },
  query: string,
): boolean => {
  if (!query) return true;
  if (model.name.toLowerCase().includes(query)) return true;
  return (
    model.id.toLowerCase().includes(query) ||
    model.provider.toLowerCase().includes(query)
  );
};

/** Computes updated worker pool selections when toggling a model checkbox. */
export const computeNextMultiModelPool = (opts: {
  modelId: string;
  checked: boolean;
  selectedModel: string;
  selectedWorkerModels: string[];
}): { primary: string; workers: string[] } => {
  const { modelId, checked, selectedModel, selectedWorkerModels } = opts;
  if (checked) {
    const workers =
      selectedModel === modelId
        ? selectedWorkerModels
        : [...selectedWorkerModels.filter((id) => id !== modelId), modelId];
    return { primary: selectedModel, workers };
  }
  if (selectedModel !== modelId) {
    return {
      primary: selectedModel,
      workers: selectedWorkerModels.filter((id) => id !== modelId),
    };
  }
  const [nextPrimary, ...rest] = selectedWorkerModels;
  return nextPrimary
    ? { primary: nextPrimary, workers: rest }
    : { primary: selectedModel, workers: selectedWorkerModels };
};

/** Resolves the auto provider icon slug for `resolvedAutoModel`. */
const resolveAutoIconId = (resolvedAutoModel: ModelInfo | null): string => {
  if (!resolvedAutoModel) return "auto";
  return resolvedAutoModel.id.split("/")[0] || resolvedAutoModel.id;
};

/** Counts distinct non-primary worker model IDs when `multiSelectModels` is enabled. */
const countExtraWorkerModels = (
  multiSelectModels: boolean,
  selectedModel: string,
  selectedWorkerModels: string[],
): number => {
  if (!multiSelectModels) return 0;
  return selectedWorkerModels.filter((id) => id && id !== selectedModel).length;
};

/** Resolves base display label for `Auto` vs an explicit `modelInfo`. */
const resolveBaseModelLabel = (
  isAutoSelected: boolean,
  modelInfo: ModelInfo,
  resolvedAutoModel: ModelInfo | null,
): string => {
  if (!isAutoSelected) return modelInfo.name;
  return resolvedAutoModel
    ? `Auto · ${resolvedAutoModel.provider}`
    : "Auto";
};

/** Resolves the trigger label and icon ID for the active model button. */
export const resolveModelTriggerMeta = (opts: {
  selectedModel: string;
  modelInfo: ModelInfo;
  resolvedAutoModel: ModelInfo | null;
  multiSelectModels: boolean;
  selectedWorkerModels: string[];
}): { modelName: string; activeTriggerIconId: string } => {
  const isAutoSelected =
    opts.selectedModel === "auto" || opts.modelInfo.name === "auto";
  const baseName = resolveBaseModelLabel(
    isAutoSelected,
    opts.modelInfo,
    opts.resolvedAutoModel,
  );
  const extraCount = countExtraWorkerModels(
    opts.multiSelectModels,
    opts.selectedModel,
    opts.selectedWorkerModels,
  );
  return {
    modelName: extraCount > 0 ? `${baseName} +${extraCount}` : baseName,
    activeTriggerIconId: isAutoSelected
      ? resolveAutoIconId(opts.resolvedAutoModel)
      : opts.modelInfo.id,
  };
};

export { buildComposerScrollMaskImage };
