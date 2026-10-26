"use client";

import React from "react";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context";
import { BETTERSHAPE_CLIP_CODE } from "@/features/chat/lib/bettershape-clip";
import { hasAnyUsableProvider } from "@/lib/ai/providers";
import { getProjectPath } from "@/lib/backend";
import type { BrowserPickedElement } from "@/lib/backend/types";
import {
  getCatalogDefaultEnabledIds,
  getCatalogModels,
  useBetterShapeCatalog,
} from "@/lib/catalog/store";
import {
  computeComposerScrollMask,
  syncComposerOverlayScroll,
} from "@/lib/chat/composer-scroll";
import { registerElementMention } from "@/lib/chat/element-mentions";
import { warmComposerResources } from "@/lib/chat/mention-warm-cache";
import { shortenMentionTokensInText } from "@/lib/chat/mentions";
import {
  isUnmodifiedHistoryRecall,
  mergeNewestFirstPrompts,
  type PromptHistoryCursor,
} from "@/lib/chat/prompt-history";
import { listSkills, subscribeSkills, type Skill } from "@/lib/chat/skills";
import { peekPluginsCache, type PluginRow } from "@/lib/plugins/api";
import { useSettings } from "@/lib/settings";
import {
  getVisibleModels,
  resolveChatModels,
  sanitizeEnabledModels,
  type ModelInfo,
} from "@/lib/settings/models";
import { cn } from "@/lib/utils";
import { MediaLightbox } from "../blocks/lightbox";
import type { QuotedExcerpt } from "../quote-selection";
import { dispatchToChatSurface } from "../shell/find-bar";
import type { ComposerTaskItem } from "./activity";
import { ComposerAttachments, type ComposerAttachment } from "./attachments";
import {
  ComposerContextMenuItems,
  ComposerContextStrip,
  ComposerFooterBar,
  ComposerHighlightMirror,
  ComposerPlusMenu,
  ComposerQuotesStrip,
  ComposerRightActions,
  IDLE_COMPOSER_HINTS,
  RotatingComposerHint,
} from "./input-controls";
import {
  ACCEPT_STRING,
  COMPOSER_LINE_HEIGHT,
  buildComposerScrollMaskImage,
  buildProviderDisplayOrder,
  computeMissingModelsOnly,
  detectComposerTrigger,
  hasActiveTauriBridge,
  hasAtLeastTwoNewlines,
  isAllowedFile,
  isToggleExpandShortcut,
  measureAndSyncComposerTextarea,
  observeComposerGeometry,
  pasteClipboardTextViaContextMenu,
  persistUnmountedInlineSwap,
  processComposerDropTransfer,
  processComposerPasteEvent,
  resolveArrowDownAction,
  resolveArrowUpAction,
  resolveAutoTargetModel,
  resolveEscapeDraftRestore,
  resolveModelTriggerMeta,
  resolveVesselRadiusClass,
  shouldComposerBreakAll,
  shouldGlobalEscapeStop,
  type ActiveTriggerState,
} from "./input-helpers";
import { MentionPicker } from "./mentions";
import type { QueuedMessage } from "./queue";
import {
  modelSupportsSuperThinking,
  type ReasoningEffort,
} from "./reasoning-effort";

export { shouldComposerBreakAll };
export type { ReasoningEffort };

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
  pendingEdits?: {
    id: string;
    file: string;
    original: string;
    replacement: string;
    baseline?: string;
  }[];
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

const FALLBACK_AUTO_MODEL: ModelInfo = {
  id: "auto",
  name: "Auto",
  description: "Picks a fast model for everyday work.",
  provider: "Auto",
  inputCost: 0,
  cachedInputCost: 0,
  outputCost: 0,
  contextWindow: "200K",
  releaseDate: "Rolling",
};

/** Safely reads the active workspace project path without throwing. */
const safeReadProjectPath = (): string | null => {
  try {
    return getProjectPath();
  } catch {
    return null;
  }
};

/** Resolves ARIA label for the composer `<textarea>` based on provider setup state. */
const resolveComposerAriaLabel = (
  needsSignIn: boolean,
  missingModelsOnly: boolean,
): string => {
  if (!needsSignIn) return IDLE_COMPOSER_HINTS[0];
  return missingModelsOnly
    ? "Add or fetch a model ID in Settings → Providers to chat"
    : "Add an API key in Settings → Providers to chat";
};

/** Resolves placeholder hint mode from `isPreparing` and `isLoading`. */
const resolveComposerHintMode = (
  isPreparing: boolean,
  isLoading: boolean,
): "idle" | "active" | "preparing" => {
  if (isPreparing) return "preparing";
  return isLoading ? "active" : "idle";
};

/** Checks whether attachments currently block sending or queueing. */
const areAttachmentsBlockingSend = (
  isLoading: boolean,
  uploadedFiles: ComposerAttachment[],
): boolean => {
  if (uploadedFiles.some((att) => att.status === "processing")) return true;
  return isLoading && uploadedFiles.length > 0;
};

/** Checks whether a trimmed prompt can be saved to prompt history on submit. */
const isPromptEligibleForHistory = (opts: {
  trimmed: string;
  needsSignIn: boolean;
  isPreparing: boolean;
  isLoading: boolean;
  uploadedFiles: ComposerAttachment[];
}): boolean => {
  if (!opts.trimmed || opts.needsSignIn || opts.isPreparing) return false;
  if (areAttachmentsBlockingSend(opts.isLoading, opts.uploadedFiles)) {
    return false;
  }
  return !/^\/compact\b/i.test(opts.trimmed);
};

/** Appends `trimmed` to `prev` when not an immediate duplicate (capped at 50). */
const appendSessionPrompt = (prev: string[], trimmed: string): string[] =>
  prev[prev.length - 1] === trimmed ? prev : [...prev.slice(-49), trimmed];

/** Checks whether the composer can stop an active preparation or generation turn. */
const canStopComposerTurn = (
  isPreparing: boolean,
  isLoading: boolean,
  hasText: boolean,
  activeQuotesCount: number,
): boolean =>
  isPreparing || (isLoading && !hasText && activeQuotesCount === 0);

/** Checks whether the composer has any non-empty text, attachment, or quote payload. */
const hasAnySendableComposerPayload = (
  hasText: boolean,
  uploadedCount: number,
  activeQuotesCount: number,
): boolean => hasText || uploadedCount > 0 || activeQuotesCount > 0;

/** Checks whether the send button is disabled when `canStop` is false. */
const isSendDisabledWithoutStop = (
  readyToSend: boolean,
  hasPayload: boolean,
): boolean => !readyToSend || !hasPayload;

/** Checks whether the send button uses its active accent appearance. */
const isSendButtonVisuallyActive = (
  readyToSend: boolean,
  hasPayload: boolean,
  isLoading: boolean,
): boolean => readyToSend && (hasPayload || isLoading);

/** Computes Send / Stop button disabled and active visual states. */
const deriveComposerSendStatus = (opts: {
  isPreparing: boolean;
  isLoading: boolean;
  needsSignIn: boolean;
  inputValue: string;
  uploadedFiles: ComposerAttachment[];
  activeQuotesCount: number;
}): { canStop: boolean; sendDisabled: boolean; sendActive: boolean } => {
  const hasText = Boolean(opts.inputValue.trim());
  const canStop = canStopComposerTurn(
    opts.isPreparing,
    opts.isLoading,
    hasText,
    opts.activeQuotesCount,
  );
  const attBlocked = areAttachmentsBlockingSend(
    opts.isLoading,
    opts.uploadedFiles,
  );
  const hasPayload = hasAnySendableComposerPayload(
    hasText,
    opts.uploadedFiles.length,
    opts.activeQuotesCount,
  );
  const readyToSend = !opts.needsSignIn && !attBlocked;
  return {
    canStop,
    sendDisabled: !canStop && isSendDisabledWithoutStop(readyToSend, hasPayload),
    sendActive:
      canStop ||
      isSendButtonVisuallyActive(readyToSend, hasPayload, opts.isLoading),
  };
};

/** Checks whether any context strip item exists above the composer vessel. */
const hasAnyContextStripItems = (
  pendingCount: number,
  queuedCount: number,
  ruleCount: number,
  taskCount: number,
): boolean =>
  pendingCount > 0 || queuedCount > 0 || ruleCount > 0 || taskCount > 0;

