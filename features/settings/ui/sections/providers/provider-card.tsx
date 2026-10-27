"use client";

import React from "react";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { commands } from "@/lib/backend";
import { updateSettingSection, areSecretsVaulted } from "@/lib/settings";
import {
    SettingRow,
    SettingSelect,
    SETTING_CONTROL_BTN,
} from "../../shared/controls";
import {
    providerPreset,
    modelIdsFor,
    chatModelIdsFor,
    visibleModelIdsFor,
    isConnectionUsable,
    keyFormatWarning,
    providerAuthStyle as mergedProviderAuthStyle,
    withModelVisibility,
    formatHeaderLines,
    parseHeaderLines,
} from "@/lib/ai/providers";
import type {
    AuthStyle,
    ProviderConnection,
    ProviderId,
    ProviderPreset,
    ProvidersSettings,
} from "@/lib/ai/providers";
import { getModelMetadata } from "@/lib/ai/model-catalog";
import { KeyInput, TextInput } from "./inputs";
import {
    ChevronRight20Regular,
    ChevronDown20Regular,
    Link20Regular,
    Airplane20Regular,
    Globe20Regular,
    Code20Regular,
    Database20Regular,
    Settings20Regular,
    Eye20Regular,
    PlugConnected20Regular,
    Checkmark20Regular,
    Copy20Regular,
    Add20Regular,
    Cloud20Regular,
    ErrorCircle20Regular,
    Info20Regular,
    ArrowReset20Regular,
    connectionStatusStyle,
    ProviderMonogram,
    StatusDot,
} from "./status";
import {
    applyImportedModels,
    buildModelSearchHay,
    canRunConnectionTest,
    collectMatchingModels,
    collectModelRowBadges,
    computeInitialAdvancedOpen,
    computeInitiallyExpanded,
    describeCheckButtonTooltip,
    describeTestButtonTooltip,
    enableCatalogMatchedProviders,
    executeCheckChatProbe,
    executeTestConnectionProbe,
    findLatestDiscoveryTimestamp,
    formatModelRowPrice,
    formatModelsDisclosureHint,
    formatModelSourceSuffix,
    formatRefreshAgeLabel,
    groupLabel,
    isNewExtraModelId,
    normalizeExtraModelId,
    resolveCheckModelId,
    resolveLastProbeError,
    resolveModelRowDisplayName,
    supportsExtraModelEntry,
    validateProviderDiagnostics,
    wireLabel,
    type CheckProbeResult,
    type ModelBadge,
    type TestProbeResult,
} from "./provider-card-helpers";

const PROVIDER_SWITCH_CLASS =
    "data-[state=checked]:bg-success data-[state=unchecked]:bg-white/20 [[data-theme=light]_&]:data-[state=unchecked]:bg-black/15";

/** Resolves status/alert role, text color, and icon styling for `StatusMessage`. */
const resolveStatusPresentation = (ok: boolean) =>
    ok
        ? {
              role: "status" as const,
              textClass: "text-text-muted",
              icon: Checkmark20Regular,
              iconClass: "text-success",
          }
        : {
              role: "alert" as const,
              textClass: "text-error whitespace-pre-line",
              icon: ErrorCircle20Regular,
              iconClass: "text-error",
          };

/** Renders an inline diagnostic probe outcome with status/alert semantics. */
const StatusMessage = ({
    ok,
    message,
    latencyMs,
}: {
    ok: boolean;
    message: string;
    latencyMs?: number;
}) => {
    const view = resolveStatusPresentation(ok);
    const showLatency = Boolean(ok && latencyMs);
    return (
        <span
            role={view.role}
            className={cn("inline-flex items-center gap-1 text-xs leading-4", view.textClass)}
        >
            <Icon icon={view.icon} className={cn("size-3.5 shrink-0", view.iconClass)} />
            {message}
            {showLatency ? (
                <span className="text-text-disabled">· {latencyMs} ms</span>
            ) : null}
        </span>
    );
};

/** Renders a collapsible disclosure button inside a provider card body. */
const DisclosureHeader = ({
    open,
    onToggle,
    icon: Glyph,
    label,
    hint,
}: {
    open: boolean;
    onToggle: () => void;
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    hint?: string;
}) => (
    <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 self-start text-xs font-normal text-text-muted transition-colors duration-fast hover:text-text-primary"
    >
        <Icon
            icon={open ? ChevronDown20Regular : ChevronRight20Regular}
            className="size-3"
        />
        <Icon icon={Glyph} className="size-3.5" />
        <span>{label}</span>
        {hint ? <span className="text-text-disabled">· {hint}</span> : null}
    </button>
);

/** Renders a single capability pill (`deprecated`, `reasoning`, `vision`, `tools`). */
const ModelBadgePill = ({ badge }: { badge: ModelBadge }) => {
    const toneClass =
        badge.tone === "warn"
            ? "bg-warning/15 text-warning"
            : "bg-accent/10 text-accent-text";
    return (
        <span
            className={cn(
                "shrink-0 rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide",
                toneClass,
            )}
        >
            {badge.label}
        </span>
    );
};

