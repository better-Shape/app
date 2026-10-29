"use client";

import { Add20Regular } from "@fluentui/react-icons/headless/svg/add";
import { ArrowMaximize20Regular } from "@fluentui/react-icons/headless/svg/arrow-maximize";
import { ArrowMinimize20Regular } from "@fluentui/react-icons/headless/svg/arrow-minimize";
import { ArrowUp20Regular } from "@fluentui/react-icons/headless/svg/arrow-up";
import { CalendarMultiple24Filled } from "@fluentui/react-icons/headless/svg/calendar-multiple";
import { ChatMultiple20Filled } from "@fluentui/react-icons/headless/svg/chat-multiple";
import { Checkmark20Regular } from "@fluentui/react-icons/headless/svg/checkmark";
import { CodeTextEdit20Filled } from "@fluentui/react-icons/headless/svg/code-text-edit";
import { ColorLine24Filled } from "@fluentui/react-icons/headless/svg/color-line";
import { Connected24Filled } from "@fluentui/react-icons/headless/svg/connected";
import { Dismiss16Regular } from "@fluentui/react-icons/headless/svg/dismiss";
import { Document20Regular } from "@fluentui/react-icons/headless/svg/document";
import { DocumentEdit24Filled } from "@fluentui/react-icons/headless/svg/document-edit";
import { DocumentText20Regular } from "@fluentui/react-icons/headless/svg/document-text";
import { FolderAdd24Filled } from "@fluentui/react-icons/headless/svg/folder-add";
import { Incognito24Filled } from "@fluentui/react-icons/headless/svg/incognito";
import { MoviesAndTv24Filled } from "@fluentui/react-icons/headless/svg/movies-and-tv";
import { TextQuote16Regular } from "@fluentui/react-icons/headless/svg/text-quote";
import React from "react";
import { Arc } from "loading-dev";
import { Button } from "@/components/ui/button";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "@/components/ui/context";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icon";
import { PluginLogo } from "@/components/ui/plugin-logo";
import { SearchInput } from "@/components/ui/search";
import { SwapText } from "@/components/ui/swap";
import { Tooltip } from "@/components/ui/tooltip";
import { WorkspaceBranchSwitch } from "@/features/agent/workspace/branch-switch";
import { formatMentionToken, mentionRanges } from "@/lib/chat/mentions";
import type { Skill } from "@/lib/chat/skills";
import { slashCommandRanges } from "@/lib/chat/workflows";
import { fetchPlugins, peekPluginsCache, type PluginRow } from "@/lib/plugins/api";
import type { ModelInfo } from "@/lib/settings/models";
import { BetterShapeAutoIcon, providerIcon } from "@/lib/ui/provider-icon";
import { useReducedMotion } from "@/lib/ui/use-reduced-motion";
import { cn } from "@/lib/utils";
import { openSettingsWindow } from "@/lib/window/open-settings";
import type { QuotedExcerpt } from "../quote-selection";
import { ComposerTasksStrip, type ComposerTaskItem } from "./activity";
import { DictationButton } from "./dictation-button";
import { PendingEditsPanel } from "./edits";
import {
  computeNextMultiModelPool,
  focusSearchOnMount,
  formatContextWindow,
  matchesModelSearchQuery,
} from "./input-helpers";
import { QueuedMessagesPanel, type QueuedMessage } from "./queue";
import { effortDisplayLabel, type ReasoningEffort } from "./reasoning-effort";
import { ThinkingEffortControl } from "./thinking-bar";

export const IDLE_COMPOSER_HINTS = [
  "Ask a task. @ for files, / for workflows.",
  "Drop a screenshot or file to inspect",
  "Paste a stack trace to debug",
  "Visual: ask to compare UI directions",
] as const;

const ACTIVE_COMPOSER_HINTS = [
  "Queue a follow-up, or press Esc to stop",
  "Type ahead to queue your next message",
] as const;

const PREPARING_COMPOSER_HINT = "Preparing context... Esc to cancel";

const CHAT_MODES = [
  {
    id: "Code",
    icon: CodeTextEdit20Filled,
    color: "#3B82F6",
    bg: "rgba(59, 130, 246, 0.16)",
    description: "Build and edit files in the project",
  },
  {
    id: "Ask",
    icon: ChatMultiple20Filled,
    color: "#22C55E",
    bg: "rgba(34, 197, 94, 0.16)",
    description: "Answer questions without making changes",
  },
  {
    id: "Plan",
    icon: CalendarMultiple24Filled,
    color: "#F97316",
    bg: "rgba(249, 115, 22, 0.16)",
    description: "Create a plan before proceeding",
  },
  {
    id: "Visual",
    icon: ColorLine24Filled,
    color: "#F43F5E",
    bg: "rgba(244, 63, 94, 0.16)",
    description: "Design and iterate on the UI",
  },
  {
    id: "Review",
    icon: Incognito24Filled,
    color: "#A855F7",
    bg: "rgba(168, 85, 247, 0.16)",
    description: "Review code for bugs and edge cases",
  },
] as const;

/** Resolves context window source for `ModelTooltip`. */
const resolveTooltipContextWindow = (
  isAuto: boolean,
  model: ModelInfo,
  resolvedAutoModel?: ModelInfo | null,
): string => {
  const autoCtx = isAuto ? resolvedAutoModel?.contextWindow : undefined;
  return formatContextWindow(autoCtx || model.contextWindow);
};