/** Focuses `<textarea>` and moves caret to `pos` on the next animation frame. */
const scheduleFocusAtPosition = (
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  pos: number,
): void => {
  requestAnimationFrame(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.focus();
    node.setSelectionRange(pos, pos);
  });
};

/** Builds text with `token` inserted at the last `triggerChar` before `caret`. */
const replaceTriggerAtCaret = (
  inputValue: string,
  caret: number,
  triggerChar: "@" | "/",
  token: string,
): string | null => {
  const before = inputValue.slice(0, caret);
  const idx = before.lastIndexOf(triggerChar);
  if (idx === -1) return null;
  return `${before.slice(0, idx)}${token}${inputValue.slice(caret)}`;
};

/** Builds padded inline insertion text around `caret`. */
const insertSpacedTokenAtCaret = (
  val: string,
  caret: number,
  token: string,
): { next: string; pos: number } => {
  const before = val.slice(0, caret);
  const after = val.slice(caret);
  const lead = before && !/\s$/.test(before) ? " " : "";
  const trail = after && /^\s/.test(after) ? "" : " ";
  const next = `${before}${lead}${token}${trail}${after}`;
  return {
    next,
    pos: before.length + lead.length + token.length + trail.length,
  };
};

/** Builds newline-padded prompt text when external files include an accompanying prompt. */
const appendAttachedPromptLine = (cur: string, prompt: string): string =>
  cur.trim() ? `${cur.trimEnd()}\n${prompt}` : prompt;

/** Collapses leading horizontal spaces on `after` and prefixes a single space when needed after `text`. */
const formatDictatedSuffix = (text: string, after: string): string => {
  const trimmedAfter = after.replace(/^[ \t]+/u, "");
  if (!trimmedAfter) return "";
  const needsSpace = !/^\s/u.test(trimmedAfter) && !/\s$/u.test(text);
  return `${needsSpace ? " " : ""}${trimmedAfter}`;
};

/** Inserts dictated speech text around `caret` with clean single-space padding and returns next caret. */
export const insertDictatedSlice = (
  val: string,
  caret: number,
  text: string,
): { next: string; caret: number } => {
  const clampedCaret = Math.max(0, Math.min(caret, val.length));
  const before = val.slice(0, clampedCaret);
  const after = val.slice(clampedCaret);
  const pad = before && !/\s$/u.test(before) ? " " : "";
  return {
    next: `${before}${pad}${text}${formatDictatedSuffix(text, after)}`,
    caret: before.length + pad.length + text.length,
  };
};

/** Subscribes to external composer DOM custom events (`quote`, `focus`, `element`, `files`, `dictation`, `media`). */
const useComposerWindowBridges = (opts: {
  quotedExcerpts: QuotedExcerpt[] | undefined;
  setLocalQuotes: React.Dispatch<React.SetStateAction<QuotedExcerpt[]>>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  inputValueRef: React.RefObject<string>;
  historyCursorRef: React.MutableRefObject<PromptHistoryCursor | null>;
  applyProgrammaticInputValue: (next: string) => void;
  addUploadedFiles: (files: File[]) => void;
  setMediaViewer: React.Dispatch<
    React.SetStateAction<{
      src?: string;
      title?: string;
      kind: "image" | "html";
    } | null>
  >;
}) => {
  const {
    quotedExcerpts,
    setLocalQuotes,
    textareaRef,
    inputValueRef,
    historyCursorRef,
    applyProgrammaticInputValue,
    addUploadedFiles,
    setMediaViewer,
  } = opts;

  React.useEffect(() => {
    if (quotedExcerpts !== undefined) return undefined;
    let raf = 0;
    /** Handles `bettershape-chat-quote-selection` window events. */
    const onQuote = (event: Event) => {
      const detail = (
        event as CustomEvent<{ id?: string; text?: string } | undefined>
      ).detail;
      const text = detail?.text?.trim();
      if (!text) return;
      const id = detail?.id || `${Date.now()}`;
      setLocalQuotes((prev) =>
        prev.some((q) => q.text === text) ? prev : [...prev.slice(-7), { id, text }],
      );
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        textareaRef.current?.focus();
      });
    };
    window.addEventListener(
      "bettershape-chat-quote-selection",
      onQuote as EventListener,
    );
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener(
        "bettershape-chat-quote-selection",
        onQuote as EventListener,
      );
    };
  }, [quotedExcerpts, setLocalQuotes, textareaRef]);

  React.useEffect(() => {
    let raf = 0;
    /** Handles `bettershape-chat-focus-input` window events. */
    const onFocusInput = (e: Event) => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const caretEnd = (
        e as CustomEvent<{ caretEnd?: boolean } | undefined>
      ).detail?.caretEnd;
      if (!caretEnd) return;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        const node = textareaRef.current;
        if (node) node.setSelectionRange(node.value.length, node.value.length);
      });
    };
    window.addEventListener(
      "bettershape-chat-focus-input",
      onFocusInput as EventListener,
    );
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener(
        "bettershape-chat-focus-input",
        onFocusInput as EventListener,
      );
    };
  }, [textareaRef]);

  React.useEffect(() => {
    let raf = 0;
    /** Handles `bettershape-chat-attach-element` browser picker events. */
    const onElement = (e: Event) => {
      const detail = (e as CustomEvent<BrowserPickedElement>).detail;
      if (!detail?.tag) return;
      const token = registerElementMention(detail);
      const val = inputValueRef.current;
      const caret = textareaRef.current?.selectionStart ?? val.length;
      const { next, pos } = insertSpacedTokenAtCaret(val, caret, token);
      applyProgrammaticInputValue(next);
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(pos, pos);
      });
    };
    window.addEventListener(
      "bettershape-chat-attach-element",
      onElement as EventListener,
    );
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener(
        "bettershape-chat-attach-element",
        onElement as EventListener,
      );
    };
  }, [applyProgrammaticInputValue, inputValueRef, textareaRef]);

  React.useEffect(() => {
    let raf = 0;
    /** Handles `bettershape-chat-attach-files` workbench events. */
    const onAttachFiles = (e: Event) => {
      const detail = (
        e as CustomEvent<{ files?: File[]; prompt?: string }>
      ).detail;
      const incoming = detail?.files?.filter(Boolean) ?? [];
      if (incoming.length > 0) {
        historyCursorRef.current = null;
        addUploadedFiles(incoming);
      }
      if (detail?.prompt) {
        applyProgrammaticInputValue(
          appendAttachedPromptLine(inputValueRef.current, detail.prompt),
        );
      }
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        textareaRef.current?.focus();
      });
    };
    window.addEventListener(
      "bettershape-chat-attach-files",
      onAttachFiles as EventListener,
    );
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener(
        "bettershape-chat-attach-files",
        onAttachFiles as EventListener,
      );
    };
  }, [
    addUploadedFiles,
    applyProgrammaticInputValue,
    historyCursorRef,
    inputValueRef,
    textareaRef,
  ]);

  React.useEffect(() => {
    /** Handles `bettershape-open-media` lightbox events. */
    const onOpen = (e: Event) => {
      const detail = (
        e as CustomEvent<{
          src: string;
          title?: string;
          kind?: "image" | "html";
        }>
      ).detail;
      if (!detail?.src) return;
      setMediaViewer({
        src: detail.src,
        title: detail.title,
        kind: detail.kind || "image",
      });
    };
    window.addEventListener("bettershape-open-media", onOpen as EventListener);
    return () =>
      window.removeEventListener(
        "bettershape-open-media",
        onOpen as EventListener,
      );
  }, [setMediaViewer]);

  React.useEffect(() => {
    let raf = 0;
    /** Handles `bettershape-dictation-text` voice transcription events. */
    const onDictation = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text;
      if (!text) return;
      const val = inputValueRef.current;
      const caret = textareaRef.current?.selectionStart ?? val.length;
      const inserted = insertDictatedSlice(val, caret, text);
      applyProgrammaticInputValue(inserted.next);
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(inserted.caret, inserted.caret);
      });
    };
    window.addEventListener(
      "bettershape-dictation-text",
      onDictation as EventListener,
    );
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener(
        "bettershape-dictation-text",
        onDictation as EventListener,
      );
    };
  }, [applyProgrammaticInputValue, inputValueRef, textareaRef]);
};