/** Renders the title, context-window chip, pricing, and capability badges for a model row. */
const ModelRowDetails = ({
    displayName,
    slug,
    ctxLabel,
    priceLabel,
    badges,
    providerLabel,
    sourceSuffix,
}: {
    displayName: string;
    slug: string;
    ctxLabel: string;
    priceLabel: string;
    badges: ModelBadge[];
    providerLabel: string;
    sourceSuffix: string;
}) => {
    const slugSuffix = slug !== displayName ? ` · ${slug}` : "";
    /** Renders a capability badge item by label key. */
    const renderBadge = (badge: ModelBadge): React.ReactElement => (
        <ModelBadgePill key={badge.label} badge={badge} />
    );
    return (
        <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
                <span className="truncate text-xs font-medium text-text-primary">
                    {displayName}
                </span>
                {ctxLabel ? (
                    <span className="shrink-0 rounded bg-surface-3 px-1 py-px text-[10px] font-medium text-text-muted">
                        {ctxLabel}
                    </span>
                ) : null}
                {priceLabel ? (
                    <span className="shrink-0 text-[10px] text-text-disabled">
                        {priceLabel}
                    </span>
                ) : null}
                {badges.map(renderBadge)}
            </div>
            <div className="truncate text-[11px] text-text-disabled">
                {providerLabel}
                {sourceSuffix}
                {slugSuffix}
            </div>
        </div>
    );
};

/** Copies `modelId` to the clipboard and briefly activates `setCopied`. */
const copyModelIdToClipboard = async (
    modelId: string,
    setCopied: React.Dispatch<React.SetStateAction<boolean>>,
): Promise<void> => {
    try {
        await navigator.clipboard?.writeText(modelId);
        setCopied(true);
        /** Clears the transient copied checkmark after 1.2s. */
        const resetCopied = (): void => setCopied(false);
        window.setTimeout(resetCopied, 1200);
    } catch {
        /* clipboard unavailable */
    }
};

/** Renders the compact visibility toggle switch inside `ModelRow`. */
const ModelVisibilitySwitch = ({
    slug,
    visible,
    onToggle,
}: {
    slug: string;
    visible: boolean;
    onToggle: () => void;
}) => {
    const label = visible ? `Hide ${slug} from pickers` : `Show ${slug} in pickers`;
    const toneClass = visible
        ? "border-accent/60 bg-accent/15 text-accent-text"
        : "border-border-secondary bg-transparent text-text-disabled hover:border-border hover:text-text-muted";
    return (
        <button
            type="button"
            role="switch"
            aria-checked={visible}
            aria-label={label}
            onClick={onToggle}
            className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded border transition-colors duration-fast",
                toneClass,
            )}
        >
            <Icon
                icon={visible ? Checkmark20Regular : Eye20Regular}
                className="size-3"
            />
        </button>
    );
};

/** Renders the copy-id icon button on the right edge of `ModelRow`. */
const CopyModelIdButton = ({
    copied,
    onCopy,
}: {
    copied: boolean;
    onCopy: () => void;
}) => {
    const tooltip = copied ? "Copied model id" : "Copy model id";
    return (
        <Tooltip content={tooltip} side="left">
            <Button
                size="icon"
                variant="ghost"
                className="size-6 text-text-disabled opacity-0 transition-opacity duration-fast hover:text-text-secondary focus-visible:opacity-100 group-hover:opacity-100"
                aria-label="Copy model id"
                onClick={onCopy}
            >
                <Icon
                    icon={copied ? Checkmark20Regular : Copy20Regular}
                    className="size-3"
                />
            </Button>
        </Tooltip>
    );
};

/** Computes container classes for `ModelRow` based on `visible` and search `match`. */
const computeModelRowClass = (visible: boolean, match: boolean): string =>
    cn(
        "group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors duration-fast",
        visible ? "hover:bg-[var(--row-hover)]" : "opacity-60",
        match ? "bg-accent/10 ring-1 ring-accent/30" : undefined,
    );

/** Renders a per-model visibility switch, metadata summary, and copy-id button. */
const ModelRow = ({
    modelId,
    visible,
    onToggleVisible,
    providerLabel,
    providerId,
    match = false,
}: {
    modelId: string;
    visible: boolean;
    onToggleVisible: (v: boolean) => void;
    providerLabel: string;
    providerId: ProviderId;
    match?: boolean;
}) => {
    const [copied, setCopied] = React.useState(false);
    const slug = modelId.split("/").slice(1).join("/");
    const meta = getModelMetadata(modelId, providerId);
    const displayName = resolveModelRowDisplayName(meta.name, slug);
    /** Toggles model picker visibility for `modelId`. */
    const handleToggle = (): void => onToggleVisible(!visible);
    /** Copies `modelId` to clipboard on button click. */
    const handleCopy = (): void => {
        copyModelIdToClipboard(modelId, setCopied).catch(() => undefined);
    };

    return (
        <div className={computeModelRowClass(visible, match)}>
            <ModelVisibilitySwitch
                slug={slug}
                visible={visible}
                onToggle={handleToggle}
            />
            <ModelRowDetails
                displayName={displayName}
                slug={slug}
                ctxLabel={meta.contextWindowLabel ?? ""}
                priceLabel={formatModelRowPrice(meta)}
                badges={collectModelRowBadges(meta)}
                providerLabel={providerLabel}
                sourceSuffix={formatModelSourceSuffix(meta.source)}
            />
            <CopyModelIdButton copied={copied} onCopy={handleCopy} />
        </div>
    );
};

/** Renders the hidden-model count badge beside a provider's header title. */
const HiddenModelsBadge = ({ hiddenCount }: { hiddenCount: number }) => {
    if (hiddenCount <= 0) return null;
    const noun = hiddenCount === 1 ? "model" : "models";
    return (
        <Tooltip content={`${hiddenCount} ${noun} hidden from pickers`} side="top">
            <span className="inline-flex items-center gap-0.5 rounded-sm bg-surface-3 px-1 py-px text-[10px] font-normal text-text-muted">
                <Icon icon={Eye20Regular} className="size-2.5" />
                {hiddenCount} hidden
            </span>
        </Tooltip>
    );
};

