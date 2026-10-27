import { commands } from "@/lib/backend";
import { notify } from "@/features/notifications";
import { getSettings, updateSettingSection } from "@/lib/settings";
import {
    canonicalProviderId,
    enrichDiscovered,
    providerAuthStyle as mergedProviderAuthStyle,
    providerHeaders as mergedProviderHeaders,
    providersForModelNames,
    usableProvidersForModelNames,
    withRefreshedModels,
} from "@/lib/ai/providers";
import type {
    ProviderConnection,
    ProviderId,
    ProviderPreset,
    ProvidersSettings,
} from "@/lib/ai/providers";
import { formatModelPricing, getModelMetadata } from "@/lib/ai/model-catalog";

export type ProviderDiagnosticReport = {
    ok: boolean;
    status: number;
    message: string;
    models: string[];
    latencyMs: number;
};

export type TestProbeResult = {
    ok: boolean;
    message: string;
    models: string[];
    latencyMs?: number;
};

export type CheckProbeResult = {
    ok: boolean;
    message: string;
    latencyMs?: number;
};

export type ModelBadge = {
    label: string;
    tone?: "warn" | "accent";
};

const WIRE_LABELS: Record<"openai" | "anthropic" | "google", string> = {
    anthropic: "Anthropic Messages API",
    google: "Google Generative Language API",
    openai: "OpenAI-compatible API",
};

const GROUP_LABELS: Record<string, string> = {
    Local: "Local",
    Gateways: "Gateway",
    "Native APIs": "Native",
};

const FLAGSHIP_MODEL_RE =
    /opus|sonnet|gpt-[456]|gemini-(2\.[5-9]|[3-9])|deepseek-v|kimi|claude-[4-9]/i;

/** Formats the protocol wire label shown beneath a provider card title. */
export const wireLabel = (kind: "openai" | "anthropic" | "google"): string =>
    WIRE_LABELS[kind];

/** Formats the short badge label for a provider catalog group. */
export const groupLabel = (group: string): string =>
    GROUP_LABELS[group] ?? "Cloud";

/** Validates runtime diagnostics payloads so null/malformed bridge replies never throw. */
export const isValidProviderReport = (
    value: unknown,
): value is ProviderDiagnosticReport =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as { ok?: unknown }).ok === "boolean";

/** Computes whether a provider card should start expanded on initial mount. */
export const computeInitiallyExpanded = (
    defaultExpanded: boolean,
    usableWithKey: boolean,
    connection: ProviderConnection,
): boolean => {
    if (defaultExpanded || usableWithKey) return true;
    const hasCustomAuth = Boolean(connection.authStyle);
    const hasHeaders = Object.keys(connection.headers ?? {}).length > 0;
    return hasCustomAuth || hasHeaders;
};

/** Selects the latest probe error message (if any) for status-dot styling. */
export const resolveLastProbeError = (
    testResult: TestProbeResult | null,
    checkResult: CheckProbeResult | null,
): string | null => {
    if (testResult && !testResult.ok) return testResult.message;
    if (checkResult && !checkResult.ok) return checkResult.message;
    return null;
};

/** Appends optional lowercased token `value` to `parts` when non-empty. */
const pushLowerIfPresent = (parts: string[], value: string | undefined): void => {
    if (value) parts.push(value.toLowerCase());
};

/** Appends capability search keywords from catalog metadata into `parts`. */
const pushCatalogSearchTerms = (
    parts: string[],
    mid: string,
    providerId: ProviderId,
): void => {
    const meta = getModelMetadata(mid, providerId);
    if (meta.source !== "inferred") pushLowerIfPresent(parts, meta.name);
    pushLowerIfPresent(parts, meta.contextWindowLabel);
    if (meta.reasoning) parts.push("reasoning");
    if (meta.vision) parts.push("vision");
};