/** Resolves catalog, visible models, Auto routing target, and provider setup status. */
const useComposerModelCatalog = (
  selectedModel: string,
  setSelectedModel: (m: string) => void,
  reasoningEffort: ReasoningEffort,
  setReasoningEffort: (e: ReasoningEffort) => void,
  multiSelectModels: boolean,
  selectedWorkerModels: string[],
) => {
  const settings = useSettings();
  const needsSignIn = !hasAnyUsableProvider(settings.ai.providers);
  const { catalog } = useBetterShapeCatalog();
  const allModels = React.useMemo(
    () => resolveChatModels(catalog ? catalog.models : getCatalogModels()),
    [catalog],
  );
  const concreteAllModels = React.useMemo(
    () => allModels.filter((m) => m.id !== "auto"),
    [allModels],
  );
  const missingModelsOnly = React.useMemo(
    () =>
      computeMissingModelsOnly(
        needsSignIn,
        concreteAllModels.length,
        settings.ai.providers,
      ),
    [concreteAllModels.length, needsSignIn, settings.ai.providers],
  );
  const resolvedAutoModel = React.useMemo(
    () =>
      resolveAutoTargetModel(
        concreteAllModels,
        settings.ai.providers?.defaultModel,
      ),
    [concreteAllModels, settings.ai.providers],
  );
  const models = React.useMemo(() => {
    const enabled = sanitizeEnabledModels(
      settings.ai.enabledModels,
      allModels.map((m) => m.id),
      getCatalogDefaultEnabledIds(),
    );
    return getVisibleModels(allModels, enabled);
  }, [allModels, settings.ai.enabledModels]);
  const autoModel = React.useMemo(
    () => allModels.find((m) => m.id === "auto") ?? FALLBACK_AUTO_MODEL,
    [allModels],
  );
  const modelInfo = models.find((m) => m.id === selectedModel) || autoModel;
  const providerOrder = React.useMemo(
    () => buildProviderDisplayOrder(allModels),
    [allModels],
  );
  const concreteModels = React.useMemo(
    () => models.filter((m) => m.id !== "auto"),
    [models],
  );
  const effectiveModelId =
    selectedModel === "auto" && resolvedAutoModel
      ? resolvedAutoModel.id
      : selectedModel;

  React.useEffect(() => {
    if (
      reasoningEffort === "super" &&
      !modelSupportsSuperThinking(effectiveModelId)
    ) {
      setReasoningEffort("max");
    }
  }, [effectiveModelId, reasoningEffort, setReasoningEffort]);

  React.useEffect(() => {
    if (selectedModel === "auto" || concreteModels.length === 0) return;
    if (!concreteModels.some((m) => m.id === selectedModel)) {
      setSelectedModel("auto");
    }
  }, [concreteModels, selectedModel, setSelectedModel]);

  const { modelName, activeTriggerIconId } = resolveModelTriggerMeta({
    selectedModel,
    modelInfo,
    resolvedAutoModel,
    multiSelectModels,
    selectedWorkerModels,
  });

  return {
    workflows: settings.ai.workflows ?? [],
    needsSignIn,
    missingModelsOnly,
    resolvedAutoModel,
    models,
    autoModel,
    providerOrder,
    effectiveModelId,
    modelName,
    activeTriggerIconId,
  };
};

/** Manages `<textarea>` height measurement, scroll-edge masks, and `ResizeObserver` updates. */
const useComposerLayoutSync = (opts: {
  inputValue: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  mentionOverlayRef: React.RefObject<HTMLDivElement | null>;
  composerBoxRef: React.RefObject<HTMLDivElement | null>;
}) => {
  const [composerTall, setComposerTall] = React.useState(false);
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [canExpandComposer, setCanExpandComposer] = React.useState(false);
  const [editorHeight, setEditorHeight] = React.useState(COMPOSER_LINE_HEIGHT);
  const [scrollMask, setScrollMask] = React.useState({
    top: false,
    bottom: false,
  });
  const composerTallRef = React.useRef(false);
  const lastAppliedHeightRef = React.useRef(0);
  const textareaClientWidthRef = React.useRef(0);
  const composerBoxWidthRef = React.useRef(0);
  const stageHeightRef = React.useRef(760);

  if (!opts.inputValue && isExpanded) setIsExpanded(false);

  const syncEditorLayout = React.useCallback(
    (revealCaretEnd = false) => {
      const textarea = opts.textareaRef.current;
      if (!textarea) return;
      const snap = measureAndSyncComposerTextarea({
        textarea,
        overlay: opts.mentionOverlayRef.current,
        inputValue: opts.inputValue,
        isExpanded,
        revealCaretEnd,
        composerTallRef,
        lastAppliedHeightRef,
        textareaClientWidthRef,
        stageHeightRef,
      });
      setComposerTall((prev) => (prev === snap.tall ? prev : snap.tall));
      setEditorHeight((prev) => (prev === snap.height ? prev : snap.height));
      setCanExpandComposer((prev) =>
        prev === snap.canExpand ? prev : snap.canExpand,
      );
      setScrollMask((prev) =>
        prev.top === snap.mask.top && prev.bottom === snap.mask.bottom
          ? prev
          : snap.mask,
      );
    },
    [isExpanded, opts.inputValue, opts.mentionOverlayRef, opts.textareaRef],
  );

  const syncRef = React.useRef(syncEditorLayout);
  React.useLayoutEffect(() => {
    syncRef.current = syncEditorLayout;
  }, [syncEditorLayout]);

  React.useLayoutEffect(() => {
    syncEditorLayout(true);
  }, [syncEditorLayout]);

  React.useEffect(
    () =>
      observeComposerGeometry(
        opts.composerBoxRef.current,
        opts.textareaRef.current,
        { stageHeightRef, composerBoxWidthRef, textareaClientWidthRef },
        () => syncRef.current(false),
      ),
    [opts.composerBoxRef, opts.textareaRef],
  );

  return {
    composerTall,
    isExpanded,
    setIsExpanded,
    canExpandComposer,
    editorHeight,
    scrollMask,
    setScrollMask,
  };
};

/** Dispatches unmounted inline-swap events to the active chat surface. */
const dispatchUnmountedInlineSwap = (rawText: string): void => {
  persistUnmountedInlineSwap(rawText);
  dispatchToChatSurface(() => {
    window.dispatchEvent(
      new CustomEvent("bettershape-chat-insert-prompt", {
        detail: { prompt: rawText, send: false, append: true },
      }),
    );
    window.dispatchEvent(
      new CustomEvent("bettershape-chat-focus-input", {
        detail: { caretEnd: true },
      }),
    );
  });
};

/** Checks whether pointerdown on the composer vessel should focus `<textarea>`. */
const shouldVesselPointerFocusTextarea = (
  e: React.PointerEvent<HTMLDivElement>,
): boolean => {
  if (e.button !== 0) return false;
  const target = e.target instanceof Element ? e.target : null;
  return !target?.closest(
    "button, a, input, textarea, [role='menuitem'], [data-radix-collection-item], [data-composer-quotes]",
  );
};

/** Advances `index` to the next whitespace boundary in `text` (or `text.length`). */
const findTokenEndFromCaret = (text: string, index: number): number => {
  const rest = text.slice(index);
  const wsOffset = rest.search(/\s/u);
  return wsOffset === -1 ? text.length : index + wsOffset;
};

/** Computes adjusted caret index after collapsing long `@mention` path tokens, independent of suffix length. */
export const computeShortenedCaret = (
  raw: string,
  shortened: string,
  caretRaw: number,
): number => {
  const clamped = Math.max(0, Math.min(caretRaw, raw.length));
  const prefixShort = shortenMentionTokensInText(raw.slice(0, clamped));
  const suffixShort = shortenMentionTokensInText(raw.slice(clamped));
  if (`${prefixShort}${suffixShort}` === shortened) {
    return Math.min(prefixShort.length, shortened.length);
  }
  const tokenEnd = findTokenEndFromCaret(raw, clamped);
  return Math.min(
    shortenMentionTokensInText(raw.slice(0, tokenEnd)).length,
    shortened.length,
  );
};

/** Applies shortened or raw `<textarea>` change event and returns the effective caret. */
const emitInputChangeAndResolveCaret = (
  e: React.ChangeEvent<HTMLTextAreaElement>,
  shortened: string,
  onInputChange: (ev: React.ChangeEvent<HTMLTextAreaElement>) => void,
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
): number => {
  const raw = e.target.value;
  const caretRaw = e.target.selectionStart ?? raw.length;
  if (shortened === raw) {
    onInputChange(e);
    return caretRaw;
  }
  const pos = computeShortenedCaret(raw, shortened, caretRaw);
  onInputChange({
    target: { value: shortened },
  } as React.ChangeEvent<HTMLTextAreaElement>);
  requestAnimationFrame(() => {
    textareaRef.current?.setSelectionRange(pos, pos);
  });
  return pos;
};