/** Renders the title, group badge, status dot, and protocol subtitle inside a card header. */
const ProviderHeaderSummary = ({
    preset,
    hiddenCount,
    status,
}: {
    preset: ProviderPreset;
    hiddenCount: number;
    status: ReturnType<typeof connectionStatusStyle>;
}) => (
    <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-medium text-text-primary">
            <span className="truncate">{preset.label}</span>
            <span className="ml-1 rounded-sm bg-surface-3 px-1 py-px text-[10px] font-normal uppercase tracking-wide text-text-muted">
                {groupLabel(preset.group)}
            </span>
            <HiddenModelsBadge hiddenCount={hiddenCount} />
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-text-muted">
            <StatusDot style={status} />
            <span>{status.label}</span>
            <span className="text-text-disabled">·</span>
            <span className="truncate">{wireLabel(preset.kind)}</span>
        </div>
    </div>
);

/** Renders the un-nested sibling action cluster (`Reset`, `Get a key`, `Enable`, chevron) for a provider card. */
const ProviderHeaderActions = ({
    preset,
    enabled,
    expanded,
    onReset,
    onToggleEnabled,
    onToggleExpand,
}: {
    preset: ProviderPreset;
    enabled: boolean;
    expanded: boolean;
    onReset?: () => void;
    onToggleEnabled: (enabled: boolean) => void;
    onToggleExpand: () => void;
}) => {
    const docsUrl = preset.docsUrl;
    /** Opens `docsUrl` in the system browser when present. */
    const handleOpenDocs = (): void => {
        if (!docsUrl) return;
        commands.openUrlExternal(docsUrl).catch(() => undefined);
    };

    return (
        <div className="flex shrink-0 items-center gap-2.5 py-3 pr-4">
            {onReset ? (
                <Tooltip content="Reset this provider - clears key, URL, headers" side="top">
                    <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-text-muted opacity-0 transition-opacity duration-fast group-hover:opacity-100 hover:text-error focus-visible:opacity-100"
                        aria-label={`Reset ${preset.label}`}
                        onClick={onReset}
                    >
                        <Icon icon={ArrowReset20Regular} className="size-3.5" />
                    </Button>
                </Tooltip>
            ) : null}
            {docsUrl ? (
                <Tooltip content="Get a key" side="top">
                    <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-text-muted opacity-0 transition-opacity duration-fast group-hover:opacity-100 hover:text-text-primary focus-visible:opacity-100"
                        aria-label={`Get a ${preset.label} key`}
                        onClick={handleOpenDocs}
                    >
                        <Icon icon={Link20Regular} className="size-3.5" />
                    </Button>
                </Tooltip>
            ) : null}
            <Switch
                aria-label={`Enable ${preset.label}`}
                checked={enabled}
                onCheckedChange={onToggleEnabled}
                className={PROVIDER_SWITCH_CLASS}
            />
            <button
                type="button"
                aria-label={expanded ? `Collapse ${preset.label}` : `Expand ${preset.label}`}
                onClick={onToggleExpand}
                className="flex size-6 items-center justify-center rounded text-text-muted transition-colors duration-fast hover:text-text-primary"
            >
                <Icon
                    icon={expanded ? ChevronDown20Regular : ChevronRight20Regular}
                    className="size-3.5 transition-transform duration-fast"
                />
            </button>
        </div>
    );
};

/** Renders the editable or read-only base URL cell beside `KeyInput`. */
const ProviderBaseUrlField = ({
    preset,
    baseUrl,
    onChange,
    onReset,
}: {
    preset: ProviderPreset;
    baseUrl: string;
    onChange: (baseUrl: string) => void;
    onReset: () => void;
}) => {
    if (preset.needsBaseUrl || baseUrl) {
        return (
            <TextInput
                value={baseUrl}
                placeholder={preset.baseUrl || "https://host/v1"}
                onChange={onChange}
                onReset={onReset}
                defaultValue={preset.baseUrl}
                mono
            />
        );
    }
    return (
        <div className="flex h-8 items-center gap-1.5 rounded-md border border-border-secondary bg-surface-2/50 px-2 text-xs text-text-muted">
            <Icon icon={Globe20Regular} className="size-3.5 shrink-0 text-text-disabled" />
            <span className="truncate font-mono text-[11px]">{preset.baseUrl}</span>
        </div>
    );
};

/** Checks whether a provider's secret is stored in the OS vault rather than local JSON. */
const isProviderKeySavedInVault = (apiKey: string, usable: boolean): boolean =>
    Boolean(areSecretsVaulted() && !apiKey && usable);

/** Renders the API key input and editable or read-only base URL field for a provider card. */
const ProviderCredentialsGrid = ({
    id,
    preset,
    connection,
    usable,
    onUpdate,
}: {
    id: ProviderId;
    preset: ProviderPreset;
    connection: ProviderConnection;
    usable: boolean;
    onUpdate: (patch: Partial<ProviderConnection>) => void;
}) => {
    const savedInVault = isProviderKeySavedInVault(connection.apiKey, usable);
    /** Updates the connection's `apiKey` draft. */
    const handleApiKeyChange = (apiKey: string): void => onUpdate({ apiKey });
    /** Updates the connection's `baseUrl` override. */
    const handleBaseUrlChange = (baseUrl: string): void => onUpdate({ baseUrl });
    /** Clears any custom `baseUrl` override back to `preset.baseUrl`. */
    const handleResetUrl = (): void => onUpdate({ baseUrl: "" });

    return (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <KeyInput
                value={connection.apiKey}
                placeholder={preset.keyHint || "API key"}
                onChange={handleApiKeyChange}
                warning={keyFormatWarning(id, connection.apiKey)}
                savedInVault={savedInVault}
            />
            <ProviderBaseUrlField
                preset={preset}
                baseUrl={connection.baseUrl}
                onChange={handleBaseUrlChange}
                onReset={handleResetUrl}
            />
        </div>
    );
};