/** Builds a lowercased search hay string for matching a model against `query`. */
export const buildModelSearchHay = (
    mid: string,
    providerId: ProviderId,
    preset: ProviderPreset,
    connection: ProviderConnection,
): string => {
    const slug = mid.slice(mid.indexOf("/") + 1).toLowerCase();
    const parts = [slug];
    /** Checks whether a model entry matches `mid`. */
    const matchesModelId = (entry: { id: string }): boolean => entry.id === mid;
    pushLowerIfPresent(parts, preset.models.find(matchesModelId)?.name);
    pushLowerIfPresent(
        parts,
        connection.discoveredModels.find(matchesModelId)?.name,
    );
    pushCatalogSearchTerms(parts, mid, providerId);
    return parts.join(" ");
};

/** Collects model IDs from `allModels` whose search text contains `needle`. */
export const collectMatchingModels = (
    needle: string,
    allModels: string[],
    matchFn: (mid: string) => string,
): Set<string> => {
    const matches = new Set<string>();
    if (!needle) return matches;
    for (const mid of allModels) {
        if (matchFn(mid).includes(needle)) matches.add(mid);
    }
    return matches;
};

/** Finds the latest `discoveredAt` timestamp across discovered models. */
export const findLatestDiscoveryTimestamp = (
    discoveredModels: ProviderConnection["discoveredModels"],
): number => {
    let latest = 0;
    for (const model of discoveredModels) {
        const ts = model.discoveredAt ?? 0;
        if (ts > latest) latest = ts;
    }
    return latest;
};

