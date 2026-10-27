"use client";

import React from "react";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { commands } from "@/lib/backend";
import { notify } from "@/features/notifications";
import { getSettings, updateSettingSection, areSecretsVaulted } from "@/lib/settings";
import {
    SettingRow,
    SettingSelect,
    SettingSwitch,
    SETTING_CONTROL_BTN,
} from "../../shared/controls";
import {
    providerPreset,
    modelIdsFor,
    chatModelIdsFor,
    visibleModelIdsFor,
    isConnectionUsable,
    keyFormatWarning,
    providerHeaders as mergedProviderHeaders,
    providerAuthStyle as mergedProviderAuthStyle,
    providersForModelNames,
    usableProvidersForModelNames,
    withModelVisibility,
    withRefreshedModels,
    enrichDiscovered,
    formatHeaderLines,
    parseHeaderLines,
    canonicalProviderId,
} from "@/lib/ai/providers";
import type { AuthStyle, ProviderId, ProvidersSettings } from "@/lib/ai/providers";
import { formatModelPricing, getModelMetadata } from "@/lib/ai/model-catalog";
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

function wireLabel(kind: "openai" | "anthropic" | "google") {
    if (kind === "anthropic") return "Anthropic Messages API";
    if (kind === "google") return "Google Generative Language API";
    return "OpenAI-compatible API";
}

function groupLabel(group: string) {
    if (group === "Local") return "Local";
    if (group === "Gateways") return "Gateway";
    if (group === "Native APIs") return "Native";
    return "Cloud";
}

type ProviderDiagnosticReport = {
    ok: boolean;
    status: number;
    message: string;
    models: string[];
    latencyMs: number;
};

/** Validates runtime diagnostics payloads so null/malformed bridge replies never throw. */
const isValidProviderReport = (value: unknown): value is ProviderDiagnosticReport =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as { ok?: unknown }).ok === "boolean";