/** Renders the `Refresh models` and `Pin N & set default` buttons when applicable. */
const ProviderModelProbeButtons = ({
    canTest,
    testing,
    testResult,
    onRefresh,
    onImport,
}: {
    canTest: boolean;
    testing: boolean;
    testResult: TestProbeResult | null;
    onRefresh: () => void;
    onImport: () => void;
}) => {
    const pinnedCount = testResult?.ok ? testResult.models.length : 0;
    return (
        <>
            {canTest ? (
                <Tooltip content="Refetch the model list from the provider and refresh metadata" side="top">
                    <span>
                        <Button
                            size="sm"
                            variant="ghost"
                            className={SETTING_CONTROL_BTN}
                            loading={testing}
                            disabled={testing}
                            onClick={onRefresh}
                        >
                            <Icon icon={ArrowReset20Regular} className="size-3.5" />
                            Refresh models
                        </Button>
                    </span>
                </Tooltip>
            ) : null}
            {pinnedCount > 0 ? (
                <Button
                    size="sm"
                    variant="ghost"
                    className={SETTING_CONTROL_BTN}
                    disabled={testing}
                    onClick={onImport}
                >
                    <Icon icon={Database20Regular} className="size-3.5" />
                    Pin {pinnedCount} & set default
                </Button>
            ) : null}
        </>
    );
};

/** Renders a single tooltipped diagnostic probe button (`Test connection` or `Check chat`). */
const DiagnosticProbeButton = ({
    tooltip,
    variant,
    icon,
    idleLabel,
    loadingLabel,
    loading,
    unavailable,
    onClick,
}: {
    tooltip: string;
    variant: "secondary" | "ghost";
    icon: React.ComponentType<{ className?: string }>;
    idleLabel: string;
    loadingLabel: string;
    loading: boolean;
    unavailable: boolean;
    onClick: () => void;
}) => (
    <Tooltip content={tooltip} side="top">
        <span>
            <Button
                size="sm"
                variant={variant}
                className={SETTING_CONTROL_BTN}
                loading={loading}
                disabled={unavailable || loading}
                onClick={onClick}
            >
                <Icon icon={icon} className="size-3.5" />
                {loading ? loadingLabel : idleLabel}
            </Button>
        </span>
    </Tooltip>
);

/** Renders the standalone `Check chat` result row when no `Test connection` banner is shown. */
const StandaloneCheckStatus = ({
    testResult,
    checkResult,
}: {
    testResult: TestProbeResult | null;
    checkResult: CheckProbeResult | null;
}) => {
    if (!checkResult || testResult) return null;
    return (
        <div className="mt-2">
            <StatusMessage
                ok={checkResult.ok}
                message={checkResult.message}
                latencyMs={checkResult.latencyMs}
            />
        </div>
    );
};

/** Renders `Test connection`, `Check chat`, model refresh/pin actions, and inline probe messages. */
const ProviderDiagnosticsBar = ({
    canTest,
    testing,
    checking,
    checkModel,
    testTooltip,
    checkTooltip,
    testResult,
    checkResult,
    onTest,
    onCheck,
    onRefresh,
    onImport,
}: {
    canTest: boolean;
    testing: boolean;
    checking: boolean;
    checkModel: string;
    testTooltip: string;
    checkTooltip: string;
    testResult: TestProbeResult | null;
    checkResult: CheckProbeResult | null;
    onTest: () => void;
    onCheck: () => void;
    onRefresh: () => void;
    onImport: () => void;
}) => (
    <>
        <div className="mt-3 flex flex-wrap items-center gap-2">
            <DiagnosticProbeButton
                tooltip={testTooltip}
                variant="secondary"
                icon={PlugConnected20Regular}
                idleLabel="Test connection"
                loadingLabel="Testing…"
                loading={testing}
                unavailable={!canTest}
                onClick={onTest}
            />
            <DiagnosticProbeButton
                tooltip={checkTooltip}
                variant="ghost"
                icon={Airplane20Regular}
                idleLabel="Check chat"
                loadingLabel="Checking…"
                loading={checking}
                unavailable={!checkModel}
                onClick={onCheck}
            />
            <ProviderModelProbeButtons
                canTest={canTest}
                testing={testing}
                testResult={testResult}
                onRefresh={onRefresh}
                onImport={onImport}
            />
            {testResult ? (
                <StatusMessage
                    ok={testResult.ok}
                    message={testResult.message}
                    latencyMs={testResult.latencyMs}
                />
            ) : null}
        </div>
        <StandaloneCheckStatus testResult={testResult} checkResult={checkResult} />
    </>
);

/** Renders the extra-model input row for custom or open-catalog providers. */
const ExtraModelInputRow = ({
    value,
    onChange,
    onAdd,
}: {
    value: string;
    onChange: (value: string) => void;
    onAdd: () => void;
}) => {
    /** Updates the draft model ID string on input change. */
    const handleInput = (e: React.ChangeEvent<HTMLInputElement>): void =>
        onChange(e.target.value);
    /** Submits the extra model ID when pressing Enter. */
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
        if (e.key === "Enter") onAdd();
    };

    return (
        <div className="flex items-center gap-1.5 pt-1">
            <input
                type="text"
                value={value}
                placeholder="Add model id (e.g. llama3.1)"
                spellCheck={false}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                className="h-7 min-w-0 flex-1 rounded-md border border-border-secondary bg-transparent px-2 font-mono text-xs text-text-primary outline-none focus:border-accent"
            />
            <Button
                size="xs"
                variant="ghost"
                className="h-7 gap-1 text-text-muted"
                onClick={onAdd}
                disabled={!value.trim()}
            >
                <Icon icon={Add20Regular} className="size-3" />
                Add
            </Button>
        </div>
    );
};