/** Formats the relative `"fetched X ago"` hint from `lastRefreshedAt` and `ageSeconds`. */
export const formatRefreshAgeLabel = (
    lastRefreshedAt: number,
    ageSeconds: number,
): string => {
    if (!lastRefreshedAt) return "";
    const diff = ageSeconds * 1000;
    if (diff < 60_000) return "fetched just now";
    if (diff < 3_600_000) return `fetched ${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `fetched ${Math.floor(diff / 3_600_000)}h ago`;
    return `fetched ${new Date(lastRefreshedAt).toLocaleDateString()}`;
};

/** Resolves the model ID to probe when clicking `Check chat` on a provider card. */
export const resolveCheckModelId = (
    id: ProviderId,
    visibleModels: string[],
    chatMode: ProvidersSettings["chatMode"],
): string => {
    if (visibleModels[0]) return visibleModels[0];
    const isPinnedModel = chatMode !== "auto" && chatMode !== "ask";
    return isPinnedModel && chatMode.startsWith(`${id}/`) ? chatMode : "";
};

/** Formats the action phrase used in diagnostic validation messages. */
const describeProbeAction = (mode: "test" | "check"): string =>
    mode === "test" ? "testing the connection" : "checking chat";

/** Checks whether a provider connection requires a non-empty API key for probes. */
const requiresDiagnosticApiKey = (
    id: ProviderId,
    preset: ProviderPreset,
    connection: ProviderConnection,
): boolean => {
    if (preset.keyless) return false;
    const authStyle = mergedProviderAuthStyle(id, connection);
    return authStyle !== "none" && !connection.apiKey.trim();
};

/** Resolves the effective trimmed base URL for `preset` and `connection`. */
const resolveTrimmedBaseUrl = (
    preset: ProviderPreset,
    connection: ProviderConnection,
): string => (connection.baseUrl || preset.baseUrl || "").trim();

/** Checks whether a `Check chat` probe lacks a target model ID. */
const isMissingCheckModel = (
    mode: "test" | "check",
    checkModel: string,
): boolean => mode === "check" && !checkModel.trim();

/** Validates base URL, API key, and target model before dispatching a diagnostic probe. */
export const validateProviderDiagnostics = (
    mode: "test" | "check",
    id: ProviderId,
    preset: ProviderPreset,
    connection: ProviderConnection,
    checkModel: string,
): string | null => {
    if (preset.needsBaseUrl && !resolveTrimmedBaseUrl(preset, connection)) {
        return `Enter a base URL for ${preset.label} before ${describeProbeAction(mode)}.`;
    }
    if (requiresDiagnosticApiKey(id, preset, connection)) {
        return `Enter an API key for ${preset.label} before ${describeProbeAction(mode)}.`;
    }
    return isMissingCheckModel(mode, checkModel)
        ? `Add or import a model ID for ${preset.label} before checking chat.`
        : null;
};

/** Extracts an error message string from an unknown thrown value. */
export const toErrorText = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

/** Strips the leading `${providerId}/` prefix from a canonical model ID. */
export const stripProviderPrefix = (modelId: string): string =>
    modelId.split("/").slice(1).join("/");

/** Persists discovered models and notifies the user after a `Test connection` probe. */
const handleTestProbeReport = (
    id: ProviderId,
    preset: ProviderPreset,
    fallbackConnection: ProviderConnection,
    report: ProviderDiagnosticReport,
    update: (patch: Partial<ProviderConnection>) => void,
): void => {
    if (!report.ok) {
        notify.error("Connection failed", report.message);
        return;
    }
    const latest =
        getSettings().ai.providers.connections[id] ?? fallbackConnection;
    update(withRefreshedModels(latest, report.models, id));
    const noun = report.models.length === 1 ? "model" : "models";
    notify.success(
        "Connection verified",
        `${preset.label} responded in ${report.latencyMs} ms - ${report.models.length} ${noun} found.`,
    );
};

/** Executes `commands.aiTestProvider` and returns the normalized `TestProbeResult`. */
export const executeTestConnectionProbe = async (
    id: ProviderId,
    preset: ProviderPreset,
    connection: ProviderConnection,
    update: (patch: Partial<ProviderConnection>) => void,
): Promise<TestProbeResult> => {
    try {
        const url = connection.baseUrl || preset.baseUrl;
        const rawReport: unknown = await commands.aiTestProvider(
            id,
            preset.kind,
            connection.apiKey,
            url,
            {
                headers: mergedProviderHeaders(id, connection),
                authStyle: mergedProviderAuthStyle(id, connection),
            },
        );
        if (!isValidProviderReport(rawReport)) {
            throw new Error(
                `Could not reach ${preset.label} diagnostics. Verify your API key and base URL, then try again.`,
            );
        }
        handleTestProbeReport(id, preset, connection, rawReport, update);
        return {
            ok: rawReport.ok,
            message: rawReport.message,
            models: Array.isArray(rawReport.models) ? rawReport.models : [],
            latencyMs: rawReport.latencyMs,
        };
    } catch (error) {
        const message = toErrorText(error);
        notify.error("Connection failed", message);
        return { ok: false, message, models: [] };
    }
};

/** Dispatches a success or failure toast for a `Check chat` probe report. */
const notifyCheckProbeReport = (
    checkModel: string,
    report: ProviderDiagnosticReport,
): void => {
    if (report.ok) {
        notify.success(
            "Chat works",
            `${stripProviderPrefix(checkModel)} replied in ${report.latencyMs} ms.`,
        );
    } else {
        notify.error("Chat check failed", report.message);
    }
};

/** Executes `commands.aiCheckProvider` and returns the normalized `CheckProbeResult`. */
export const executeCheckChatProbe = async (
    id: ProviderId,
    preset: ProviderPreset,
    connection: ProviderConnection,
    checkModel: string,
): Promise<CheckProbeResult> => {
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
        notifyCheckProbeReport(checkModel, rawReport);
        return {
            ok: rawReport.ok,
            message: rawReport.message,
            latencyMs: rawReport.latencyMs,
        };
    } catch (error) {
        const message = toErrorText(error);
        notify.error("Chat check failed", message);
        return { ok: false, message };
    }
};

/** Selects a flagship or first chat model ID from newly discovered models. */
const pickDefaultDiscoveredChatModel = (
    chatModels: Array<{ id: string }>,
): string => {
    /** Checks whether `model` matches the flagship model pattern. */
    const isFlagship = (model: { id: string }): boolean =>
        FLAGSHIP_MODEL_RE.test(model.id);
    return chatModels.find(isFlagship)?.id ?? chatModels[0]?.id ?? "";
};

/** Formats the toast body shown after pinning discovered models onto a provider. */
const formatImportedModelsDetail = (
    presetLabel: string,
    discoveredCount: number,
    defaultId: string,
    nextChatMode: ProvidersSettings["chatMode"],
): string => {
    if (defaultId && nextChatMode === defaultId) {
        return `Default set to ${stripProviderPrefix(defaultId)}.`;
    }
    const noun = discoveredCount === 1 ? "model" : "models";
    return `${presetLabel} reported ${discoveredCount} ${noun}.`;
};

/** Pins discovered models from `testModels` onto `id` and updates settings. */
export const applyImportedModels = (
    id: ProviderId,
    preset: ProviderPreset,
    providers: ProvidersSettings,
    connection: ProviderConnection,
    testModels: string[],
): void => {
    const discovered = enrichDiscovered(id, testModels);
    /** Filters out embedding/rerank models that cannot serve chat turns. */
    const isChatCapable = (model: { nonChat?: boolean }): boolean =>
        !model.nonChat;
    const chatModels = discovered.filter(isChatCapable);
    const defaultId = pickDefaultDiscoveredChatModel(chatModels);
    /** Extracts `id` from a discovered model entry. */
    const toId = (model: { id: string }): string => model.id;
    const pinnedIds = discovered.map(toId);
    const nextChatMode =
        providers.chatMode === "auto" && defaultId
            ? defaultId
            : providers.chatMode;
    const updated = withRefreshedModels(
        { ...connection, models: pinnedIds },
        testModels,
        id,
    );
    updateSettingSection("ai", {
        providers: {
            ...providers,
            chatMode: nextChatMode,
            connections: { ...providers.connections, [id]: updated },
        },
    });
    const chatNoun = chatModels.length === 1 ? "model" : "models";
    notify.success(
        `${chatModels.length} chat ${chatNoun} ready`,
        formatImportedModelsDetail(
            preset.label,
            discovered.length,
            defaultId,
            nextChatMode,
        ),
    );
};

/** Enables all catalog providers matching `connection.extraModels`. */
export const enableCatalogMatchedProviders = (
    providers: ProvidersSettings,
    extraModels: string[],
): void => {
    if (extraModels.length === 0) return;
    const matched = providersForModelNames(extraModels, providers.connections);
    if (matched.length === 0) {
        notify.info(
            "No matching providers found",
            "The extra model ids don't match any known provider catalog.",
        );
        return;
    }
    /** Builds an enabled connection entry tuple for `pid`. */
    const toEnabledEntry = (pid: ProviderId): [ProviderId, ProviderConnection] => [
        pid,
        { ...providers.connections[pid], enabled: true },
    ];
    const patch = Object.fromEntries(matched.map(toEnabledEntry));
    updateSettingSection("ai", {
        providers: {
            ...providers,
            connections: { ...providers.connections, ...patch },
        },
    });
    const ready = usableProvidersForModelNames(
        extraModels,
        providers.connections,
    ).length;
    const detail =
        ready > 0
            ? `${ready} already ready; add keys to the rest.`
            : "Add keys to the newly enabled cards, then Test connection.";
    notify.success(
        `${matched.length} ${matched.length === 1 ? "provider" : "providers"} enabled`,
        detail,
    );
};

/** Checks whether `raw` is already qualified with another known provider prefix (`2+` slashes). */
const isCrossProviderQualifiedId = (
    raw: string,
    presetId: ProviderId,
    firstSlash: number,
): boolean => {
    if (firstSlash <= 0) return false;
    const prefix = raw.slice(0, firstSlash);
    if (prefix === presetId || canonicalProviderId(prefix) === null) {
        return false;
    }
    return raw.split("/").length - 1 >= 2;
};

/** Canonicalizes a user-entered extra model ID for `presetId`. */
export const normalizeExtraModelId = (
    rawInput: string,
    presetId: ProviderId,
): string | null => {
    const raw = rawInput.trim();
    if (!raw) return null;
    const firstSlash = raw.indexOf("/");
    const isOwnPrefix = firstSlash > 0 && raw.slice(0, firstSlash) === presetId;
    const alreadyPrefixed =
        isOwnPrefix || isCrossProviderQualifiedId(raw, presetId, firstSlash);
    return alreadyPrefixed ? raw : `${presetId}/${raw}`;
};

/** Computes whether `Test connection` is actionable for `preset` and `connection`. */
export const canRunConnectionTest = (
    preset: ProviderPreset,
    connection: ProviderConnection,
    hasKey: boolean,
    hasBaseUrl: boolean,
): boolean => {
    if (!connection.enabled) return false;
    if (!hasKey && !preset.keyless) return false;
    return !(preset.needsBaseUrl && !hasBaseUrl);
};

/** Computes the tooltip explaining why `Test connection` is enabled or disabled. */
export const describeTestButtonTooltip = (
    canTest: boolean,
    enabled: boolean,
    needsUrl: boolean,
    needsKey: boolean,
): string => {
    if (canTest) return "Verify the key and base URL against the provider";
    if (!enabled) return "Turn the provider on first";
    if (needsUrl) return "Enter a base URL first";
    return needsKey ? "Add an API key first" : "Nothing to test";
};

/** Computes the tooltip for the `Check chat` button. */
export const describeCheckButtonTooltip = (
    checkModel: string,
    hasVisibleModels: boolean,
): string => {
    if (checkModel) {
        return `Sends one short completion with ${stripProviderPrefix(checkModel)}`;
    }
    return hasVisibleModels
        ? "Add or import a model first"
        : "No visible models - import or add a model id first";
};

/** Checks whether a model advertises chat tool-calling capability. */
const hasChatToolUse = (meta: ReturnType<typeof getModelMetadata>): boolean =>
    Boolean(meta.toolUse && !meta.nonChat);

/** Collects capability badges (`deprecated`, `reasoning`, `vision`, `tools`) for a model row. */
export const collectModelRowBadges = (
    meta: ReturnType<typeof getModelMetadata>,
): ModelBadge[] => {
    const badges: ModelBadge[] = [];
    if (meta.deprecated) badges.push({ label: "deprecated", tone: "warn" });
    if (meta.reasoning) badges.push({ label: "reasoning" });
    if (meta.vision) badges.push({ label: "vision" });
    if (hasChatToolUse(meta)) badges.push({ label: "tools" });
    return badges;
};

/** Resolves the display title for a model row from metadata and fallback `slug`. */
export const resolveModelRowDisplayName = (
    metaName: string | undefined,
    slug: string,
): string => (metaName && metaName !== slug ? metaName : slug);

/** Formats the optional hint string (`"N hidden · fetched Xm ago"`) on the models header. */
export const formatModelsDisclosureHint = (
    hiddenCount: number,
    refreshLabel: string,
): string | undefined => {
    const hiddenLabel = hiddenCount > 0 ? `${hiddenCount} hidden` : "";
    const joined = [hiddenLabel, refreshLabel].filter(Boolean).join(" · ");
    return joined || undefined;
};

/** Checks whether the extra-model input row should appear for `preset`. */
export const supportsExtraModelEntry = (preset: ProviderPreset): boolean =>
    preset.id === "custom" || preset.models.length === 0;

/** Computes whether `Request headers & auth` starts expanded for `connection`. */
export const computeInitialAdvancedOpen = (
    connection: ProviderConnection,
): boolean => {
    if (connection.authStyle) return true;
    return Object.keys(connection.headers ?? {}).length > 0;
};

/** Checks whether `nextId` is absent from both `extraModels` and `allModels`. */
export const isNewExtraModelId = (
    nextId: string,
    extraModels: string[],
    allModels: string[],
): boolean => !extraModels.includes(nextId) && !allModels.includes(nextId);

/** Formats pricing metadata for a model row when input or output cost is known. */
export const formatModelRowPrice = (
    meta: ReturnType<typeof getModelMetadata>,
): string =>
    meta.inputCostPerM !== null || meta.outputCostPerM !== null
        ? formatModelPricing(meta)
        : "";

/** Formats the provenance suffix (`catalog` / `from provider`) for a model row subtitle. */
export const formatModelSourceSuffix = (source: string | undefined): string => {
    if (source === "catalog") return " · catalog";
    return source === "discovered" ? " · from provider" : "";
};