/** Subscribes to live skill registry updates and warm-starts Tauri composer resources. */
const useComposerSkillsAndWarmup = (): Skill[] => {
  const [skills, setSkills] = React.useState<Skill[]>(() => listSkills());
  React.useEffect(() => {
    const unsubscribe = subscribeSkills(() => setSkills(listSkills()));
    return () => unsubscribe();
  }, []);
  React.useEffect(() => {
    if (!hasActiveTauriBridge()) return undefined;
    return warmComposerResources(safeReadProjectPath());
  }, []);
  return skills;
};

/** Registers global `Escape` stop listener while generation or preparation is active. */
const useGlobalEscapeStop = (opts: {
  isLoading: boolean;
  isPreparing: boolean;
  popoverOpen: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onStopMessage: () => void;
}) => {
  const { isLoading, isPreparing, popoverOpen, textareaRef, onStopMessage } =
    opts;
  React.useEffect(() => {
    if (!isLoading && !isPreparing) return undefined;
    /** Stops active stream on unmodified global `Escape`. */
    const onKey = (e: KeyboardEvent) => {
      if (shouldGlobalEscapeStop(e, popoverOpen, textareaRef.current)) {
        e.preventDefault();
        onStopMessage();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isLoading, isPreparing, onStopMessage, popoverOpen, textareaRef]);
};

/** Dispatches a resolved `ArrowUp` history or queued-edit action. */
const applyArrowUpOutcome = (
  up: NonNullable<ReturnType<typeof resolveArrowUpAction>>,
  e: React.KeyboardEvent<HTMLTextAreaElement>,
  onEditQueuedMessage: ((id: string) => void) | undefined,
  applySteppedHistory: (
    ev: React.KeyboardEvent<HTMLTextAreaElement>,
    stepped: { cursor: PromptHistoryCursor | null; value: string },
  ) => void,
): void => {
  if (up.kind === "edit-queued") {
    e.preventDefault();
    onEditQueuedMessage?.(up.id);
    return;
  }
  applySteppedHistory(e, up);
};

/** Dispatches a resolved `ArrowDown` or `Escape` history action; returns `true` when consumed. */
const applyDownOrEscapeOutcome = (opts: {
  e: React.KeyboardEvent<HTMLTextAreaElement>;
  inputValue: string;
  historyCursorRef: React.MutableRefObject<PromptHistoryCursor | null>;
  recallablePrompts: string[];
  applySteppedHistory: (
    ev: React.KeyboardEvent<HTMLTextAreaElement>,
    stepped: { cursor: PromptHistoryCursor | null; value: string },
  ) => void;
  isBusy: boolean;
}): boolean => {
  const down = resolveArrowDownAction({
    e: opts.e,
    inputValue: opts.inputValue,
    historyCursor: opts.historyCursorRef.current,
    recallablePrompts: opts.recallablePrompts,
  });
  if (down) {
    if (down.kind === "clear-cursor") opts.historyCursorRef.current = null;
    else opts.applySteppedHistory(opts.e, down);
    return down.kind === "step";
  }
  const esc = resolveEscapeDraftRestore({
    e: opts.e,
    isBusy: opts.isBusy,
    inputValue: opts.inputValue,
    historyCursor: opts.historyCursorRef.current,
  });
  if (!esc) return false;
  if (esc.kind === "clear-cursor") {
    opts.historyCursorRef.current = null;
    return false;
  }
  opts.applySteppedHistory(opts.e, { cursor: null, value: esc.draft });
  return true;
};

/** Evaluates `ArrowUp`, `ArrowDown`, and `Escape` prompt-history actions; returns `true` when consumed. */
const tryHandleHistoryKeyBranch = (opts: {
  e: React.KeyboardEvent<HTMLTextAreaElement>;
  inputValue: string;
  queuedIds: string[];
  onEditQueuedMessage?: (id: string) => void;
  historyCursorRef: React.MutableRefObject<PromptHistoryCursor | null>;
  recallablePrompts: string[];
  applySteppedHistory: (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    stepped: { cursor: PromptHistoryCursor | null; value: string },
  ) => void;
  isBusy: boolean;
}): boolean => {
  const up = resolveArrowUpAction({
    e: opts.e,
    inputValue: opts.inputValue,
    queuedIds: opts.queuedIds,
    hasEditQueuedHandler: Boolean(opts.onEditQueuedMessage),
    historyCursor: opts.historyCursorRef.current,
    recallablePrompts: opts.recallablePrompts,
  });
  if (up) {
    applyArrowUpOutcome(
      up,
      opts.e,
      opts.onEditQueuedMessage,
      opts.applySteppedHistory,
    );
    return true;
  }
  return applyDownOrEscapeOutcome(opts);
};

/** Checks whether `e` is an unmodified, non-IME `Enter` submit keydown. */
const isPlainEnterSubmit = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean =>
  e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing;

/** Handles pre-submit composer intercept keys (`Ctrl+Shift+E`, popover `Escape`, history). */
const consumeComposerInterceptKey = (opts: {
  e: React.KeyboardEvent<HTMLTextAreaElement>;
  canToggleExpand: boolean;
  toggleExpanded: () => void;
  popoverOpen: boolean;
  closePopovers: () => void;
  inputValue: string;
  queuedIds: string[];
  onEditQueuedMessage?: (id: string) => void;
  historyCursorRef: React.MutableRefObject<PromptHistoryCursor | null>;
  recallablePrompts: string[];
  applySteppedHistory: (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    stepped: { cursor: PromptHistoryCursor | null; value: string },
  ) => void;
  isBusy: boolean;
}): boolean => {
  if (isToggleExpandShortcut(opts.e, opts.canToggleExpand)) {
    opts.e.preventDefault();
    opts.toggleExpanded();
    return true;
  }
  if (opts.e.defaultPrevented) return true;
  if (opts.popoverOpen && opts.e.key === "Escape") {
    opts.e.preventDefault();
    opts.closePopovers();
    return true;
  }
  return tryHandleHistoryKeyBranch(opts);
};

/** Handles prompt history navigation and special shortcuts before delegating `onKeyDown`. */
const handleComposerKeyDownFlow = (opts: {
  e: React.KeyboardEvent<HTMLTextAreaElement>;
  canToggleExpand: boolean;
  toggleExpanded: () => void;
  popoverOpen: boolean;
  closePopovers: () => void;
  inputValue: string;
  queuedIds: string[];
  onEditQueuedMessage?: (id: string) => void;
  historyCursorRef: React.MutableRefObject<PromptHistoryCursor | null>;
  recallablePrompts: string[];
  applySteppedHistory: (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    stepped: { cursor: PromptHistoryCursor | null; value: string },
  ) => void;
  isBusy: boolean;
  recordIfEligible: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}): void => {
  if (consumeComposerInterceptKey(opts)) return;
  if (isPlainEnterSubmit(opts.e)) {
    opts.recordIfEligible();
    opts.historyCursorRef.current = null;
  }
  opts.onKeyDown(opts.e);
};

/** Renders hidden file and directory `<input type="file">` pickers for the composer. */
const HiddenComposerFileInputs = ({
  onChange,
}: {
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) => (
  <div className="contents">
    <input
      type="file"
      id="chat-media-upload"
      className="hidden"
      multiple
      accept={ACCEPT_STRING}
      onChange={onChange}
    />
    <input
      type="file"
      id="chat-folder-upload"
      className="hidden"
      multiple
      {...{ webkitdirectory: "", directory: "" }}
      onChange={onChange}
    />
  </div>
);

/** Encapsulates drag-over depth tracking and file/clip drop handlers for the composer vessel. */
const useComposerDragAndDrop = (opts: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  inputValue: string;
  addUploadedFiles: (files: File[]) => void;
  clearHistoryCursor: () => void;
  applyProgrammaticInputValue: (next: string) => void;
}) => {
  const [dragOver, setDragOver] = React.useState(false);
  const dragDepth = React.useRef(0);

  const onDrop = React.useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepth.current = 0;
      setDragOver(false);
      processComposerDropTransfer({
        dataTransfer: e.dataTransfer,
        textarea: opts.textareaRef.current,
        inputValue: opts.inputValue,
        addUploadedFiles: opts.addUploadedFiles,
        clearHistoryCursor: opts.clearHistoryCursor,
        applyProgrammaticInputValue: opts.applyProgrammaticInputValue,
      });
    },
    [opts],
  );

  const onDragEnter = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current += 1;
    const types = e.dataTransfer.types;
    if (types.includes("Files") || types.includes(BETTERSHAPE_CLIP_CODE)) {
      setDragOver(true);
    }
  }, []);

  const onDragLeave = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  }, []);

  const onDragOver = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return { dragOver, onDrop, onDragEnter, onDragLeave, onDragOver };
};