/** Formats the disclosure header label for a provider's chat model list. */
const formatModelsSectionLabel = (
    visibleCount: number,
    chatCount: number,
): string => {
    if (chatCount === 0) return "Models";
    const noun = chatCount === 1 ? "model" : "models";
    return `${visibleCount} of ${chatCount} chat ${noun}`;
};

/** Renders the collapsible chat-model visibility list and extra-model input row. */
const ProviderModelsSection = ({
    id,
    preset,
    connection,
    allModelsCount,
    chatModels,
    visibleCount,
    hiddenCount,
    refreshLabel,
    needle,
    modelMatches,
    modelsOpen,
    extraModelInput,
    onToggleOpen,
    onToggleModelVisible,
    onExtraModelInputChange,
    onAddExtraModel,
}: {
    id: ProviderId;
    preset: ProviderPreset;
    connection: ProviderConnection;
    allModelsCount: number;
    chatModels: string[];
    visibleCount: number;
    hiddenCount: number;
    refreshLabel: string;
    needle: string;
    modelMatches: Set<string>;
    modelsOpen: boolean;
    extraModelInput: string;
    onToggleOpen: () => void;
    onToggleModelVisible: (modelId: string, visible: boolean) => void;
    onExtraModelInputChange: (value: string) => void;
    onAddExtraModel: () => void;
}) => {
    if (allModelsCount === 0 && preset.models.length > 0) return null;
    const hint = formatModelsDisclosureHint(hiddenCount, refreshLabel);
    const canAddExtra = supportsExtraModelEntry(preset);
    /** Renders a `ModelRow` entry for `modelId`. */
    const renderModelRow = (modelId: string): React.ReactElement => {
        /** Forwards visibility changes for `modelId`. */
        const handleRowToggle = (visible: boolean): void =>
            onToggleModelVisible(modelId, visible);
        return (
            <ModelRow
                key={modelId}
                modelId={modelId}
                visible={!connection.hiddenModels.includes(modelId)}
                onToggleVisible={handleRowToggle}
                providerLabel={preset.label}
                providerId={id}
                match={Boolean(needle && modelMatches.has(modelId))}
            />
        );
    };

    return (
        <div className="mt-3">
            <DisclosureHeader
                open={modelsOpen}
                onToggle={onToggleOpen}
                icon={Code20Regular}
                label={formatModelsSectionLabel(visibleCount, chatModels.length)}
                hint={hint}
            />
            {modelsOpen ? (
                <div className="mt-2 space-y-1">
                    {chatModels.map(renderModelRow)}
                    {canAddExtra ? (
                        <ExtraModelInputRow
                            value={extraModelInput}
                            onChange={onExtraModelInputChange}
                            onAdd={onAddExtraModel}
                        />
                    ) : null}
                </div>
            ) : null}
        </div>
    );
};

/** Renders the preset default headers note beneath `Extra headers` when present. */
const PresetHeadersHint = ({ preset }: { preset: ProviderPreset }) => {
    const entries = Object.entries(preset.headers ?? {});
    if (entries.length === 0) return null;
    /** Formats a `[name, value]` header pair as `name: value`. */
    const formatPair = ([name, value]: [string, string]): string =>
        `${name}: ${value}`;
    return (
        <div className="mt-1 flex items-start gap-1.5 px-3.5 text-xs leading-4 text-text-muted">
            <Icon icon={Info20Regular} className="mt-px size-3.5 shrink-0 text-text-disabled" />
            <span>
                {preset.label} always sends {entries.map(formatPair).join(", ")}. Your lines above win on conflicts.
            </span>
        </div>
    );
};

/** Renders the collapsible `Request headers & auth` settings section. */
const ProviderAdvancedSection = ({
    id,
    preset,
    connection,
    open,
    onToggle,
    onUpdate,
}: {
    id: ProviderId;
    preset: ProviderPreset;
    connection: ProviderConnection;
    open: boolean;
    onToggle: () => void;
    onUpdate: (patch: Partial<ProviderConnection>) => void;
}) => {
    const defaultAuthLabel = `Default (${mergedProviderAuthStyle(id, connection)})`;
    /** Updates `authStyle` when the user selects an auth header mode. */
    const handleAuthChange = (value: string): void =>
        onUpdate({ authStyle: value as AuthStyle | "" });
    /** Parses and updates custom request headers from textarea lines. */
    const handleHeadersChange = (
        e: React.ChangeEvent<HTMLTextAreaElement>,
    ): void => onUpdate({ headers: parseHeaderLines(e.target.value) });

    return (
        <div className="mt-3">
            <DisclosureHeader
                open={open}
                onToggle={onToggle}
                icon={Settings20Regular}
                label="Request headers & auth"
            />
            {open ? (
                <div className="mt-2 space-y-px">
                    <SettingRow
                        title="Auth header"
                        description="Where the key is sent. Leave on the default unless the endpoint expects otherwise."
                    >
                        <SettingSelect
                            value={connection.authStyle}
                            onChange={handleAuthChange}
                            options={[
                                { value: "", label: defaultAuthLabel },
                                { value: "bearer", label: "Authorization: Bearer" },
                                { value: "api-key", label: "api-key" },
                                { value: "x-api-key", label: "x-api-key" },
                                { value: "x-goog-api-key", label: "x-goog-api-key" },
                                { value: "none", label: "No auth header" },
                            ]}
                        />
                    </SettingRow>
                    <SettingRow
                        stack
                        title="Extra headers"
                        description="One Name: value per line. Values are stored in the OS keychain beside the key."
                    >
                        <textarea
                            value={formatHeaderLines(connection.headers)}
                            placeholder={"HTTP-Referer: https://example.com\nX-Tenant: acme"}
                            spellCheck={false}
                            rows={3}
                            onChange={handleHeadersChange}
                            className="w-full rounded-md border border-border-secondary bg-transparent px-2 py-1.5 font-mono text-xs text-text-primary outline-none focus:border-accent"
                        />
                    </SettingRow>
                    <PresetHeadersHint preset={preset} />
                </div>
            ) : null}
        </div>
    );
};