/** Resolves subtitle copy for `ModelTooltip`. */
const resolveTooltipDescription = (
  isAuto: boolean,
  model: ModelInfo,
  resolvedAutoModel?: ModelInfo | null,
): string => {
  if (!isAuto) return model.description;
  return resolvedAutoModel
    ? `Routes to ${resolvedAutoModel.name} (${resolvedAutoModel.provider}).`
    : "Picks a fast model for everyday work.";
};

/** Checks whether `modelId` represents an Auto routing option. */
const isAutoModelId = (modelId: string): boolean =>
  modelId === "auto" || modelId === "openrouter/auto";

/** Renders the ModelTooltip UI component. */
const ModelTooltip = ({
  model,
  effort,
  resolvedAutoModel,
}: {
  model: ModelInfo;
  effort: ReasoningEffort;
  resolvedAutoModel?: ModelInfo | null;
}) => {
  const isAuto = isAutoModelId(model.id);
  const ctx = resolveTooltipContextWindow(isAuto, model, resolvedAutoModel);
  const effortName = effortDisplayLabel(effort).toLowerCase();

  return (
    <div className="flex flex-col gap-1 min-w-[220px] max-w-[280px] p-3 select-none">
      <div className="text-sm font-medium leading-tight text-text-primary">
        {isAuto ? "Auto" : model.name}
      </div>
      <p className="text-xs leading-snug text-text-secondary">
        {resolveTooltipDescription(isAuto, model, resolvedAutoModel)}
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

/** Resolves icon identifier for a model row in `ModelItem`. */
const resolveModelItemIconId = (
  isAuto: boolean,
  modelId: string,
  resolvedAutoModel?: ModelInfo | null,
): string => {
  if (!isAuto || !resolvedAutoModel) return modelId;
  return resolvedAutoModel.id.split("/")[0] || resolvedAutoModel.id;
};

/** Renders the ModelItem UI component. */
export const ModelItem = ({
  model,
  isSelected,
  onSelect,
  effort,
  resolvedAutoModel,
}: {
  model: ModelInfo;
  isSelected: boolean;
  onSelect: (id: string) => void;
  effort: ReasoningEffort;
  resolvedAutoModel?: ModelInfo | null;
}) => {
  const isAuto = isAutoModelId(model.id);
  const iconId = resolveModelItemIconId(isAuto, model.id, resolvedAutoModel);
  const autoProvider = isAuto ? resolvedAutoModel?.provider : undefined;

  return (
    <Tooltip
      side="right"
      align="start"
      sideOffset={6}
      delayDuration={200}
      className="p-0!"
      content={
        <ModelTooltip
          model={model}
          effort={effort}
          resolvedAutoModel={resolvedAutoModel}
        />
      }
    >
      <DropdownMenuItem
        onClick={() => onSelect(model.id)}
        className={cn(
          "flex items-center cursor-pointer w-full",
          isSelected && "bg-panel-hover",
        )}
      >
        <div className="flex items-center gap-1.5 w-full min-w-0">
          {providerIcon(iconId, 16)}
          <span className="flex-1 truncate font-regular text-sm text-text-primary group-hover:text-text-primary transition-colors">
            {model.name}
          </span>
          {autoProvider ? (
            <span className="shrink-0 text-xs text-text-muted">
              {autoProvider}
            </span>
          ) : null}
          {isSelected ? (
            <Icon
              icon={Checkmark20Regular}
              className="shrink-0 text-text-primary font-bold"
            />
          ) : null}
        </div>
      </DropdownMenuItem>
    </Tooltip>
  );
};

/** Resolves rotating placeholder hint list for the current composer setup/mode. */
const selectHintRotationList = (
  mode: "idle" | "active" | "preparing",
  needsProvider: boolean,
  setupGap: string | null | undefined,
): readonly string[] => {
  if (mode === "active") return ACTIVE_COMPOSER_HINTS;
  if (!needsProvider) return IDLE_COMPOSER_HINTS;
  const lead = `${setupGap ?? "Add an API key in Settings → Providers"} to chat`;
  return [lead, ...IDLE_COMPOSER_HINTS.slice(0, 3)];
};

/** Builds a stable mode key string for `RotatingComposerHint` resets. */
const buildHintModeKey = (
  mode: "idle" | "active" | "preparing",
  needsProvider: boolean,
  setupGap: string | null | undefined,
): string => {
  if (!needsProvider) return `${mode}:ready`;
  return `${mode}:${setupGap ?? "setup"}`;
};

/** Checks whether hint marquee rotation should pause. */
const shouldPauseHintMarquee = (opts: {
  paused: boolean;
  reducedMotion: boolean;
  mode: "idle" | "active" | "preparing";
  count: number;
}): boolean =>
  opts.paused ||
  opts.reducedMotion ||
  opts.mode === "preparing" ||
  opts.count <= 1;

/** Starts the 8-second marquee interval for `RotatingComposerHint`. */
const startHintMarqueeTimer = (
  hintsCount: number,
  indexRef: { current: number },
  setIndex: (idx: number) => void,
  setPhase: (phase: "in" | "out" | "enter") => void,
): (() => void) => {
  let exitTimer: ReturnType<typeof setTimeout> | undefined;
  let enterTimer: ReturnType<typeof setTimeout> | undefined;
  const hold = window.setInterval(() => {
    setPhase("out");
    exitTimer = setTimeout(() => {
      const nextIdx = (indexRef.current + 1) % hintsCount;
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
};

/** Resolves active hint label for `RotatingComposerHint`. */
const resolveActiveHintLabel = (
  mode: "idle" | "active" | "preparing",
  hints: readonly string[],
  index: number,
): string => {
  if (mode === "preparing") return PREPARING_COMPOSER_HINT;
  return hints[index % hints.length] ?? IDLE_COMPOSER_HINTS[0];
};

/** Inner implementation for `RotatingComposerHint`. */
const RotatingComposerHintInner = ({
  paused,
  mode,
  needsProvider = false,
  setupGap = null,
}: {
  paused: boolean;
  mode: "idle" | "active" | "preparing";
  needsProvider?: boolean;
  setupGap?: string | null;
}) => {
  const hints = React.useMemo(
    () => selectHintRotationList(mode, needsProvider, setupGap),
    [mode, needsProvider, setupGap],
  );
  const modeKey = buildHintModeKey(mode, needsProvider, setupGap);
  const [index, setIndex] = React.useState(0);
  const [phase, setPhase] = React.useState<"in" | "out" | "enter">("in");
  const [prevModeKey, setPrevModeKey] = React.useState(modeKey);
  const indexRef = React.useRef(0);
  const reducedMotion = useReducedMotion();

  if (prevModeKey !== modeKey) {
    setPrevModeKey(modeKey);
    setIndex(0);
    setPhase("in");
  }

  const shouldPause = shouldPauseHintMarquee({
    paused,
    reducedMotion,
    mode,
    count: hints.length,
  });
  if (shouldPause && phase !== "in") setPhase("in");

  React.useLayoutEffect(() => {
    indexRef.current = index;
  }, [index]);

  React.useEffect(() => {
    if (shouldPause) return undefined;
    return startHintMarqueeTimer(hints.length, indexRef, setIndex, setPhase);
  }, [shouldPause, hints.length]);

  return (
    <div className="t-composer-hint px-1.5" aria-hidden>
      <span className="t-composer-hint__text" data-phase={phase}>
        {resolveActiveHintLabel(mode, hints, index)}
      </span>
    </div>
  );
};

/** Renders the RotatingComposerHint UI component. */
export const RotatingComposerHint = React.memo(RotatingComposerHintInner);

/** Inner implementation for `ModeMenu`. */
const ModeMenuInner = ({
  selectedMode,
  setSelectedMode,
  disabled,
}: {
  selectedMode: string;
  setSelectedMode: (m: string) => void;
  disabled?: boolean;
}) => {
  const selected =
    CHAT_MODES.find((m) => m.id === selectedMode) ?? CHAT_MODES[0];
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
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-[344px] max-w-[calc(100vw-24px)]"
      >
        {CHAT_MODES.map((mode) => {
          const isSelected = mode.id === selected.id;
          return (
            <DropdownMenuItem
              key={mode.id}
              onClick={() => setSelectedMode(mode.id)}
              className={cn(
                "items-center gap-2.5 py-1.5",
                isSelected && "bg-[var(--row-selected)]",
              )}
            >
              <Icon
                icon={mode.icon}
                className={cn("shrink-0", !isSelected && "text-text-secondary")}
                style={isSelected ? { color: mode.color } : undefined}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium leading-tight text-text-primary">
                  {mode.id}
                </span>
                <span className="truncate text-xs leading-snug text-text-muted">
                  {mode.description}
                </span>
              </span>
              {isSelected ? (
                <Icon
                  icon={Checkmark20Regular}
                  className="icon-sm size-3.5 shrink-0 text-text-primary"
                />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** Renders the ModeMenu UI component. */
export const ModeMenu = React.memo(ModeMenuInner);

/** Formats project rule file basenames into a comma-separated label. */
const formatRuleFileBasenames = (files: string[]): string =>
  files.map((name) => name.split(/[\\/]/).pop() || name).join(", ");

/** Renders the queued-messages pill when queue items and handlers exist. */
const QueuedMessagesSlot = ({
  queuedMessages,
  onEditQueuedMessage,
  onRemoveQueuedMessage,
  onSendQueuedNow,
}: {
  queuedMessages: QueuedMessage[];
  onEditQueuedMessage?: (id: string) => void;
  onRemoveQueuedMessage?: (id: string) => void;
  onSendQueuedNow?: (id: string) => void;
}) => {
  if (
    queuedMessages.length === 0 ||
    !onEditQueuedMessage ||
    !onRemoveQueuedMessage
  ) {
    return null;
  }
  return (
    <QueuedMessagesPanel
      items={queuedMessages}
      onEdit={onEditQueuedMessage}
      onRemove={onRemoveQueuedMessage}
      onSendNow={onSendQueuedNow}
    />
  );
};

/** No-op callback fallback for optional bulk-edit actions. */
const noopAction = (): void => undefined;

type PendingEditsSlotProps = {
  pendingEdits: {
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
};

/** Renders the pending-edits pill when edits exist. */
const PendingEditsSlot = ({
  pendingEdits,
  onAcceptAllEdits,
  onRejectAllEdits,
  onAcceptEdit,
  onRejectEdit,
}: PendingEditsSlotProps) =>
  pendingEdits.length > 0 ? (
    <PendingEditsPanel
      edits={pendingEdits}
      onAcceptAll={onAcceptAllEdits ?? noopAction}
      onRejectAll={onRejectAllEdits ?? noopAction}
      onAccept={onAcceptEdit}
      onReject={onRejectEdit}
    />
  ) : null;

/** Renders the top strip above the composer vessel (pending edits, queue, rules, tasks). */
export const ComposerContextStrip = ({
  pendingEdits,
  onAcceptAllEdits,
  onRejectAllEdits,
  onAcceptEdit,
  onRejectEdit,
  queuedMessages,
  onEditQueuedMessage,
  onRemoveQueuedMessage,
  onSendQueuedNow,
  projectRuleFiles,
  taskItems,
}: PendingEditsSlotProps & {
  queuedMessages: QueuedMessage[];
  onEditQueuedMessage?: (id: string) => void;
  onRemoveQueuedMessage?: (id: string) => void;
  onSendQueuedNow?: (id: string) => void;
  projectRuleFiles: string[];
  taskItems: ComposerTaskItem[];
}) => (
  <div className="flex min-w-0 flex-wrap items-center gap-1.5 px-1">
    <PendingEditsSlot
      pendingEdits={pendingEdits}
      onAcceptAllEdits={onAcceptAllEdits}
      onRejectAllEdits={onRejectAllEdits}
      onAcceptEdit={onAcceptEdit}
      onRejectEdit={onRejectEdit}
    />
    <QueuedMessagesSlot
      queuedMessages={queuedMessages}
      onEditQueuedMessage={onEditQueuedMessage}
      onRemoveQueuedMessage={onRemoveQueuedMessage}
      onSendQueuedNow={onSendQueuedNow}
    />
    {projectRuleFiles.length > 0 ? (
      <Tooltip content={projectRuleFiles.join("\n")}>
        <span className="flex h-6.5 min-w-0 max-w-56 items-center gap-1.5 squircle-lg border border-border-subtle bg-surface-3/90 px-2.5 text-xs font-medium text-text-secondary">
          <Icon
            icon={Document20Regular}
            className="icon-sm size-3.5 shrink-0 text-text-muted"
          />
          <span className="truncate">
            {formatRuleFileBasenames(projectRuleFiles)}
          </span>
        </span>
      </Tooltip>
    ) : null}
    {taskItems.length > 0 ? <ComposerTasksStrip items={taskItems} /> : null}
  </div>
);

/** Renders quoted transcript excerpts inside the composer vessel. */
export const ComposerQuotesStrip = ({
  quotes,
  onRemoveQuote,
}: {
  quotes: QuotedExcerpt[];
  onRemoveQuote: (id: string) => void;
}) => {
  if (quotes.length === 0) return null;
  return (
    <div
      data-composer-quotes
      className="flex flex-col gap-1 px-1.5 pt-1 pb-0.5"
    >
      {quotes.map((q, idx) => (
        <div
          key={q.id}
          className="group/quote flex min-w-0 items-start gap-2 squircle-xl border border-border-subtle bg-surface-2 px-2.5 py-1.5 text-xs text-text-secondary transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:border-border-secondary"
        >
          <Icon
            icon={TextQuote16Regular}
            className="icon-sm mt-0.5 size-3.5 shrink-0 text-text-muted"
          />
          <span className="min-w-0 flex-1 line-clamp-2 break-words leading-[16px] text-text-secondary">
            {q.text
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)
              .join(" ↵ ")}
          </span>
          <Tooltip content="Remove quote">
            <button
              type="button"
              aria-label={`Remove quote ${idx + 1}`}
              onClick={(e) => {
                e.stopPropagation();
                onRemoveQuote(q.id);
              }}
              className="flex size-[20px] shrink-0 items-center justify-center rounded-md text-text-muted opacity-70 transition-[background-color,color,opacity,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary hover:opacity-100 active:scale-[0.94]"
            >
              <Icon icon={Dismiss16Regular} className="size-3" />
            </button>
          </Tooltip>
        </div>
      ))}
    </div>
  );
};

/** Checks whether a plugin row matches the lowercase search query. */
const matchesPluginSearch = (plugin: PluginRow, q: string): boolean => {
  if (!q) return true;
  return (
    plugin.name.toLowerCase().includes(q) ||
    plugin.toolkit.toLowerCase().includes(q)
  );
};

/** Renders filtered plugin list items inside the `+` menu `Plugins` submenu. */
const PlusMenuPluginRows = ({
  plugins,
  query,
  appendToken,
}: {
  plugins: PluginRow[];
  query: string;
  appendToken: (token: string) => void;
}) => {
  const normalizedQuery = query.trim().toLowerCase();
  const matches = plugins.filter((plugin) =>
    matchesPluginSearch(plugin, normalizedQuery),
  );
  if (matches.length === 0) {
    return (
      <div className="max-h-40 overflow-y-auto">
        <DropdownMenuItem disabled>
          {plugins.length === 0 ? "No plugins" : "No matches"}
        </DropdownMenuItem>
      </div>
    );
  }
  return (
    <div className="max-h-40 overflow-y-auto">
      {matches.map((plugin) => (
        <DropdownMenuItem
          key={`${plugin.toolkit}:${plugin.accountId ?? "unconnected"}`}
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
      ))}
    </div>
  );
};

/** Refreshes `plusPlugins` from cache and network when opening the `+` menu. */
const loadPlusMenuPlugins = (
  setPlusPlugins: React.Dispatch<React.SetStateAction<PluginRow[]>>,
): void => {
  const cached = peekPluginsCache()?.plugins;
  if (cached) setPlusPlugins(cached);
  fetchPlugins()
    .then((data) => setPlusPlugins(data.plugins))
    .catch(() => {
      if (!cached) setPlusPlugins([]);
    });
};

/** Renders the `+` attachment, plugin, and skill menu on the left of the composer. */
export const ComposerPlusMenu = ({
  open,
  onOpenChange,
  plusPlugins,
  setPlusPlugins,
  pluginQuery,
  setPluginQuery,
  skills,
  appendToken,
  stacked = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plusPlugins: PluginRow[];
  setPlusPlugins: React.Dispatch<React.SetStateAction<PluginRow[]>>;
  pluginQuery: string;
  setPluginQuery: (q: string) => void;
  skills: Skill[];
  appendToken: (token: string) => void;
  stacked?: boolean;
}) => (
  <div
    data-composer-left-action
    className={cn("flex shrink-0 items-center self-end", stacked && "order-2")}
  >
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (nextOpen) loadPlusMenuPlugins(setPlusPlugins);
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
      {open ? (
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem
            onClick={() => document.getElementById("chat-media-upload")?.click()}
          >
            <Icon icon={MoviesAndTv24Filled} />
            Upload photos & file
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              document.getElementById("chat-folder-upload")?.click()
            }
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
                ref={focusSearchOnMount}
                borderless
                placeholder="Search plugins"
                value={pluginQuery}
                onChange={(e) => setPluginQuery(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                onKeyUp={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              />
              <PlusMenuPluginRows
                plugins={plusPlugins}
                query={pluginQuery}
                appendToken={appendToken}
              />
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
);

/** Renders a highlighted `@mention` or `/workflow` token span inside the mirror overlay. */
const ComposerContextHighlight = ({ text }: { text: string }) => (
  <span className="relative">
    <span
      aria-hidden
      className="absolute inset-y-0 -inset-x-0.5 rounded-md bg-accent-text-bg"
    />
    <span className="relative text-accent-text">{text}</span>
  </span>
);

type HighlightRangeItem = {
  kind: "mention" | "slash";
  start: number;
  end: number;
};

type WorkflowList = NonNullable<Parameters<typeof slashCommandRanges>[1]>;

/** Merges sorted highlight ranges, skipping overlapping intervals. */
const collectNonOverlappingRanges = (
  inputValue: string,
  workflows: WorkflowList,
): HighlightRangeItem[] => {
  const ranges: HighlightRangeItem[] = [
    ...mentionRanges(inputValue).map((r) => ({ kind: "mention" as const, ...r })),
    ...slashCommandRanges(inputValue, workflows).map((r) => ({
      kind: "slash" as const,
      ...r,
    })),
  ].sort((a, b) => a.start - b.start);
  const merged: HighlightRangeItem[] = [];
  for (const range of ranges) {
    const prev = merged[merged.length - 1];
    if (!prev || range.start >= prev.end) merged.push(range);
  }
  return merged;
};

/** Builds React child nodes for `inputValue` given non-overlapping highlight `ranges`. */
const buildHighlightedMirrorNodes = (
  inputValue: string,
  ranges: HighlightRangeItem[],
  trailingBreak: string,
): React.ReactNode[] => {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      nodes.push(inputValue.slice(cursor, range.start));
    }
    nodes.push(
      <ComposerContextHighlight
        key={`${range.kind}-${range.start}`}
        text={inputValue.slice(range.start, range.end)}
      />,
    );
    cursor = range.end;
  }
  if (cursor < inputValue.length) nodes.push(inputValue.slice(cursor));
  if (trailingBreak) nodes.push(trailingBreak);
  return nodes;
};

/** Renders plain mirror fallback text with trailing newline sentinel when needed. */
const formatPlainMirrorText = (
  inputValue: string,
  trailingBreak: string,
): string => (inputValue ? `${inputValue}${trailingBreak}` : "\u00a0");

/** Builds mirror overlay content for `inputValue`. */
const renderMirrorContent = (
  inputValue: string,
  workflows: WorkflowList,
): React.ReactNode => {
  const trailingBreak = inputValue.endsWith("\n") ? "\u200b" : "";
  if (!inputValue.includes("@") && !inputValue.includes("/")) {
    return formatPlainMirrorText(inputValue, trailingBreak);
  }
  const merged = collectNonOverlappingRanges(inputValue, workflows);
  if (merged.length === 0) {
    return formatPlainMirrorText(inputValue, trailingBreak);
  }
  return buildHighlightedMirrorNodes(inputValue, merged, trailingBreak);
};

/** Renders the synchronized mirror overlay beneath the transparent composer `<textarea>`. */
export const ComposerHighlightMirror = ({
  overlayRef,
  inputValue,
  workflows,
  composerBreakAll,
}: {
  overlayRef: React.RefObject<HTMLDivElement | null>;
  inputValue: string;
  workflows: WorkflowList;
  composerBreakAll: boolean;
}) => (
  <div
    ref={overlayRef}
    aria-hidden
    className={cn(
      "pointer-events-none absolute inset-0 z-0 overflow-hidden whitespace-pre-wrap px-1.5 py-0 text-sm font-medium leading-[22px] text-text-primary",
      composerBreakAll ? "break-all" : "break-words",
    )}
  >
    {renderMirrorContent(inputValue, workflows)}
  </div>
);

/** Renders Cut / Copy / Paste / Select All items inside the composer context menu. */
export const ComposerContextMenuItems = ({
  onPasteClick,
  onSelectAllClick,
}: {
  onPasteClick: () => void;
  onSelectAllClick: () => void;
}) => (
  <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
    <ContextMenuItem onClick={() => document.execCommand("cut")}>
      Cut
      <ContextMenuShortcut>Ctrl+X</ContextMenuShortcut>
    </ContextMenuItem>
    <ContextMenuItem onClick={() => document.execCommand("copy")}>
      Copy
      <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
    </ContextMenuItem>
    <ContextMenuItem onClick={onPasteClick}>
      Paste
      <ContextMenuShortcut>Ctrl+V</ContextMenuShortcut>
    </ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem onClick={onSelectAllClick}>
      Select All
      <ContextMenuShortcut>Ctrl+A</ContextMenuShortcut>
    </ContextMenuItem>
  </ContextMenuContent>
);

/** Resolves tooltip and ARIA label for the primary Send / Queue / Stop button. */
const resolveSendButtonLabel = (canStop: boolean, isLoading: boolean): string => {
  if (canStop) return "Stop";
  return isLoading ? "Queue message" : "Send";
};

/** Resolves color/border classes for the primary Send / Queue / Stop button. */
const resolveSendButtonToneClass = (
  canStop: boolean,
  isPreparing: boolean,
  sendActive: boolean,
): string => {
  if (canStop && !isPreparing) {
    return "border border-border bg-surface-2 text-text-primary hover:bg-[var(--btn-hover)]";
  }
  return sendActive
    ? "bg-accent text-white hover:opacity-90"
    : "bg-surface-3 text-text-muted";
};

/** Resolves label and icon pair for `ExpandComposerButton`. */
const resolveExpandButtonMeta = (isExpanded: boolean) =>
  isExpanded
    ? { label: "Collapse composer", icon: ArrowMinimize20Regular }
    : { label: "Expand composer", icon: ArrowMaximize20Regular };

/** Renders the Expand / Collapse composer toggle button. */
export const ExpandComposerButton = ({
  showExpandButton,
  isExpanded,
  onToggleExpand,
}: {
  showExpandButton: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) => {
  const { label, icon } = resolveExpandButtonMeta(isExpanded);
  return (
    <div
      aria-hidden={!showExpandButton || undefined}
      className={cn(
        "absolute top-0 right-0 z-10 flex items-center transition-[opacity,transform] duration-[var(--spring-quick-dur)] ease-[var(--spring-quick)] motion-reduce:transform-none motion-reduce:transition-none",
        showExpandButton
          ? "pointer-events-auto scale-100 opacity-100 delay-75"
          : "pointer-events-none scale-90 opacity-0 delay-0",
      )}
    >
      <Tooltip content={label} shortcut="Ctrl+Shift+E">
        <button
          type="button"
          tabIndex={showExpandButton ? 0 : -1}
          aria-label={label}
          aria-pressed={isExpanded}
          onClick={onToggleExpand}
          className="flex size-[28px] shrink-0 items-center justify-center rounded-full text-text-muted transition-[background-color,color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary active:scale-[0.96]"
        >
          <Icon icon={icon} />
        </button>
      </Tooltip>
    </div>
  );
};

/** Renders the inner icon/spinner inside the primary Send / Stop button. */
const SendButtonGlyph = ({
  canStop,
  isPreparing,
}: {
  canStop: boolean;
  isPreparing: boolean;
}) => {
  if (!canStop) return <Icon icon={ArrowUp20Regular} />;
  return (
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
  );
};

/** Renders the right-hand composer column (Expand toggle when inline, Dictation, Send/Stop). */
export const ComposerRightActions = ({
  showExpandButton,
  isExpanded,
  onToggleExpand,
  canStop,
  isPreparing,
  isLoading,
  sendDisabled,
  sendActive,
  onStopMessage,
  onSendWithHistory,
  stacked = false,
}: {
  showExpandButton: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  canStop: boolean;
  isPreparing: boolean;
  isLoading: boolean;
  sendDisabled: boolean;
  sendActive: boolean;
  onStopMessage: () => void;
  onSendWithHistory: () => void;
  stacked?: boolean;
}) => {
  const actionLabel = resolveSendButtonLabel(canStop, isLoading);
  return (
    <div
      data-composer-right-actions
      className={cn(
        "relative flex shrink-0 flex-col items-end justify-end",
        stacked ? "order-3 ml-auto" : "self-stretch",
      )}
    >
      {stacked ? null : (
        <ExpandComposerButton
          showExpandButton={showExpandButton}
          isExpanded={isExpanded}
          onToggleExpand={onToggleExpand}
        />
      )}
      <div className="flex shrink-0 items-center gap-1">
        <DictationButton />
        <Tooltip content={actionLabel} shortcut={canStop ? "Esc" : "Enter"}>
          <button
            type="button"
            onClick={canStop ? onStopMessage : onSendWithHistory}
            disabled={sendDisabled}
            className={cn(
              "flex size-[32px] shrink-0 items-center justify-center rounded-full transition-[background-color,border-color,color,opacity,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] active:scale-[0.95] disabled:pointer-events-none disabled:opacity-40",
              resolveSendButtonToneClass(canStop, isPreparing, sendActive),
            )}
            aria-label={actionLabel}
          >
            <SendButtonGlyph canStop={canStop} isPreparing={isPreparing} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
};

/** Renders the `Auto` entry inside the model dropdown (single- or multi-select). */
const AutoModelDropdownEntry = ({
  autoModel,
  modelSearch,
  multiSelectModels,
  selectedModel,
  selectedWorkerModels,
  setSelectedModel,
  setSelectedWorkerModels,
  reasoningEffort,
  resolvedAutoModel,
}: {
  autoModel: ModelInfo;
  modelSearch: string;
  multiSelectModels: boolean;
  selectedModel: string;
  selectedWorkerModels: string[];
  setSelectedModel: (id: string) => void;
  setSelectedWorkerModels?: (ids: string[]) => void;
  reasoningEffort: ReasoningEffort;
  resolvedAutoModel: ModelInfo | null;
}) => {
  if (!matchesModelSearchQuery(autoModel, modelSearch)) return null;
  if (!multiSelectModels) {
    return (
      <ModelItem
        model={autoModel}
        isSelected={selectedModel === "auto"}
        onSelect={() => setSelectedModel("auto")}
        effort={reasoningEffort}
        resolvedAutoModel={resolvedAutoModel}
      />
    );
  }
  const checked =
    selectedModel === "auto" || selectedWorkerModels.includes("auto");
  return (
    <DropdownMenuCheckboxItem
      checked={checked}
      onCheckedChange={(nextChecked) => {
        if (!nextChecked) return;
        setSelectedModel("auto");
        setSelectedWorkerModels?.(
          selectedWorkerModels.filter((id) => id !== "auto"),
        );
      }}
    >
      Auto
    </DropdownMenuCheckboxItem>
  );
};

/** Renders a single provider model row in single- or multi-select dropdown mode. */
const ProviderModelRow = ({
  model,
  multiSelectModels,
  selectedModel,
  selectedWorkerModels,
  setSelectedModel,
  setSelectedWorkerModels,
  reasoningEffort,
}: {
  model: ModelInfo;
  multiSelectModels: boolean;
  selectedModel: string;
  selectedWorkerModels: string[];
  setSelectedModel: (id: string) => void;
  setSelectedWorkerModels?: (ids: string[]) => void;
  reasoningEffort: ReasoningEffort;
}) => {
  if (!multiSelectModels) {
    return (
      <ModelItem
        model={model}
        isSelected={selectedModel === model.id}
        onSelect={setSelectedModel}
        effort={reasoningEffort}
      />
    );
  }
  const inPool =
    selectedModel === model.id || selectedWorkerModels.includes(model.id);
  return (
    <DropdownMenuCheckboxItem
      checked={inPool}
      onCheckedChange={(checked) => {
        const next = computeNextMultiModelPool({
          modelId: model.id,
          checked: Boolean(checked),
          selectedModel,
          selectedWorkerModels,
        });
        if (next.primary !== selectedModel) setSelectedModel(next.primary);
        setSelectedWorkerModels?.(next.workers);
      }}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {providerIcon(model.id, 14)}
        <span className="truncate">{model.name}</span>
      </span>
    </DropdownMenuCheckboxItem>
  );
};

/** Renders grouped provider model sections inside the model selector menu. */
const ProviderModelGroups = ({
  providerOrder,
  models,
  modelSearch,
  multiSelectModels,
  selectedModel,
  selectedWorkerModels,
  setSelectedModel,
  setSelectedWorkerModels,
  reasoningEffort,
}: {
  providerOrder: string[];
  models: ModelInfo[];
  modelSearch: string;
  multiSelectModels: boolean;
  selectedModel: string;
  selectedWorkerModels: string[];
  setSelectedModel: (id: string) => void;
  setSelectedWorkerModels?: (ids: string[]) => void;
  reasoningEffort: ReasoningEffort;
}) => (
  <div className="contents">
    {providerOrder
      .filter((p) => p !== "Auto")
      .map((provider) => {
        const providerModels = models.filter(
          (m) =>
            m.provider === provider && matchesModelSearchQuery(m, modelSearch),
        );
        if (providerModels.length === 0) return null;
        return (
          <div key={provider}>
            <DropdownMenuLabel className="text-xs font-regular text-text-muted">
              {provider}
            </DropdownMenuLabel>
            {providerModels.map((m) => (
              <ProviderModelRow
                key={m.id}
                model={m}
                multiSelectModels={multiSelectModels}
                selectedModel={selectedModel}
                selectedWorkerModels={selectedWorkerModels}
                setSelectedModel={setSelectedModel}
                setSelectedWorkerModels={setSelectedWorkerModels}
                reasoningEffort={reasoningEffort}
              />
            ))}
          </div>
        );
      })}
  </div>
);

/** Renders the `Open Providers` marquee button when BYOK setup is incomplete. */
const OpenProvidersTriggerButton = ({
  setupGap,
  onOpenProviders,
}: {
  setupGap: string | null;
  onOpenProviders: () => void;
}) => {
  const tip =
    setupGap ?? "Configure an API key or local runtime in Settings → Providers";
  return (
    <Tooltip content={tip}>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={onOpenProviders}
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
  );
};

/** Renders the scrollable body inside the model picker dropdown menu. */
const ModelDropdownMenuContent = ({
  modelQuery,
  setModelQuery,
  multiSelectModels,
  autoModel,
  modelSearch,
  models,
  providerOrder,
  selectedModel,
  selectedWorkerModels,
  setSelectedModel,
  setSelectedWorkerModels,
  reasoningEffort,
  resolvedAutoModel,
  hasAnyModelMatch,
}: {
  modelQuery: string;
  setModelQuery: (q: string) => void;
  multiSelectModels: boolean;
  autoModel: ModelInfo;
  modelSearch: string;
  models: ModelInfo[];
  providerOrder: string[];
  selectedModel: string;
  selectedWorkerModels: string[];
  setSelectedModel: (id: string) => void;
  setSelectedWorkerModels?: (ids: string[]) => void;
  reasoningEffort: ReasoningEffort;
  resolvedAutoModel: ModelInfo | null;
  hasAnyModelMatch: boolean;
}) => (
  <DropdownMenuContent
    align="end"
    className="w-70 max-w-[calc(100vw-24px)]"
  >
    <SearchInput
      ref={focusSearchOnMount}
      borderless
      placeholder="Search models"
      value={modelQuery}
      onChange={(e) => setModelQuery(e.target.value)}
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    />
    <div className="custom-scrollbar max-h-[280px] overflow-y-auto">
      {multiSelectModels ? (
        <div className="px-2.5 py-1.5 text-xs text-text-muted">
          Orchestrator uses the primary model. Extra picks become the worker
          pool.
        </div>
      ) : null}
      <AutoModelDropdownEntry
        autoModel={autoModel}
        modelSearch={modelSearch}
        multiSelectModels={multiSelectModels}
        selectedModel={selectedModel}
        selectedWorkerModels={selectedWorkerModels}
        setSelectedModel={setSelectedModel}
        setSelectedWorkerModels={setSelectedWorkerModels}
        reasoningEffort={reasoningEffort}
        resolvedAutoModel={resolvedAutoModel}
      />
      <ProviderModelGroups
        providerOrder={providerOrder}
        models={models}
        modelSearch={modelSearch}
        multiSelectModels={multiSelectModels}
        selectedModel={selectedModel}
        selectedWorkerModels={selectedWorkerModels}
        setSelectedModel={setSelectedModel}
        setSelectedWorkerModels={setSelectedWorkerModels}
        reasoningEffort={reasoningEffort}
      />
      {hasAnyModelMatch ? null : (
        <div className="px-2.5 py-3 text-sm text-text-muted">
          No models match
        </div>
      )}
    </div>
  </DropdownMenuContent>
);

/** Renders the trigger button inside the model picker dropdown. */
const ModelDropdownTriggerButton = ({
  modelName,
  activeTriggerIconId,
}: {
  modelName: string;
  activeTriggerIconId: string;
}) => (
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
      <span className="flex min-w-0 items-center gap-1.5 text-sm">
        {providerIcon(activeTriggerIconId, 14)}
        <span className="min-w-0 truncate">{modelName}</span>
      </span>
    </Button>
  </DropdownMenuTrigger>
);

type ActiveModelAndEffortControlsProps = {
  modelMenuOpen: boolean;
  setModelMenuOpen: (open: boolean) => void;
  modelQuery: string;
  setModelQuery: (q: string) => void;
  modelName: string;
  activeTriggerIconId: string;
  multiSelectModels: boolean;
  autoModel: ModelInfo;
  models: ModelInfo[];
  providerOrder: string[];
  selectedModel: string;
  selectedWorkerModels: string[];
  setSelectedModel: (id: string) => void;
  setSelectedWorkerModels?: (ids: string[]) => void;
  reasoningEffort: ReasoningEffort;
  setReasoningEffort: (e: ReasoningEffort) => void;
  resolvedAutoModel: ModelInfo | null;
  effectiveModelId: string;
};

/** Renders the model dropdown + thinking effort controls when a provider is ready. */
const ActiveModelAndEffortControls = ({
  modelMenuOpen,
  setModelMenuOpen,
  modelQuery,
  setModelQuery,
  modelName,
  activeTriggerIconId,
  multiSelectModels,
  autoModel,
  models,
  providerOrder,
  selectedModel,
  selectedWorkerModels,
  setSelectedModel,
  setSelectedWorkerModels,
  reasoningEffort,
  setReasoningEffort,
  resolvedAutoModel,
  effectiveModelId,
}: ActiveModelAndEffortControlsProps) => {
  const modelSearch = modelQuery.trim().toLowerCase();
  const hasAnyModelMatch =
    matchesModelSearchQuery(autoModel, modelSearch) ||
    models.some((m) => matchesModelSearchQuery(m, modelSearch));

  return (
    <div className="contents">
      <DropdownMenu
        open={modelMenuOpen}
        onOpenChange={(open) => {
          setModelMenuOpen(open);
          if (!open) setModelQuery("");
        }}
      >
        <ModelDropdownTriggerButton
          modelName={modelName}
          activeTriggerIconId={activeTriggerIconId}
        />
        {modelMenuOpen ? (
          <ModelDropdownMenuContent
            modelQuery={modelQuery}
            setModelQuery={setModelQuery}
            multiSelectModels={multiSelectModels}
            autoModel={autoModel}
            modelSearch={modelSearch}
            models={models}
            providerOrder={providerOrder}
            selectedModel={selectedModel}
            selectedWorkerModels={selectedWorkerModels}
            setSelectedModel={setSelectedModel}
            setSelectedWorkerModels={setSelectedWorkerModels}
            reasoningEffort={reasoningEffort}
            resolvedAutoModel={resolvedAutoModel}
            hasAnyModelMatch={hasAnyModelMatch}
          />
        ) : null}
      </DropdownMenu>
      <ThinkingEffortControl
        effort={reasoningEffort}
        modelId={effectiveModelId}
        onChange={setReasoningEffort}
      />
    </div>
  );
};

/** Renders the bottom composer bar (ModeMenu, BranchSwitch, Model selector / Open Providers, Effort). */
export const ComposerFooterBar = ({
  hideModeSelect,
  selectedMode,
  setSelectedMode,
  needsSignIn,
  setupGap,
  ...modelControls
}: ActiveModelAndEffortControlsProps & {
  hideModeSelect: boolean;
  selectedMode: string;
  setSelectedMode: (m: string) => void;
  needsSignIn: boolean;
  setupGap: string | null;
}) => (
  <div className="@container/footer flex min-w-0 items-center justify-between gap-1.5 px-1">
    <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
      {hideModeSelect ? null : (
        <ModeMenu
          selectedMode={selectedMode}
          setSelectedMode={setSelectedMode}
        />
      )}
      <div className="hidden min-w-0 shrink @[300px]/footer:flex">
        <WorkspaceBranchSwitch />
      </div>
    </div>

    <div className="flex min-w-0 shrink items-center gap-0.5">
      {needsSignIn ? (
        <OpenProvidersTriggerButton
          setupGap={setupGap}
          onOpenProviders={() => {
            modelControls.setModelMenuOpen(false);
            openSettingsWindow({ category: "providers" }).catch(
              () => undefined,
            );
          }}
        />
      ) : (
        <ActiveModelAndEffortControls {...modelControls} />
      )}
    </div>
  </div>
);