/** Renders the center `<textarea>` + mirror + rotating hint column inside the composer vessel. */
const ComposerEditorColumn = ({
  textareaRef,
  mentionOverlayRef,
  inputValue,
  workflows,
  isExpanded,
  editorHeight,
  editorMaskImage,
  isEditorFocused,
  setIsEditorFocused,
  hintMode,
  needsSignIn,
  missingModelsOnly,
  composerBreakAll,
  composerAriaLabel,
  onChange,
  onKeyDown,
  onPaste,
  onSelect,
  onScroll,
  onContextMenuPaste,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  mentionOverlayRef: React.RefObject<HTMLDivElement | null>;
  inputValue: string;
  workflows: ReturnType<typeof useSettings>["ai"]["workflows"];
  isExpanded: boolean;
  editorHeight: number;
  editorMaskImage: string | undefined;
  isEditorFocused: boolean;
  setIsEditorFocused: (focused: boolean) => void;
  hintMode: "idle" | "active" | "preparing";
  needsSignIn: boolean;
  missingModelsOnly: boolean;
  composerBreakAll: boolean;
  composerAriaLabel: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (e: React.ClipboardEvent) => void;
  onSelect: (e: React.SyntheticEvent<HTMLTextAreaElement>) => void;
  onScroll: (e: React.UIEvent<HTMLTextAreaElement>) => void;
  onContextMenuPaste: () => void;
}) => (
  <div
    className={cn(
      "relative min-h-[32px] min-w-0 flex-1 py-[5px] transition-[height] motion-reduce:transition-none",
      isExpanded
        ? "duration-[var(--spring-panel-dur)] ease-[var(--spring-panel)]"
        : "duration-[var(--spring-quick-dur)] ease-[var(--spring-quick)]",
    )}
    style={{ height: `${editorHeight + 10}px` }}
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
      <ComposerHighlightMirror
        overlayRef={mentionOverlayRef}
        inputValue={inputValue}
        workflows={workflows ?? []}
        composerBreakAll={composerBreakAll}
      />
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onSelect={onSelect}
            onScroll={onScroll}
            onFocus={() => {
              setIsEditorFocused(true);
              if (hasActiveTauriBridge()) {
                warmComposerResources(safeReadProjectPath());
              }
            }}
            onBlur={() => setIsEditorFocused(false)}
            placeholder=""
            aria-label={composerAriaLabel}
            rows={1}
            className={cn(
              "custom-scrollbar relative z-[1] block min-h-[22px] w-full resize-none overflow-x-hidden border-none bg-transparent px-1.5 py-0 text-sm font-medium leading-[22px] text-transparent outline-none placeholder:text-text-muted selection:bg-accent/30 whitespace-pre-wrap",
              composerBreakAll ? "break-all" : "break-words",
            )}
            style={{ caretColor: "var(--text-primary)" }}
          />
        </ContextMenuTrigger>
        <ComposerContextMenuItems
          onPasteClick={onContextMenuPaste}
          onSelectAllClick={() => {
            const el = textareaRef.current;
            if (!el) return;
            el.focus();
            el.select();
          }}
        />
      </ContextMenu>
    </div>
  </div>
);

/** Manages `@mention` / `/workflow` trigger state, text edits, and inline attachment swaps. */
const useComposerTextController = ({
  inputValue,
  onInputChange,
  setUploadedFiles,
  textareaRef,
  historyCursorRef,
  inputValueRef,
}: {
  inputValue: string;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  setUploadedFiles: React.Dispatch<React.SetStateAction<ComposerAttachment[]>>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  historyCursorRef: React.MutableRefObject<PromptHistoryCursor | null>;
  inputValueRef: React.MutableRefObject<string>;
}) => {
  const [trigger, setTrigger] = React.useState<ActiveTriggerState>({
    mentionOpen: false,
    mentionQuery: "",
    mentionCaret: 0,
    slashOpen: false,
    slashQuery: "",
  });
  const isMountedRef = React.useRef(true);
  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const closeTriggers = React.useCallback(() => {
    setTrigger((prev) =>
      prev.mentionOpen || prev.slashOpen
        ? {
            mentionOpen: false,
            mentionQuery: "",
            mentionCaret: 0,
            slashOpen: false,
            slashQuery: "",
          }
        : prev,
    );
  }, []);

  const applyProgrammaticInputValue = React.useCallback(
    (nextValue: string) => {
      historyCursorRef.current = null;
      onInputChange({
        target: { value: nextValue },
      } as React.ChangeEvent<HTMLTextAreaElement>);
    },
    [historyCursorRef, onInputChange],
  );

  React.useEffect(() => {
    const shortened = shortenMentionTokensInText(inputValue);
    if (shortened !== inputValue) applyProgrammaticInputValue(shortened);
  }, [applyProgrammaticInputValue, inputValue]);

  const handleInputChangeWithMentions = React.useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      historyCursorRef.current = null;
      const shortened = shortenMentionTokensInText(e.target.value);
      const caret = emitInputChangeAndResolveCaret(
        e,
        shortened,
        onInputChange,
        textareaRef,
      );
      setTrigger(detectComposerTrigger(shortened, caret));
    },
    [historyCursorRef, onInputChange, textareaRef],
  );

  const insertPickedTrigger = React.useCallback(
    (char: "@" | "/", token: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const caret = textarea.selectionStart ?? inputValue.length;
      const next = replaceTriggerAtCaret(inputValue, caret, char, token);
      if (next === null) return;
      applyProgrammaticInputValue(next);
      closeTriggers();
      requestAnimationFrame(() => textarea.focus());
    },
    [applyProgrammaticInputValue, closeTriggers, inputValue, textareaRef],
  );

  const appendToken = React.useCallback(
    (token: string) => {
      const caret = textareaRef.current?.selectionStart ?? inputValue.length;
      const { next, pos } = insertSpacedTokenAtCaret(inputValue, caret, token);
      applyProgrammaticInputValue(next);
      scheduleFocusAtPosition(textareaRef, pos);
    },
    [applyProgrammaticInputValue, inputValue, textareaRef],
  );

  const swapAttachmentInline = React.useCallback(
    (targetFile: File, rawText: string) => {
      setUploadedFiles((prev) =>
        prev.filter((att) => att.file !== targetFile),
      );
      if (!isMountedRef.current || !textareaRef.current?.isConnected) {
        dispatchUnmountedInlineSwap(rawText);
        return;
      }
      const cur = inputValueRef.current;
      const pad = cur.trim() ? `${cur.trimEnd()}\n\n` : "";
      const next = `${pad}${rawText}`;
      applyProgrammaticInputValue(next);
      scheduleFocusAtPosition(textareaRef, next.length);
    },
    [applyProgrammaticInputValue, inputValueRef, setUploadedFiles, textareaRef],
  );

  return {
    trigger,
    setTrigger,
    closeTriggers,
    applyProgrammaticInputValue,
    handleInputChangeWithMentions,
    insertMention: (t: string) => insertPickedTrigger("@", t),
    insertSlash: (t: string) => insertPickedTrigger("/", t),
    appendToken,
    swapAttachmentInline,
  };
};

/** Resolves `MentionPicker` query, mode, and pick callback from `trigger`. */
const resolveMentionPickerBindings = (
  trigger: ActiveTriggerState,
  insertSlash: (token: string) => void,
  insertMention: (token: string) => void,
) =>
  trigger.slashOpen
    ? {
        query: trigger.slashQuery,
        mode: "slash" as const,
        onPick: insertSlash,
      }
    : {
        query: trigger.mentionQuery,
        mode: "mention" as const,
        onPick: insertMention,
      };