/** Checks whether the catalog-provider matching banner should render. */
const shouldShowCatalogMatchBanner = (
    preset: ProviderPreset,
    connection: ProviderConnection,
): boolean => preset.models.length === 0 && connection.extraModels.length > 0;

/** Checks whether the effective endpoint line should render at the card bottom. */
const shouldShowEffectiveEndpoint = (
    preset: ProviderPreset,
    connection: ProviderConnection,
    hasKey: boolean,
): boolean => Boolean(connection.enabled && (hasKey || preset.keyless));

/** Renders the footer helper and effective endpoint line inside an expanded provider card. */
const ProviderCardFooter = ({
    preset,
    connection,
    hasKey,
    effectiveBaseUrl,
    onEnableMatched,
}: {
    preset: ProviderPreset;
    connection: ProviderConnection;
    hasKey: boolean;
    effectiveBaseUrl: string;
    onEnableMatched: () => void;
}) => {
    const showMatchHelper = shouldShowCatalogMatchBanner(preset, connection);
    const showEndpoint = shouldShowEffectiveEndpoint(preset, connection, hasKey);
    const endpointLabel = effectiveBaseUrl || "\u2014";
    return (
        <>
            {showMatchHelper ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-border-subtle bg-surface-2/40 px-3 py-2">
                    <Button
                        size="xs"
                        variant="ghost"
                        className="h-7 gap-1 text-text-secondary"
                        onClick={onEnableMatched}
                    >
                        <Icon icon={Cloud20Regular} className="size-3.5" />
                        Enable providers these models belong to
                    </Button>
                    <span className="text-xs text-text-muted">
                        Turns on matching providers so you can paste keys for them.
                    </span>
                </div>
            ) : null}
            {showEndpoint ? (
                <div className="mt-3 flex items-center gap-1.5 text-[11px] text-text-disabled">
                    <Icon icon={Globe20Regular} className="size-3" />
                    <span className="truncate font-mono">{endpointLabel}</span>
                </div>
            ) : null}
        </>
    );
};

/** Tracks relative discovery refresh age (`"fetched Xm ago"`) for `discoveredModels`. */
const useDiscoveryRefreshLabel = (
    discoveredModels: ProviderConnection["discoveredModels"],
): string => {
    const lastRefreshedAt = React.useMemo(
        () => findLatestDiscoveryTimestamp(discoveredModels),
        [discoveredModels],
    );
    const [now, setNow] = React.useState(() => Date.now());
    React.useEffect(() => {
        if (!lastRefreshedAt) return undefined;
        const timerId = window.setInterval(() => setNow(Date.now()), 60_000);
        return () => window.clearInterval(timerId);
    }, [lastRefreshedAt]);
    const effectiveNow = Math.max(now, lastRefreshedAt);
    const ageSeconds = lastRefreshedAt
        ? Math.floor((effectiveNow - lastRefreshedAt) / 1000)
        : 0;
    return React.useMemo(
        () => formatRefreshAgeLabel(lastRefreshedAt, ageSeconds),
        [lastRefreshedAt, ageSeconds],
    );
};

/** Auto-expands the card and model list once per non-empty search match run. */
const useAutoExpandOnQueryMatch = (
    hasModelMatches: boolean,
    setModelsOpen: React.Dispatch<React.SetStateAction<boolean>>,
    setExpanded: React.Dispatch<React.SetStateAction<boolean>>,
): void => {
    const queryAutoExpandedRef = React.useRef(false);
    /** Expands card and models section on first search match and resets when cleared. */
    const syncQueryExpansion = (): void => {
        if (!hasModelMatches) {
            queryAutoExpandedRef.current = false;
            return;
        }
        if (queryAutoExpandedRef.current) return;
        setModelsOpen(true);
        setExpanded(true);
        queryAutoExpandedRef.current = true;
    };
    React.useLayoutEffect(syncQueryExpansion, [
        hasModelMatches,
        setExpanded,
        setModelsOpen,
    ]);
};