export function ProviderCard({
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
}) {
    const preset = providerPreset(id);
    const connection = providers.connections[id];
    const usable = isConnectionUsable(id, providers.connections);
    const hasKey = connection.apiKey.trim().length > 0;
    const hasBaseUrl = connection.baseUrl.trim().length > 0;

    // If the card starts out unexpanded but is already usable (key present),
    // expand it by default — auto-expansion is derived from initial props,
    // not a cascading effect.
    const initiallyExpanded =
        defaultExpanded || (usable && hasKey) || Boolean(connection.authStyle) ||
        Object.keys(connection.headers ?? {}).length > 0;
    const [expanded, setExpanded] = React.useState(initiallyExpanded);
    const [testing, setTesting] = React.useState(false);
    const [testResult, setTestResult] = React.useState<{
        ok: boolean;
        message: string;
        models: string[];
        latencyMs?: number;
    } | null>(null);
    const [checking, setChecking] = React.useState(false);
    const [checkResult, setCheckResult] = React.useState<{
        ok: boolean;
        message: string;
        latencyMs?: number;
    } | null>(null);
    const [modelsOpen, setModelsOpen] = React.useState(false);
    const [advancedOpen, setAdvancedOpen] = React.useState(
        Object.keys(connection.headers ?? {}).length > 0 || Boolean(connection.authStyle),
    );
    const [extraModelInput, setExtraModelInput] = React.useState("");

    const update = React.useCallback(
        (patch: Partial<typeof connection>) => {
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

    const status = connectionStatusStyle({
        enabled: connection.enabled,
        hasKey,
        keyless: Boolean(preset.keyless),
        needsBaseUrl: preset.needsBaseUrl,
        hasBaseUrl,
        lastError:
            testResult && !testResult.ok
                ? testResult.message
                : checkResult && !checkResult.ok
                  ? checkResult.message
                  : null,
    });

    const visibleModels = visibleModelIdsFor(id, providers.connections);
    const allModels = modelIdsFor(id, providers.connections);
    const chatModels = chatModelIdsFor(id, providers.connections);
    const hiddenCount = chatModels.length - visibleModels.length;

    // Deep-search: does the query match any model id/name in this provider?
    // Checks slug, preset name, discovered (provider-reported) name, and the
    // catalog metadata name so searches like "sonnet", "128k", "reasoning"
    // all match.
    const needle = query.trim().toLowerCase();
    const modelNameForSearch = React.useCallback((mid: string) => {
        const slug = mid.slice(mid.indexOf("/") + 1).toLowerCase();
        const known = preset.models.find((m) => m.id === mid);
        const discovered = connection.discoveredModels.find((m) => m.id === mid);
        const catalogMeta = getModelMetadata(mid, id);
        const parts = [slug];
        if (known?.name) parts.push(known.name.toLowerCase());
        if (discovered?.name) parts.push(discovered.name.toLowerCase());
        if (catalogMeta.source !== "inferred" && catalogMeta.name) parts.push(catalogMeta.name.toLowerCase());
        if (catalogMeta.contextWindowLabel) parts.push(catalogMeta.contextWindowLabel.toLowerCase());
        if (catalogMeta.reasoning) parts.push("reasoning");
        if (catalogMeta.vision) parts.push("vision");
        return parts.join(" ");
    }, [preset.models, connection.discoveredModels, id]);
    const modelMatches = React.useMemo(() => {
        if (!needle) return new Set<string>();
        const matches = new Set<string>();
        for (const mid of allModels) {
            if (modelNameForSearch(mid).includes(needle)) matches.add(mid);
        }
        return matches;
    }, [needle, allModels, modelNameForSearch]);

    const lastRefreshedAt = React.useMemo(() => {
        const ts = connection.discoveredModels
            .map((m) => m.discoveredAt ?? 0)
            .reduce((a, b) => Math.max(a, b), 0);
        return ts || 0;
    }, [connection.discoveredModels]);
    // Per-minute tick so the "fetched Xm ago" label stays fresh. We reset the
    // baseline whenever the discovery timestamp changes (e.g. right after a
    // Test/Refresh) so the user immediately sees "fetched just now" rather
    // than waiting up to a minute. This is a one-way sync (prop → state)
    // with no further state reads, so cascading renders are bounded.
    const [now, setNow] = React.useState(() => Date.now());
    React.useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setNow(Date.now());
        if (!lastRefreshedAt) return;
        const id = window.setInterval(() => setNow(Date.now()), 60_000);
        return () => window.clearInterval(id);
    }, [lastRefreshedAt]);
    const ageSeconds = lastRefreshedAt ? Math.max(0, Math.floor((now - lastRefreshedAt) / 1000)) : 0;
    const refreshLabel = React.useMemo(() => {
        if (!lastRefreshedAt) return "";
        const diff = ageSeconds * 1000;
        if (diff < 60_000) return "fetched just now";
        if (diff < 3600_000) return `fetched ${Math.floor(diff / 60_000)}m ago`;
        if (diff < 86_400_000) return `fetched ${Math.floor(diff / 3600_000)}h ago`;
        return `fetched ${new Date(lastRefreshedAt).toLocaleDateString()}`;
    }, [lastRefreshedAt, ageSeconds]);
    const hasModelMatches = modelMatches.size > 0;
    const queryAutoExpandedRef = React.useRef(false);
    React.useLayoutEffect(() => {
        if (!hasModelMatches) {
            queryAutoExpandedRef.current = false;
            return;
        }
        if (queryAutoExpandedRef.current) return;
        setModelsOpen(true);
        setExpanded(true);
        queryAutoExpandedRef.current = true;
    }, [hasModelMatches]);

    const checkModel =
        visibleModels[0] ??
        (providers.chatMode !== "auto" && providers.chatMode !== "ask" && providers.chatMode.startsWith(`${id}/`)
            ? providers.chatMode
            : "");

    const validateDiagnosticsInput = (mode: "test" | "check"): string | null => {
        const effectiveBaseUrl = (connection.baseUrl || preset.baseUrl || "").trim();
        if (preset.needsBaseUrl && !effectiveBaseUrl) {
            return `Enter a base URL for ${preset.label} before ${mode === "test" ? "testing the connection" : "checking chat"}.`;
        }
        const authStyle = mergedProviderAuthStyle(id, connection);
        if (!preset.keyless && authStyle !== "none" && !connection.apiKey.trim()) {
            return `Enter an API key for ${preset.label} before ${mode === "test" ? "testing the connection" : "checking chat"}.`;
        }
        if (mode === "check" && !checkModel.trim()) {
            return `Add or import a model ID for ${preset.label} before checking chat.`;
        }
        return null;
    };

    const testConnection = async () => {
        setTestResult(null);
        const validationError = validateDiagnosticsInput("test");
        if (validationError) {
            setTestResult({ ok: false, message: validationError, models: [] });
            return;
        }
        setTesting(true);
        // Snapshot inputs at start so we don't resend mid-edit keystrokes, but
        // read the connection from the latest settings at completion time so
        // edits made during the probe are not overwritten by a stale closure.
        // Snapshot inputs at the start of the call so we don't resend mid-edit
        // keystrokes during the await. The `providers` value in this closure
        // may be stale by the time the probe returns, so read settings again
        // through getSettings() before persisting; updateSettingSection merges
        // against currentSettings, but we build the patch from the latest
        // connection object so user edits during the flight are preserved.

        const key = connection.apiKey;
        const url = connection.baseUrl || preset.baseUrl;
        try {
            const rawReport: unknown = await commands.aiTestProvider(id, preset.kind, key, url, {
                headers: mergedProviderHeaders(id, connection),
                authStyle: mergedProviderAuthStyle(id, connection),
            });
            if (!isValidProviderReport(rawReport)) {
                throw new Error(
                    `Could not reach ${preset.label} diagnostics. Verify your API key and base URL, then try again.`,
                );
            }
            const report = rawReport;
            setTestResult({
                ok: report.ok,
                message: report.message,
                models: Array.isArray(report.models) ? report.models : [],
                latencyMs: report.latencyMs,
            });
            if (report.ok) {
                const latest = getSettings().ai.providers.connections[id] ?? connection;
                update(withRefreshedModels(latest, report.models, id));
                notify.success("Connection verified", `${preset.label} responded in ${report.latencyMs} ms — ${report.models.length} model${report.models.length === 1 ? "" : "s"} found.`);
            } else {
                notify.error("Connection failed", report.message);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setTestResult({ ok: false, message, models: [] });
            notify.error("Connection failed", message);
        } finally {
            setTesting(false);
        }
    };

    const refreshModels = async () => {
        // "Refresh models" is just the test call again — we already persist
        // discovered ids on success.
        await testConnection();
    };

    const checkConnection = async () => {
        setCheckResult(null);
        const validationError = validateDiagnosticsInput("check");
        if (validationError) {
            setCheckResult({ ok: false, message: validationError });
            return;
        }
        if (!checkModel) return;
        setChecking(true);
        try {
            const rawReport: unknown = await commands.aiCheckProvider(id, {
                kind: preset.kind,
                apiKey: connection.apiKey,
                baseUrl: connection.baseUrl || preset.baseUrl,
                model: checkModel,
                headers: mergedProviderHeaders(id, connection),
                authStyle: mergedProviderAuthStyle(id, connection),
            });
            if (!isValidProviderReport(rawReport)) {
                throw new Error(
                    `Could not complete chat check for ${preset.label}. Verify your API key and model selection, then try again.`,
                );
            }
            const report = rawReport;
            setCheckResult({
                ok: report.ok,
                message: report.message,
                latencyMs: report.latencyMs,
            });
            if (report.ok) {
                notify.success("Chat works", `${checkModel.split("/").slice(1).join("/")} replied in ${report.latencyMs} ms.`);
            } else {
                notify.error("Chat check failed", report.message);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setCheckResult({ ok: false, message });
            notify.error("Chat check failed", message);
        } finally {
            setChecking(false);
        }
    };

    const importModels = () => {
        if (!testResult || testResult.models.length === 0) return;
        const discovered = enrichDiscovered(id, testResult.models);
        const chatModels = discovered.filter((m) => !m.nonChat);
        // Pick a sensible default: prefer a flagship/reasoning model if one
        // exists, else the first chat model.
        const flagship = chatModels.find((m) => /opus|sonnet|gpt-[456]|gemini-(2\.[5-9]|[3-9])|deepseek-v|kimi|claude-[4-9]/i.test(m.id));
        const defaultId = flagship?.id ?? chatModels[0]?.id ?? "";
        const pinnedIds = discovered.map((m) => m.id);
        const nextChatMode = providers.chatMode === "auto" && defaultId ? defaultId : providers.chatMode;
        const updated = withRefreshedModels({ ...connection, models: pinnedIds }, testResult.models, id);
        updateSettingSection("ai", {
            providers: {
                ...providers,
                chatMode: nextChatMode,
                connections: { ...providers.connections, [id]: updated },
            },
        });
        notify.success(
            `${chatModels.length} chat model${chatModels.length === 1 ? "" : "s"} ready`,
            defaultId && nextChatMode === defaultId
                ? `Default set to ${defaultId.split("/").slice(1).join("/")}.`
                : `${preset.label} reported ${discovered.length} model${discovered.length === 1 ? "" : "s"}.`,
        );
    };

    const toggleModelVisible = (modelId: string, visible: boolean) => {
        update(withModelVisibility(connection, modelId, visible));
    };

    const enableMatchedProviders = () => {
        if (connection.extraModels.length === 0) return;
        // Match any provider whose catalog contains the extra model ids — even
        // if that provider is still unkeyed, we want its card to flip on so
        // the user sees where to paste the key.
        const matched = providersForModelNames(connection.extraModels, providers.connections);
        if (matched.length === 0) {
            notify.info("No matching providers found", "The extra model ids don't match any known provider catalog.");
            return;
        }
        const patch = Object.fromEntries(
            matched.map((pid) => [pid, { ...providers.connections[pid], enabled: true }]),
        );
        updateSettingSection("ai", {
            providers: {
                ...providers,
                connections: { ...providers.connections, ...patch },
            },
        });
        const ready = usableProvidersForModelNames(connection.extraModels, providers.connections).length;
        notify.success(
            `${matched.length} provider${matched.length === 1 ? "" : "s"} enabled`,
            ready > 0
                ? `${ready} already ready; add keys to the rest.`
                : "Add keys to the newly enabled cards, then Test connection.",
        );
    };

    const addExtraModel = () => {
        const raw = extraModelInput.trim();
        if (!raw) return;
        // Normalize to `${preset.id}/${slug}`. An input is already in
        // BetterShape-canonical form when:
        //   (a) it starts with this card's own id (e.g. "openai/gpt-4o" on
        //       the OpenAI card), or
        //   (b) its first segment is a *different* known provider id and
        //       it contains two or more slashes (cross-card references
        //       like "openrouter/anthropic/claude-sonnet", or HF-style
        //       multi-segment ids on a gateway that carries its own
        //       vendor/model slug).
        // A single-slash id whose first segment is a different known
        // provider (e.g. "anthropic/claude-sonnet" typed on the OpenRouter
        // card) is an *unqualified* vendor/model slug for this gateway
        // and must be prefixed with this card's id.
        // A single-slash id whose first segment is NOT a known provider
        // (e.g. "BAAI/bge-m3" on DeepInfra/vLLM/Ollama) is likewise a
        // native vendor/model slug for this connection.
        const firstSlash = raw.indexOf("/");
        const slashCount = raw.split("/").length - 1;
        const prefix = firstSlash > 0 ? raw.slice(0, firstSlash) : "";
        const isOwnPrefix = prefix === preset.id;
        const isOtherKnownAndQualified =
            firstSlash > 0 &&
            canonicalProviderId(prefix) !== null &&
            prefix !== preset.id &&
            slashCount >= 2;
        const alreadyPrefixed = isOwnPrefix || isOtherKnownAndQualified;
        const id = alreadyPrefixed ? raw : `${preset.id}/${raw}`;
        if (connection.extraModels.includes(id) || allModels.includes(id)) {
            setExtraModelInput("");
            return;
        }
        update({ extraModels: [...connection.extraModels, id] });
        setExtraModelInput("");
    };

    const effectiveBaseUrl = connection.baseUrl || preset.baseUrl;
    const canTest = connection.enabled && (hasKey || preset.keyless) && !(preset.needsBaseUrl && !hasBaseUrl);

    return (
        <div
            data-provider-id={id}
            className="overflow-hidden rounded-xl bg-settings-card squircle-[18px]"
        >
            {/* ── Header row (entire surface toggles expand) ── */}
            <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                aria-controls={`provider-${id}-body`}
                className="group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-fast hover:bg-[var(--row-hover)]"
            >
                <ProviderMonogram preset={preset} />
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-text-primary">
                        <span className="truncate">{preset.label}</span>
                        <span className="ml-1 rounded-sm bg-surface-3 px-1 py-px text-[10px] font-normal uppercase tracking-wide text-text-muted">
                            {groupLabel(preset.group)}
                        </span>
                        {hiddenCount > 0 ? (
                            <Tooltip
                                content={`${hiddenCount} model${hiddenCount === 1 ? "" : "s"} hidden from pickers`}
                                side="top"
                            >
                                <span className="inline-flex items-center gap-0.5 rounded-sm bg-surface-3 px-1 py-px text-[10px] font-normal text-text-muted">
                                    <Icon icon={Eye20Regular} className="size-2.5" />
                                    {hiddenCount} hidden
                                </span>
                            </Tooltip>
                        ) : null}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-text-muted">
                        <StatusDot style={status} />
                        <span>{status.label}</span>
                        <span className="text-text-disabled">·</span>
                        <span className="truncate">{wireLabel(preset.kind)}</span>
                    </div>
                </div>
                {/* Presentation wrapper: stops clicks inside the action cluster
                    from toggling the card's expand state. The inner buttons are
                    the actual interactive targets and each stop propagation
                    themselves, so this element is not itself interactive. */}
                <span className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()} role="none">
                    {onReset ? (
                        <Tooltip content="Reset this provider — clears key, URL, headers" side="top">
                            <Button
                                size="icon"
                                variant="ghost"
                                className="size-7 text-text-muted opacity-0 transition-opacity duration-fast group-hover:opacity-100 hover:text-error focus-visible:opacity-100"
                                aria-label={`Reset ${preset.label}`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onReset();
                                }}
                            >
                                <Icon icon={ArrowReset20Regular} className="size-3.5" />
                            </Button>
                        </Tooltip>
                    ) : null}
                    {preset.docsUrl ? (
                        <Tooltip content="Get a key" side="top">
                            <Button
                                size="icon"
                                variant="ghost"
                                className="size-7 text-text-muted opacity-0 transition-opacity duration-fast group-hover:opacity-100 hover:text-text-primary focus-visible:opacity-100"
                                aria-label={`Get a ${preset.label} key`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    void commands.openUrlExternal(preset.docsUrl!);
                                }}
                            >
                                <Icon icon={Link20Regular} className="size-3.5" />
                            </Button>
                        </Tooltip>
                    ) : null}
                    <SettingSwitch
                        checked={connection.enabled}
                        onChange={(enabled) => update({ enabled })}
                    />
                    <Icon
                        icon={expanded ? ChevronDown20Regular : ChevronRight20Regular}
                        className="size-3.5 text-text-muted transition-transform duration-fast"
                    />
                </span>
            </button>

            {/* ── Body ── */}
            {expanded ? (
                <div id={`provider-${id}-body`} className="border-t border-border-subtle px-4 pb-4 pt-3">
                    {preset.note ? (
                        <div className="mb-2.5 flex items-start gap-1.5 text-xs leading-4 text-text-muted">
                            <Icon icon={Info20Regular} className="mt-px size-3.5 shrink-0 text-text-disabled" />
                            <span>{preset.note}</span>
                        </div>
                    ) : null}

                    {/* Key + base URL */}
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                        <KeyInput
                            value={connection.apiKey}
                            placeholder={preset.keyHint || "API key"}
                            onChange={(apiKey) => update({ apiKey })}
                            warning={keyFormatWarning(id, connection.apiKey)}
                            savedInVault={areSecretsVaulted() && !connection.apiKey && usable}
                        />
                        {preset.needsBaseUrl || connection.baseUrl ? (
                            <TextInput
                                value={connection.baseUrl}
                                placeholder={preset.baseUrl || "https://host/v1"}
                                onChange={(baseUrl) => update({ baseUrl })}
                                onReset={() => update({ baseUrl: "" })}
                                defaultValue={preset.baseUrl}
                                mono
                            />
                        ) : (
                            <div className="flex h-8 items-center gap-1.5 rounded-md border border-border-secondary bg-surface-2/50 px-2 text-xs text-text-muted">
                                <Icon icon={Globe20Regular} className="size-3.5 shrink-0 text-text-disabled" />
                                <span className="truncate font-mono text-[11px]">{preset.baseUrl}</span>
                            </div>
                        )}
                    </div>

                    {/* Action row */}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Tooltip
                            content={
                                canTest
                                    ? "Verify the key and base URL against the provider"
                                    : !connection.enabled
                                      ? "Turn the provider on first"
                                      : preset.needsBaseUrl && !hasBaseUrl
                                        ? "Enter a base URL first"
                                        : !hasKey && !preset.keyless
                                          ? "Add an API key first"
                                          : "Nothing to test"
                            }
                            side="top"
                        >
                            <span>
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    className={SETTING_CONTROL_BTN}
                                    loading={testing}
                                    disabled={!canTest || testing}
                                    onClick={() => void testConnection()}
                                >
                                    <Icon icon={PlugConnected20Regular} className="size-3.5" />
                                    {testing ? "Testing…" : "Test connection"}
                                </Button>
                            </span>
                        </Tooltip>

                        <Tooltip
                            content={
                                checkModel
                                    ? `Sends one short completion with ${checkModel.split("/").slice(1).join("/")}`
                                    : visibleModels.length === 0
                                      ? "No visible models — import or add a model id first"
                                      : "Add or import a model first"
                            }
                            side="top"
                        >
                            <span>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className={SETTING_CONTROL_BTN}
                                    loading={checking}
                                    disabled={checking || !checkModel}
                                    onClick={() => void checkConnection()}
                                >
                                    <Icon icon={Airplane20Regular} className="size-3.5" />
                                    {checking ? "Checking…" : "Check chat"}
                                </Button>
                            </span>
                        </Tooltip>

                        {canTest ? (
                            <Tooltip content="Refetch the model list from the provider and refresh metadata" side="top">
                                <span>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className={SETTING_CONTROL_BTN}
                                        loading={testing}
                                        disabled={testing || !canTest}
                                        onClick={() => void refreshModels()}
                                    >
                                        <Icon icon={ArrowReset20Regular} className="size-3.5" />
                                        Refresh models
                                    </Button>
                                </span>
                            </Tooltip>
                        ) : null}

                        {testResult?.ok && testResult.models.length > 0 ? (
                            <Button
                                size="sm"
                                variant="ghost"
                                className={SETTING_CONTROL_BTN}
                                disabled={testing}
                                onClick={importModels}
                            >
                                <Icon icon={Database20Regular} className="size-3.5" />
                                Pin {testResult.models.length} & set default
                            </Button>
                        ) : null}

                        {testResult ? (
                            <StatusMessage ok={testResult.ok} message={testResult.message} latencyMs={testResult.latencyMs} />
                        ) : null}
                    </div>
                    {checkResult && !testResult ? (
                        <div className="mt-2">
                            <StatusMessage ok={checkResult.ok} message={checkResult.message} latencyMs={checkResult.latencyMs} />
                        </div>
                    ) : null}

                    {/* Models collapsible */}
                    {allModels.length > 0 || preset.models.length === 0 ? (
                        <div className="mt-3">
                            <DisclosureHeader
                                open={modelsOpen}
                                onToggle={() => setModelsOpen((v) => !v)}
                                icon={Code20Regular}
                                label={
                                    chatModels.length === 0
                                        ? "Models"
                                        : `${visibleModels.length} of ${chatModels.length} chat model${chatModels.length === 1 ? "" : "s"}`
                                }
                                hint={
                                    [
                                        hiddenCount > 0 ? `${hiddenCount} hidden` : "",
                                        refreshLabel,
                                    ].filter(Boolean).join(" · ") || undefined
                                }
                            />
                            {modelsOpen ? (
                                <div className="mt-2 space-y-1">
                                    {chatModels.map((modelId) => (
                                        <ModelRow
                                            key={modelId}
                                            modelId={modelId}
                                            visible={!connection.hiddenModels.includes(modelId)}
                                            onToggleVisible={(v) => toggleModelVisible(modelId, v)}
                                            providerLabel={preset.label}
                                            providerId={id}
                                            match={needle ? modelMatches.has(modelId) : false}
                                        />
                                    ))}
                                    {/* Extra model add row (for providers without a preset list, or for any provider when user wants to pin one) */}
                                    {preset.id === "custom" || preset.models.length === 0 ? (
                                        <div className="flex items-center gap-1.5 pt-1">
                                            <input
                                                type="text"
                                                value={extraModelInput}
                                                placeholder="Add model id (e.g. llama3.1)"
                                                spellCheck={false}
                                                onChange={(e) => setExtraModelInput(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter") addExtraModel();
                                                }}
                                                className="h-7 min-w-0 flex-1 rounded-md border border-border-secondary bg-transparent px-2 font-mono text-xs text-text-primary outline-none focus:border-accent"
                                            />
                                            <Button
                                                size="xs"
                                                variant="ghost"
                                                className="h-7 gap-1 text-text-muted"
                                                onClick={addExtraModel}
                                                disabled={!extraModelInput.trim()}
                                            >
                                                <Icon icon={Add20Regular} className="size-3" />
                                                Add
                                            </Button>
                                        </div>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                    ) : null}

                    {/* Advanced (headers/auth) collapsible */}
                    <div className="mt-3">
                        <DisclosureHeader
                            open={advancedOpen}
                            onToggle={() => setAdvancedOpen((v) => !v)}
                            icon={Settings20Regular}
                            label="Request headers & auth"
                        />
                        {advancedOpen ? (
                            <div className="mt-2 space-y-px">
                                <SettingRow
                                    title="Auth header"
                                    description="Where the key is sent. Leave on the default unless the endpoint expects otherwise."
                                >
                                    <SettingSelect
                                        value={connection.authStyle}
                                        onChange={(value) =>
                                            update({ authStyle: value as AuthStyle | "" })
                                        }
                                        options={[
                                            {
                                                value: "",
                                                label: `Default (${mergedProviderAuthStyle(id, connection)})`,
                                            },
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
                                        onChange={(e) =>
                                            update({ headers: parseHeaderLines(e.target.value) })
                                        }
                                        className="w-full rounded-md border border-border-secondary bg-transparent px-2 py-1.5 font-mono text-xs text-text-primary outline-none focus:border-accent"
                                    />
                                </SettingRow>
                                {Object.entries(preset.headers ?? {}).length > 0 ? (
                                    <div className="mt-1 flex items-start gap-1.5 px-3.5 text-xs leading-4 text-text-muted">
                                        <Icon icon={Info20Regular} className="mt-px size-3.5 shrink-0 text-text-disabled" />
                                        <span>
                                            {preset.label} always sends{" "}
                                            {Object.entries(preset.headers ?? {})
                                                .map(([name, value]) => `${name}: ${value}`)
                                                .join(", ")}
                                            . Your lines above win on conflicts.
                                        </span>
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                    </div>

                    {/* Enable-other-providers helper on custom-like providers */}
                    {preset.models.length === 0 && connection.extraModels.length > 0 ? (
                        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-border-subtle bg-surface-2/40 px-3 py-2">
                            <Button
                                size="xs"
                                variant="ghost"
                                className="h-7 gap-1 text-text-secondary"
                                onClick={enableMatchedProviders}
                            >
                                <Icon icon={Cloud20Regular} className="size-3.5" />
                                Enable providers these models belong to
                            </Button>
                            <span className="text-xs text-text-muted">
                                Turns on matching providers so you can paste keys for them.
                            </span>
                        </div>
                    ) : null}

                    {/* Effective endpoint line */}
                    {connection.enabled && (hasKey || preset.keyless) ? (
                        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-text-disabled">
                            <Icon icon={Globe20Regular} className="size-3" />
                            <span className="truncate font-mono">{effectiveBaseUrl || "—"}</span>
                        </div>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

/* ── Internal subcomponents ──────────────────────────────────────────────── */

function StatusMessage({
    ok,
    message,
    latencyMs,
}: {
    ok: boolean;
    message: string;
    latencyMs?: number;
}) {
    return (
        <span
            role={ok ? "status" : "alert"}
            className={cn(
                "inline-flex items-center gap-1 text-xs leading-4",
                ok ? "text-text-muted" : "text-error whitespace-pre-line",
            )}
        >
            <Icon
                icon={ok ? Checkmark20Regular : ErrorCircle20Regular}
                className={cn("size-3.5 shrink-0", ok ? "text-success" : "text-error")}
            />
            {message}
            {ok && latencyMs ? <span className="text-text-disabled">· {latencyMs} ms</span> : null}
        </span>
    );
}

function DisclosureHeader({
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
}) {
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="flex w-full items-center gap-1.5 self-start text-xs font-normal text-text-muted transition-colors duration-fast hover:text-text-primary"
        >
            <Icon icon={open ? ChevronDown20Regular : ChevronRight20Regular} className="size-3" />
            <Icon icon={Glyph} className="size-3.5" />
            <span>{label}</span>
            {hint ? <span className="text-text-disabled">· {hint}</span> : null}
        </button>
    );
}

function ModelRow({
    modelId,
    visible,
    onToggleVisible,
    providerLabel,
    providerId,
    match,
}: {
    modelId: string;
    visible: boolean;
    onToggleVisible: (v: boolean) => void;
    providerLabel: string;
    providerId: ProviderId;
    match?: boolean;
}) {
    const [copied, setCopied] = React.useState(false);
    const slug = modelId.split("/").slice(1).join("/");
    const meta = React.useMemo(() => getModelMetadata(modelId, providerId), [modelId, providerId]);
    const displayName = meta?.name && meta.name !== slug ? meta.name : slug;
    const ctxLabel = meta?.contextWindowLabel ?? "";
    const badges: { label: string; tone?: "warn" | "accent" }[] = [];
    if (meta?.deprecated) badges.push({ label: "deprecated", tone: "warn" });
    if (meta?.reasoning) badges.push({ label: "reasoning" });
    if (meta?.vision) badges.push({ label: "vision" });
    if (meta?.toolUse && !meta?.nonChat) badges.push({ label: "tools" });
    const priceLabel = meta && (meta.inputCostPerM !== null || meta.outputCostPerM !== null)
        ? formatModelPricing(meta)
        : "";
    const copy = async () => {
        try {
            await navigator.clipboard?.writeText(modelId);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
        } catch {
            /* swallow */
        }
    };
    return (
        <div
            className={cn(
                "group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors duration-fast",
                visible ? "hover:bg-[var(--row-hover)]" : "opacity-60",
                match && "bg-accent/10 ring-1 ring-accent/30",
            )}
        >
            <button
                type="button"
                role="switch"
                aria-checked={visible}
                aria-label={visible ? `Hide ${slug} from pickers` : `Show ${slug} in pickers`}
                onClick={() => onToggleVisible(!visible)}
                className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded border transition-colors duration-fast",
                    visible
                        ? "border-accent/60 bg-accent/15 text-accent-text"
                        : "border-border-secondary bg-transparent text-text-disabled hover:border-border hover:text-text-muted",
                )}
            >
                {visible ? <Icon icon={Checkmark20Regular} className="size-3" /> : <Icon icon={Eye20Regular} className="size-3" />}
            </button>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-medium text-text-primary">{displayName}</span>
                    {ctxLabel ? <span className="shrink-0 rounded bg-surface-3 px-1 py-px text-[10px] font-medium text-text-muted">{ctxLabel}</span> : null}
                    {priceLabel ? <span className="shrink-0 text-[10px] text-text-disabled">{priceLabel}</span> : null}
                    {badges.map((b) => (
                        <span key={b.label} className={cn(
                            "shrink-0 rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide",
                            b.tone === "warn"
                                ? "bg-warning/15 text-warning"
                                : "bg-accent/10 text-accent-text",
                        )}>{b.label}</span>
                    ))}
                </div>
                <div className="truncate text-[11px] text-text-disabled">
                    {providerLabel}
                    {meta?.source === "catalog" ? " · catalog" : meta?.source === "discovered" ? " · from provider" : null}
                    {slug !== displayName ? ` · ${slug}` : ""}
                </div>
            </div>
            <Tooltip content={copied ? "Copied model id" : "Copy model id"} side="left">
                <Button
                    size="icon"
                    variant="ghost"
                    className="size-6 text-text-disabled opacity-0 transition-opacity duration-fast hover:text-text-secondary focus-visible:opacity-100 group-hover:opacity-100"
                    aria-label="Copy model id"
                    onClick={() => void copy()}
                >
                    <Icon icon={copied ? Checkmark20Regular : Copy20Regular} className="size-3" />
                </Button>
            </Tooltip>
        </div>
    );
}