/** Renders the main composer vessel (`MentionPicker`, quotes, attachments, `+` menu, editor, actions). */
const ComposerVesselCard = ({
  composerBoxRef,
  textareaRef,
  mentionOverlayRef,
  isExpandedLayout,
  isExpanded,
  vesselRadiusClass,
  drag,
  trigger,
  setTrigger,
  closeTriggers,
  workflows,
  insertSlash,
  insertMention,
  activeQuotes,
  onRemoveQuote,
  uploadedFiles,
  setUploadedFiles,
  inputValue,
  applyProgrammaticInputValue,
  onFileInputChange,
  plusMenuOpen,
  setPlusMenuOpen,
  plusPlugins,
  setPlusPlugins,
  pluginQuery,
  setPluginQuery,
  skills,
  appendToken,
  editorHeight,
  editorMaskImage,
  isEditorFocused,
  setIsEditorFocused,
  hintMode,
  needsSignIn,
  missingModelsOnly,
  composerBreakAll,
  composerAriaLabel,
  onInputChange,
  onKeyDown,
  onPaste,
  onScrollMask,
  onContextMenuPaste,
  showExpandButton,
  onToggleExpand,
  canStop,
  isPreparing,
  isLoading,
  sendDisabled,
  sendActive,
  onStopMessage,
  onSendWithHistory,
}: {
  composerBoxRef: React.RefObject<HTMLDivElement | null>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  mentionOverlayRef: React.RefObject<HTMLDivElement | null>;
  isExpandedLayout: boolean;
  isExpanded: boolean;
  vesselRadiusClass: string;
  drag: ReturnType<typeof useComposerDragAndDrop>;
  trigger: ActiveTriggerState;
  setTrigger: React.Dispatch<React.SetStateAction<ActiveTriggerState>>;
  closeTriggers: () => void;
  workflows: ReturnType<typeof useSettings>["ai"]["workflows"];
  insertSlash: (token: string) => void;
  insertMention: (token: string) => void;
  activeQuotes: QuotedExcerpt[];
  onRemoveQuote: (id: string) => void;
  uploadedFiles: ComposerAttachment[];
  setUploadedFiles: React.Dispatch<React.SetStateAction<ComposerAttachment[]>>;
  inputValue: string;
  applyProgrammaticInputValue: (next: string) => void;
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  plusMenuOpen: boolean;
  setPlusMenuOpen: (open: boolean) => void;
  plusPlugins: PluginRow[];
  setPlusPlugins: React.Dispatch<React.SetStateAction<PluginRow[]>>;
  pluginQuery: string;
  setPluginQuery: (q: string) => void;
  skills: Skill[];
  appendToken: (token: string) => void;
  editorHeight: number;
  editorMaskImage: string | undefined;
  isEditorFocused: boolean;
  setIsEditorFocused: (focused: boolean) => void;
  hintMode: "idle" | "active" | "preparing";
  needsSignIn: boolean;
  missingModelsOnly: boolean;
  composerBreakAll: boolean;
  composerAriaLabel: string;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (e: React.ClipboardEvent) => void;
  onScrollMask: (next: { top: boolean; bottom: boolean }) => void;
  onContextMenuPaste: () => void;
  showExpandButton: boolean;
  onToggleExpand: () => void;
  canStop: boolean;
  isPreparing: boolean;
  isLoading: boolean;
  sendDisabled: boolean;
  sendActive: boolean;
  onStopMessage: () => void;
  onSendWithHistory: () => void;
}) => {
  const pickerOpen = trigger.mentionOpen || trigger.slashOpen;
  const pickerBindings = resolveMentionPickerBindings(
    trigger,
    insertSlash,
    insertMention,
  );
  return (
    <div
      ref={composerBoxRef}
      data-expanded-layout={String(isExpandedLayout)}
      data-expanded-sheet={String(isExpanded)}
      className={cn(
        "relative flex w-full cursor-text flex-col border p-[5px]",
        "border-border-subtle bg-surface-4 shadow-2xs focus-within:border-border-secondary",
        "transition-[border-radius,background-color,border-color,box-shadow] duration-[var(--spring-panel-dur)] ease-[var(--spring-panel)] motion-reduce:transition-none",
        vesselRadiusClass,
        drag.dragOver && "border-border bg-surface-3/90",
      )}
      onPointerDown={(e) => {
        if (shouldVesselPointerFocusTextarea(e)) {
          requestAnimationFrame(() => textareaRef.current?.focus());
        }
      }}
      onDrop={drag.onDrop}
      onDragEnter={drag.onDragEnter}
      onDragLeave={drag.onDragLeave}
      onDragOver={drag.onDragOver}
    >
      {drag.dragOver ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] border-2 border-border-subtle bg-surface-3/95">
          <p className="text-sm font-medium text-text-primary">
            Drop files to attach
          </p>
        </div>
      ) : null}
      <MentionPicker
        open={pickerOpen}
        query={pickerBindings.query}
        mode={pickerBindings.mode}
        workflows={workflows}
        onPick={pickerBindings.onPick}
        onClose={closeTriggers}
        anchorRef={textareaRef}
        boxRef={composerBoxRef}
        caretIndex={trigger.mentionCaret}
      />
      <ComposerQuotesStrip quotes={activeQuotes} onRemoveQuote={onRemoveQuote} />
      <ComposerAttachments
        attachments={uploadedFiles}
        onRemove={(id) =>
          setUploadedFiles((prev) => prev.filter((a) => a.id !== id))
        }
        onInsertInline={(id, text) => {
          setUploadedFiles((prev) => prev.filter((a) => a.id !== id));
          const pad = inputValue.trim() ? `${inputValue.trimEnd()}\n\n` : "";
          const next = `${pad}${text}`;
          applyProgrammaticInputValue(next);
          scheduleFocusAtPosition(textareaRef, next.length);
        }}
      />
      <HiddenComposerFileInputs onChange={onFileInputChange} />
      <div className="relative flex w-full items-end gap-1 px-0.5">
        <ComposerPlusMenu
          open={plusMenuOpen}
          onOpenChange={setPlusMenuOpen}
          plusPlugins={plusPlugins}
          setPlusPlugins={setPlusPlugins}
          pluginQuery={pluginQuery}
          setPluginQuery={setPluginQuery}
          skills={skills}
          appendToken={appendToken}
        />
        <ComposerEditorColumn
          textareaRef={textareaRef}
          mentionOverlayRef={mentionOverlayRef}
          inputValue={inputValue}
          workflows={workflows}
          isExpanded={isExpanded}
          editorHeight={editorHeight}
          editorMaskImage={editorMaskImage}
          isEditorFocused={isEditorFocused}
          setIsEditorFocused={setIsEditorFocused}
          hintMode={hintMode}
          needsSignIn={needsSignIn}
          missingModelsOnly={missingModelsOnly}
          composerBreakAll={composerBreakAll}
          composerAriaLabel={composerAriaLabel}
          onChange={onInputChange}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onSelect={(e) => {
            if (!pickerOpen) return;
            const el = e.currentTarget;
            setTrigger(detectComposerTrigger(el.value, el.selectionStart ?? 0));
          }}
          onScroll={(e) => {
            const el = e.currentTarget;
            syncComposerOverlayScroll(el, mentionOverlayRef.current);
            onScrollMask(computeComposerScrollMask(el));
          }}
          onContextMenuPaste={onContextMenuPaste}
        />
        <ComposerRightActions
          showExpandButton={showExpandButton}
          isExpanded={isExpanded}
          onToggleExpand={onToggleExpand}
          canStop={canStop}
          isPreparing={isPreparing}
          isLoading={isLoading}
          sendDisabled={sendDisabled}
          sendActive={sendActive}
          onStopMessage={onStopMessage}
          onSendWithHistory={onSendWithHistory}
        />
      </div>
    </div>
  );
};

/** Checks whether expanded composer mode can be toggled via keyboard shortcut. */
const canToggleComposerExpansion = (
  canExpandComposer: boolean,
  isExpanded: boolean,
  inputValue: string,
  composerTall: boolean,
): boolean =>
  canExpandComposer || isExpanded || (Boolean(inputValue) && composerTall);