/** Manages `Test connection` and `Check chat` probe state and handlers for `ProviderCard`. */
const useProviderDiagnosticsState = (
    id: ProviderId,
    preset: ProviderPreset,
    connection: ProviderConnection,
    checkModel: string,
    update: (patch: Partial<ProviderConnection>) => void,
) => {
    const [testing, setTesting] = React.useState(false);
    const [testResult, setTestResult] = React.useState<TestProbeResult | null>(
        null,
    );
    const [checking, setChecking] = React.useState(false);
    const [checkResult, setCheckResult] =
        React.useState<CheckProbeResult | null>(null);

    /** Validates and runs a `Test connection` probe against `id`. */
    const runTestProbe = async (): Promise<void> => {
        setTestResult(null);
        const err = validateProviderDiagnostics(
            "test",
            id,
            preset,
            connection,
            checkModel,
        );
        if (err) {
            setTestResult({ ok: false, message: err, models: [] });
            return;
        }
        setTesting(true);
        try {
            setTestResult(
                await executeTestConnectionProbe(id, preset, connection, update),
            );
        } finally {
            setTesting(false);
        }
    };

    /** Validates and runs a `Check chat` probe against `id` and `checkModel`. */
    const runCheckProbe = async (): Promise<void> => {
        setCheckResult(null);
        const err = validateProviderDiagnostics(
            "check",
            id,
            preset,
            connection,
            checkModel,
        );
        if (err) {
            setCheckResult({ ok: false, message: err });
            return;
        }
        if (!checkModel) return;
        setChecking(true);
        try {
            setCheckResult(
                await executeCheckChatProbe(id, preset, connection, checkModel),
            );
        } finally {
            setChecking(false);
        }
    };

    return {
        testing,
        testResult,
        checking,
        checkResult,
        runTestProbe,
        runCheckProbe,
    };
};

/** Renders the expanded settings body for a single `ProviderCard`. */
const ProviderCardBody = ({
    id,
    preset,
    providers,
    connection,
    usable,
    hasKey,
    hasBaseUrl,
    visibleModels,
    allModels,
    chatModels,
    hiddenCount,
    needle,
    modelMatches,
    refreshLabel,
    modelsOpen,
    onToggleModelsOpen,
    diagnostics,
    onUpdate,
}: {
    id: ProviderId;
    preset: ProviderPreset;
    providers: ProvidersSettings;
    connection: ProviderConnection;
    usable: boolean;
    hasKey: boolean;
    hasBaseUrl: boolean;
    visibleModels: string[];
    allModels: string[];
    chatModels: string[];
    hiddenCount: number;
    needle: string;
    modelMatches: Set<string>;
    refreshLabel: string;
    modelsOpen: boolean;
    onToggleModelsOpen: () => void;
    diagnostics: ReturnType<typeof useProviderDiagnosticsState>;
    onUpdate: (patch: Partial<ProviderConnection>) => void;
}) => {
    const [advancedOpen, setAdvancedOpen] = React.useState(
        computeInitialAdvancedOpen(connection),
    );
    const [extraModelInput, setExtraModelInput] = React.useState("");
    const checkModel = resolveCheckModelId(id, visibleModels, providers.chatMode);
    const canTest = canRunConnectionTest(preset, connection, hasKey, hasBaseUrl);
    const testTooltip = describeTestButtonTooltip(
        canTest,
        connection.enabled,
        Boolean(preset.needsBaseUrl && !hasBaseUrl),
        Boolean(!hasKey && !preset.keyless),
    );
    const checkTooltip = describeCheckButtonTooltip(
        checkModel,
        visibleModels.length > 0,
    );

    /** Triggers `runTestProbe` without unhandled promise rejections. */
    const handleTest = (): void => {
        diagnostics.runTestProbe().catch(() => undefined);
    };
    /** Triggers `runCheckProbe` without unhandled promise rejections. */
    const handleCheck = (): void => {
        diagnostics.runCheckProbe().catch(() => undefined);
    };
    /** Pins discovered models from the latest successful `Test connection` result. */
    const handleImport = (): void => {
        if (!diagnostics.testResult) return;
        applyImportedModels(
            id,
            preset,
            providers,
            connection,
            diagnostics.testResult.models,
        );
    };
    /** Updates per-model visibility in pickers. */
    const handleToggleModelVisible = (modelId: string, visible: boolean): void =>
        onUpdate(withModelVisibility(connection, modelId, visible));
    /** Adds a normalized extra model ID onto `connection.extraModels`. */
    const handleAddExtraModel = (): void => {
        const nextId = normalizeExtraModelId(extraModelInput, preset.id);
        if (!nextId) return;
        if (isNewExtraModelId(nextId, connection.extraModels, allModels)) {
            onUpdate({ extraModels: [...connection.extraModels, nextId] });
        }
        setExtraModelInput("");
    };
    /** Toggles the `Request headers & auth` section open state. */
    const handleToggleAdvanced = (): void => setAdvancedOpen((prev) => !prev);
    /** Enables any known providers matching `connection.extraModels`. */
    const handleEnableMatched = (): void =>
        enableCatalogMatchedProviders(providers, connection.extraModels);

    return (
        <div
            id={`provider-${id}-body`}
            className="border-t border-border-subtle px-4 pb-4 pt-3"
        >
            {preset.note ? (
                <div className="mb-2.5 flex items-start gap-1.5 text-xs leading-4 text-text-muted">
                    <Icon icon={Info20Regular} className="mt-px size-3.5 shrink-0 text-text-disabled" />
                    <span>{preset.note}</span>
                </div>
            ) : null}
            <ProviderCredentialsGrid
                id={id}
                preset={preset}
                connection={connection}
                usable={usable}
                onUpdate={onUpdate}
            />
            <ProviderDiagnosticsBar
                canTest={canTest}
                testing={diagnostics.testing}
                checking={diagnostics.checking}
                checkModel={checkModel}
                testTooltip={testTooltip}
                checkTooltip={checkTooltip}
                testResult={diagnostics.testResult}
                checkResult={diagnostics.checkResult}
                onTest={handleTest}
                onCheck={handleCheck}
                onRefresh={handleTest}
                onImport={handleImport}
            />
            <ProviderModelsSection
                id={id}
                preset={preset}
                connection={connection}
                allModelsCount={allModels.length}
                chatModels={chatModels}
                visibleCount={visibleModels.length}
                hiddenCount={hiddenCount}
                refreshLabel={refreshLabel}
                needle={needle}
                modelMatches={modelMatches}
                modelsOpen={modelsOpen}
                extraModelInput={extraModelInput}
                onToggleOpen={onToggleModelsOpen}
                onToggleModelVisible={handleToggleModelVisible}
                onExtraModelInputChange={setExtraModelInput}
                onAddExtraModel={handleAddExtraModel}
            />
            <ProviderAdvancedSection
                id={id}
                preset={preset}
                connection={connection}
                open={advancedOpen}
                onToggle={handleToggleAdvanced}
                onUpdate={onUpdate}
            />
            <ProviderCardFooter
                preset={preset}
                connection={connection}
                hasKey={hasKey}
                effectiveBaseUrl={connection.baseUrl || preset.baseUrl}
                onEnableMatched={handleEnableMatched}
            />
        </div>
    );
};

/** Renders a collapsible provider configuration card in Settings -> Providers. */
export const ProviderCard = ({
    id,
    providers,
    defaultExpanded = false,
    query = "",
    onReset,
}: {
    id: ProviderId;
    providers: ProvidersSettings;
    defaultExpanded?: boolean;
    /** Filter query from the parent search. Used to highlight matching models. */
    query?: string;
    /** Called when the user clicks the per-card Reset button. If omitted, reset is hidden. */
    onReset?: () => void;
}) => {
    const preset = providerPreset(id);
    const connection = providers.connections[id];
    const usable = isConnectionUsable(id, providers.connections);
    const hasKey = connection.apiKey.trim().length > 0;
    const hasBaseUrl = connection.baseUrl.trim().length > 0;
    const [expanded, setExpanded] = React.useState(
        computeInitiallyExpanded(defaultExpanded, usable && hasKey, connection),
    );
    const [modelsOpen, setModelsOpen] = React.useState(false);

    const update = React.useCallback(
        (patch: Partial<ProviderConnection>): void => {
            updateSettingSection("ai", {
                providers: {
                    ...providers,
                    connections: {
                        ...providers.connections,
                        [id]: { ...connection, ...patch },
                    },
                },
            });
        },
        [providers, connection, id],
    );

    const visibleModels = visibleModelIdsFor(id, providers.connections);
    const allModels = modelIdsFor(id, providers.connections);
    const chatModels = chatModelIdsFor(id, providers.connections);
    const hiddenCount = chatModels.length - visibleModels.length;
    const checkModel = resolveCheckModelId(id, visibleModels, providers.chatMode);
    const diagnostics = useProviderDiagnosticsState(
        id,
        preset,
        connection,
        checkModel,
        update,
    );

    const status = connectionStatusStyle({
        enabled: connection.enabled,
        hasKey,
        keyless: Boolean(preset.keyless),
        needsBaseUrl: preset.needsBaseUrl,
        hasBaseUrl,
        lastError: resolveLastProbeError(
            diagnostics.testResult,
            diagnostics.checkResult,
        ),
    });

    const needle = query.trim().toLowerCase();
    const modelNameForSearch = React.useCallback(
        (mid: string): string => buildModelSearchHay(mid, id, preset, connection),
        [preset, connection, id],
    );
    const modelMatches = React.useMemo(
        () => collectMatchingModels(needle, allModels, modelNameForSearch),
        [needle, allModels, modelNameForSearch],
    );

    const refreshLabel = useDiscoveryRefreshLabel(connection.discoveredModels);
    useAutoExpandOnQueryMatch(modelMatches.size > 0, setModelsOpen, setExpanded);

    /** Toggles card body expansion. */
    const handleToggleExpand = (): void => setExpanded((prev) => !prev);
    /** Toggles provider `enabled` state. */
    const handleToggleEnabled = (enabled: boolean): void => update({ enabled });
    /** Toggles models disclosure section open state. */
    const handleToggleModelsOpen = (): void => setModelsOpen((prev) => !prev);

    return (
        <div
            data-provider-id={id}
            className="overflow-hidden rounded-xl bg-settings-card squircle-[18px]"
        >
            <div className="group flex w-full items-start transition-colors duration-fast hover:bg-[var(--row-hover)]">
                <button
                    type="button"
                    onClick={handleToggleExpand}
                    aria-expanded={expanded}
                    aria-controls={`provider-${id}-body`}
                    className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left"
                >
                    <ProviderMonogram preset={preset} />
                    <ProviderHeaderSummary
                        preset={preset}
                        hiddenCount={hiddenCount}
                        status={status}
                    />
                </button>
                <ProviderHeaderActions
                    preset={preset}
                    enabled={connection.enabled}
                    expanded={expanded}
                    onReset={onReset}
                    onToggleEnabled={handleToggleEnabled}
                    onToggleExpand={handleToggleExpand}
                />
            </div>
            {expanded ? (
                <ProviderCardBody
                    id={id}
                    preset={preset}
                    providers={providers}
                    connection={connection}
                    usable={usable}
                    hasKey={hasKey}
                    hasBaseUrl={hasBaseUrl}
                    visibleModels={visibleModels}
                    allModels={allModels}
                    chatModels={chatModels}
                    hiddenCount={hiddenCount}
                    needle={needle}
                    modelMatches={modelMatches}
                    refreshLabel={refreshLabel}
                    modelsOpen={modelsOpen}
                    onToggleModelsOpen={handleToggleModelsOpen}
                    diagnostics={diagnostics}
                    onUpdate={update}
                />
            ) : null}
        </div>
    );
};