/** Coordinates prompt-history recall, send recording, and `onKeyDown` delegation. */
const useComposerHistoryAndKeys = ({
  inputValue,
  promptHistory,
  needsSignIn,
  isPreparing,
  isLoading,
  uploadedFiles,
  queuedMessages,
  onEditQueuedMessage,
  onInputChange,
  onKeyDown,
  onSendMessage,
  textareaRef,
  historyCursorRef,
  canExpandComposer,
  isExpanded,
  setIsExpanded,
  composerTall,
  popoverOpen,
  closeTriggers,
}: {
  inputValue: string;
  promptHistory: string[];
  needsSignIn: boolean;
  isPreparing: boolean;
  isLoading: boolean;
  uploadedFiles: ComposerAttachment[];
  queuedMessages: QueuedMessage[];
  onEditQueuedMessage?: (id: string) => void;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onSendMessage: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  historyCursorRef: React.MutableRefObject<PromptHistoryCursor | null>;
  canExpandComposer: boolean;
  isExpanded: boolean;
  setIsExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  composerTall: boolean;
  popoverOpen: boolean;
  closeTriggers: () => void;
}) => {
  const [sessionSentPrompts, setSessionSentPrompts] = React.useState<string[]>(
    [],
  );
  const recallablePrompts = React.useMemo(
    () => mergeNewestFirstPrompts(promptHistory, sessionSentPrompts),
    [promptHistory, sessionSentPrompts],
  );
  const recordIfEligible = React.useCallback(() => {
    const trimmed = inputValue.trim();
    if (
      isPromptEligibleForHistory({
        trimmed,
        needsSignIn,
        isPreparing,
        isLoading,
        uploadedFiles,
      })
    ) {
      setSessionSentPrompts((prev) => appendSessionPrompt(prev, trimmed));
    }
  }, [inputValue, isLoading, isPreparing, needsSignIn, uploadedFiles]);
  const handleSendWithHistory = React.useCallback(() => {
    recordIfEligible();
    historyCursorRef.current = null;
    onSendMessage();
  }, [historyCursorRef, onSendMessage, recordIfEligible]);
  const applySteppedHistory = React.useCallback(
    (
      e: React.KeyboardEvent<HTMLTextAreaElement>,
      stepped: { cursor: PromptHistoryCursor | null; value: string },
    ) => {
      e.preventDefault();
      historyCursorRef.current = stepped.cursor;
      onInputChange({
        target: { value: stepped.value },
      } as React.ChangeEvent<HTMLTextAreaElement>);
      requestAnimationFrame(() => {
        textareaRef.current?.setSelectionRange(
          stepped.value.length,
          stepped.value.length,
        );
      });
    },
    [historyCursorRef, onInputChange, textareaRef],
  );
  const canToggleExpand = canToggleComposerExpansion(
    canExpandComposer,
    isExpanded,
    inputValue,
    composerTall,
  );
  const onComposerKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) =>
      handleComposerKeyDownFlow({
        e,
        canToggleExpand,
        toggleExpanded: () => setIsExpanded((prev) => !prev),
        popoverOpen,
        closePopovers: closeTriggers,
        inputValue,
        queuedIds: queuedMessages.map((q) => q.id),
        onEditQueuedMessage,
        historyCursorRef,
        recallablePrompts,
        applySteppedHistory,
        isBusy: isLoading || isPreparing,
        recordIfEligible,
        onKeyDown,
      }),
    [
      applySteppedHistory,
      canToggleExpand,
      closeTriggers,
      historyCursorRef,
      inputValue,
      isLoading,
      isPreparing,
      onEditQueuedMessage,
      onKeyDown,
      popoverOpen,
      queuedMessages,
      recallablePrompts,
      recordIfEligible,
      setIsExpanded,
    ],
  );
  return { handleSendWithHistory, onComposerKeyDown };
};

/** Resolves active quotes and initial plugin cache snapshot. */
const readInitialPlusPlugins = (): PluginRow[] =>
  peekPluginsCache()?.plugins ?? [];

/** Updates `scrollMask` state only when `top` or `bottom` visibility changed. */
const applyScrollMaskIfChanged = (
  setScrollMask: React.Dispatch<
    React.SetStateAction<{ top: boolean; bottom: boolean }>
  >,
  next: { top: boolean; bottom: boolean },
): void => {
  setScrollMask((prev) =>
    prev.top === next.top && prev.bottom === next.bottom ? prev : next,
  );
};

/** Computes layout expansion flags for `ComposerVesselCard`. */
const deriveComposerLayoutFlags = (
  layout: ReturnType<typeof useComposerLayoutSync>,
  uploadedCount: number,
  quotesCount: number,
) => {
  const hasContextAttachments = uploadedCount > 0 || quotesCount > 0;
  return {
    hasContextAttachments,
    isExpandedLayout:
      layout.composerTall || layout.isExpanded || hasContextAttachments,
    showExpandButton: layout.canExpandComposer || layout.isExpanded,
  };
};

/** Resolves outer composer wrapper padding class for `variant`. */
const resolveComposerWrapperClass = (variant: "default" | "empty"): string =>
  cn(
    "relative shrink-0 overflow-visible",
    variant === "empty" ? "w-full px-0 pb-0 pt-0" : "px-0 pb-3 pt-0",
  );

/** Renders the optional media viewer lightbox when `mediaViewer` is open. */
const ComposerMediaViewerSlot = ({
  mediaViewer,
  onClose,
}: {
  mediaViewer: { src?: string; title?: string; kind: "image" | "html" } | null;
  onClose: () => void;
}) =>
  mediaViewer ? (
    <MediaLightbox
      open
      onClose={onClose}
      src={mediaViewer.src}
      title={mediaViewer.title}
      kind={mediaViewer.kind}
    />
  ) : null;

/** Inner implementation for `ChatInput`. */
const ChatInputInner = ({
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
  onNewChat: _onNewChat,
  variant = "default",
}: Omit<ChatInputProps, "webSearch" | "setWebSearch" | "handleFileUpload">) => {
    const textareaRef = React.useRef<HTMLTextAreaElement>(null);
    const mentionOverlayRef = React.useRef<HTMLDivElement>(null);
    const composerBoxRef = React.useRef<HTMLDivElement>(null);
    const historyCursorRef = React.useRef<PromptHistoryCursor | null>(null);
    const inputValueRef = React.useRef(inputValue);
    const [isEditorFocused, setIsEditorFocused] = React.useState(false);
    const [localQuotes, setLocalQuotes] = React.useState<QuotedExcerpt[]>([]);
    const [modelMenuOpen, setModelMenuOpen] = React.useState(false);
    const [plusMenuOpen, setPlusMenuOpen] = React.useState(false);
    const [modelQuery, setModelQuery] = React.useState("");
    const [pluginQuery, setPluginQuery] = React.useState("");
    const [plusPlugins, setPlusPlugins] = React.useState<PluginRow[]>(
      readInitialPlusPlugins,
    );
    const [mediaViewer, setMediaViewer] = React.useState<{
      src?: string;
      title?: string;
      kind: "image" | "html";
    } | null>(null);

    const catalogState = useComposerModelCatalog(
      selectedModel,
      setSelectedModel,
      reasoningEffort,
      setReasoningEffort,
      multiSelectModels,
      selectedWorkerModels,
    );
    const layout = useComposerLayoutSync({
      inputValue,
      textareaRef,
      mentionOverlayRef,
      composerBoxRef,
    });
    const textCtrl = useComposerTextController({
      inputValue,
      onInputChange,
      setUploadedFiles,
      textareaRef,
      historyCursorRef,
      inputValueRef,
    });
    const skills = useComposerSkillsAndWarmup();
    const popoverOpen =
      textCtrl.trigger.mentionOpen || textCtrl.trigger.slashOpen;

    React.useLayoutEffect(() => {
      inputValueRef.current = inputValue;
      if (
        historyCursorRef.current !== null &&
        !isUnmodifiedHistoryRecall(historyCursorRef.current, inputValue)
      ) {
        historyCursorRef.current = null;
      }
    }, [inputValue]);

    useComposerWindowBridges({
      quotedExcerpts,
      setLocalQuotes,
      textareaRef,
      inputValueRef,
      historyCursorRef,
      applyProgrammaticInputValue: textCtrl.applyProgrammaticInputValue,
      addUploadedFiles,
      setMediaViewer,
    });
    useGlobalEscapeStop({
      isLoading,
      isPreparing,
      popoverOpen,
      textareaRef,
      onStopMessage,
    });

    const drag = useComposerDragAndDrop({
      textareaRef,
      inputValue,
      addUploadedFiles,
      clearHistoryCursor: () => {
        historyCursorRef.current = null;
      },
      applyProgrammaticInputValue: textCtrl.applyProgrammaticInputValue,
    });
    const historyKeys = useComposerHistoryAndKeys({
      inputValue,
      promptHistory,
      needsSignIn: catalogState.needsSignIn,
      isPreparing,
      isLoading,
      uploadedFiles,
      queuedMessages,
      onEditQueuedMessage,
      onInputChange,
      onKeyDown,
      onSendMessage,
      textareaRef,
      historyCursorRef,
      canExpandComposer: layout.canExpandComposer,
      isExpanded: layout.isExpanded,
      setIsExpanded: layout.setIsExpanded,
      composerTall: layout.composerTall,
      popoverOpen,
      closeTriggers: textCtrl.closeTriggers,
    });

    const activeQuotes = quotedExcerpts ?? localQuotes;
    const handleRemoveQuote = React.useCallback(
      (id: string) => {
        if (onRemoveQuote) onRemoveQuote(id);
        else setLocalQuotes((prev) => prev.filter((q) => q.id !== id));
      },
      [onRemoveQuote],
    );
    const handleFilteredFileUpload = React.useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const allowed = Array.from(e.target.files ?? []).filter(isAllowedFile);
        if (allowed.length > 0) addUploadedFiles(allowed);
        e.target.value = "";
      },
      [addUploadedFiles],
    );
    const handlePaste = React.useCallback(
      (e: React.ClipboardEvent) =>
        processComposerPasteEvent({
          event: e,
          textarea: textareaRef.current,
          inputValue,
          addUploadedFiles,
          swapAttachmentInline: textCtrl.swapAttachmentInline,
          clearHistoryCursor: () => {
            historyCursorRef.current = null;
          },
          applyProgrammaticInputValue: textCtrl.applyProgrammaticInputValue,
        }),
      [addUploadedFiles, inputValue, textCtrl],
    );
    const handleContextMenuPaste = React.useCallback(() => {
      navigator.clipboard
        .readText()
        .then((text) =>
          pasteClipboardTextViaContextMenu({
            text,
            textarea: textareaRef.current,
            inputValue,
            addUploadedFiles,
            swapAttachmentInline: textCtrl.swapAttachmentInline,
            clearHistoryCursor: () => {
              historyCursorRef.current = null;
            },
            applyProgrammaticInputValue: textCtrl.applyProgrammaticInputValue,
          }),
        )
        .catch(() => undefined);
    }, [addUploadedFiles, inputValue, textCtrl]);

    const sendStatus = deriveComposerSendStatus({
      isPreparing,
      isLoading,
      needsSignIn: catalogState.needsSignIn,
      inputValue,
      uploadedFiles,
      activeQuotesCount: activeQuotes.length,
    });
    const layoutFlags = deriveComposerLayoutFlags(
      layout,
      uploadedFiles.length,
      activeQuotes.length,
    );
    const hasThreeOrMoreNewlines = React.useMemo(
      () => hasAtLeastTwoNewlines(inputValue),
      [inputValue],
    );
    const composerBreakAll = React.useMemo(
      () => shouldComposerBreakAll(inputValue),
      [inputValue],
    );
    const hasContextStrip = hasAnyContextStripItems(
      pendingEdits.length,
      queuedMessages.length,
      projectRuleFiles.length,
      taskItems.length,
    );
    return (
      <div className={resolveComposerWrapperClass(variant)}>
        <div className="relative z-10 flex w-full flex-col gap-1.5">
          {hasContextStrip ? (
            <ComposerContextStrip
              pendingEdits={pendingEdits}
              onAcceptAllEdits={onAcceptAllEdits}
              onRejectAllEdits={onRejectAllEdits}
              onAcceptEdit={onAcceptEdit}
              onRejectEdit={onRejectEdit}
              queuedMessages={queuedMessages}
              onEditQueuedMessage={onEditQueuedMessage}
              onRemoveQueuedMessage={onRemoveQueuedMessage}
              onSendQueuedNow={onSendQueuedNow}
              projectRuleFiles={projectRuleFiles}
              taskItems={taskItems}
            />
          ) : null}
          <ComposerVesselCard
            composerBoxRef={composerBoxRef}
            textareaRef={textareaRef}
            mentionOverlayRef={mentionOverlayRef}
            isExpandedLayout={layoutFlags.isExpandedLayout}
            isExpanded={layout.isExpanded}
            vesselRadiusClass={resolveVesselRadiusClass({
              isExpanded: layout.isExpanded,
              hasContextAttachments: layoutFlags.hasContextAttachments,
              hasThreeOrMoreNewlines,
              editorHeight: layout.editorHeight,
              composerTall: layout.composerTall,
            })}
            drag={drag}
            trigger={textCtrl.trigger}
            setTrigger={textCtrl.setTrigger}
            closeTriggers={textCtrl.closeTriggers}
            workflows={catalogState.workflows}
            insertSlash={textCtrl.insertSlash}
            insertMention={textCtrl.insertMention}
            activeQuotes={activeQuotes}
            onRemoveQuote={handleRemoveQuote}
            uploadedFiles={uploadedFiles}
            setUploadedFiles={setUploadedFiles}
            inputValue={inputValue}
            applyProgrammaticInputValue={textCtrl.applyProgrammaticInputValue}
            onFileInputChange={handleFilteredFileUpload}
            plusMenuOpen={plusMenuOpen}
            setPlusMenuOpen={setPlusMenuOpen}
            plusPlugins={plusPlugins}
            setPlusPlugins={setPlusPlugins}
            pluginQuery={pluginQuery}
            setPluginQuery={setPluginQuery}
            skills={skills}
            appendToken={textCtrl.appendToken}
            editorHeight={layout.editorHeight}
            editorMaskImage={buildComposerScrollMaskImage(layout.scrollMask, 18)}
            isEditorFocused={isEditorFocused}
            setIsEditorFocused={setIsEditorFocused}
            hintMode={resolveComposerHintMode(isPreparing, isLoading)}
            needsSignIn={catalogState.needsSignIn}
            missingModelsOnly={catalogState.missingModelsOnly}
            composerBreakAll={composerBreakAll}
            composerAriaLabel={resolveComposerAriaLabel(
              catalogState.needsSignIn,
              catalogState.missingModelsOnly,
            )}
            onInputChange={textCtrl.handleInputChangeWithMentions}
            onKeyDown={historyKeys.onComposerKeyDown}
            onPaste={handlePaste}
            onScrollMask={(next) =>
              applyScrollMaskIfChanged(layout.setScrollMask, next)
            }
            onContextMenuPaste={handleContextMenuPaste}
            showExpandButton={layoutFlags.showExpandButton}
            onToggleExpand={() => {
              layout.setIsExpanded((prev) => !prev);
              requestAnimationFrame(() => textareaRef.current?.focus());
            }}
            canStop={sendStatus.canStop}
            isPreparing={isPreparing}
            isLoading={isLoading}
            sendDisabled={sendStatus.sendDisabled}
            sendActive={sendStatus.sendActive}
            onStopMessage={onStopMessage}
            onSendWithHistory={historyKeys.handleSendWithHistory}
          />
          <ComposerFooterBar
            hideModeSelect={hideModeSelect}
            selectedMode={selectedMode}
            setSelectedMode={setSelectedMode}
            needsSignIn={catalogState.needsSignIn}
            missingModelsOnly={catalogState.missingModelsOnly}
            modelMenuOpen={modelMenuOpen}
            setModelMenuOpen={setModelMenuOpen}
            modelQuery={modelQuery}
            setModelQuery={setModelQuery}
            modelName={catalogState.modelName}
            activeTriggerIconId={catalogState.activeTriggerIconId}
            multiSelectModels={multiSelectModels}
            autoModel={catalogState.autoModel}
            models={catalogState.models}
            providerOrder={catalogState.providerOrder}
            selectedModel={selectedModel}
            selectedWorkerModels={selectedWorkerModels}
            setSelectedModel={setSelectedModel}
            setSelectedWorkerModels={setSelectedWorkerModels}
            reasoningEffort={reasoningEffort}
            setReasoningEffort={setReasoningEffort}
            resolvedAutoModel={catalogState.resolvedAutoModel}
            effectiveModelId={catalogState.effectiveModelId}
          />
        </div>
        <ComposerMediaViewerSlot
          mediaViewer={mediaViewer}
          onClose={() => setMediaViewer(null)}
        />
      </div>
    );
};

/** Renders the ChatInput UI component. */
export const ChatInput = React.memo(ChatInputInner);
