"use client";

/**
 * Settings → Providers.
 *
 * Everything BetterShape needs a key for lives here: model providers (OpenAI,
 * Anthropic, Google, and any OpenAI-compatible endpoint), the semantic index
 * embedding model, web search, and Composio for plugins.
 *
 * Keys go into the operating system's keychain and are pushed to the Rust side
 * for the session; nothing leaves the machine. "Test connection" verifies a key
 * and base URL against the provider and can import the models it reports.
 */

import React from "react";
import { Link20Regular } from "@fluentui/react-icons/headless/svg/link";
import { Eye20Regular } from "@fluentui/react-icons/headless/svg/eye";
import { EyeOff20Regular } from "@fluentui/react-icons/headless/svg/eye-off";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { commands } from "@/lib/backend";
import {
    PROVIDER_PRESETS,
    SEARCH_PROVIDERS,
    availableModels,
    providerGroups,
    providersForModelNames,
    matchesProviderQuery,
    embeddingModelOptions,
    embeddingsAvailable,
    formatHeaderLines,
    isConnectionUsable,
    keyFormatWarning,
    modelIdsFor,
    modelsWithProviderPrefix,
    parseHeaderLines,
    providerAuthStyle,
    providerHeaders,
    providerPreset,
    searchKeyWarning,
    type AuthStyle,
    type ProviderId,
    type ProvidersSettings,
} from "@/lib/ai/providers";
import { areSecretsVaulted, useSettings, updateSettingSection } from "@/lib/settings";
import { vaultAvailable } from "@/lib/ai/vault";
import {
    SettingCard,
    SettingRow,
    SettingSection,
    SettingSelect,
    SettingSwitch,
    SETTING_CONTROL_BTN,
} from "../shared/controls";

function KeyInput({
    value,
    placeholder,
    onChange,
    disabled,
    warning,
}: {
    value: string;
    placeholder: string;
    onChange: (next: string) => void;
    disabled?: boolean;
    /** Advisory message shown under the field (never blocks the edit). */
    warning?: string | null;
}) {
    const [visible, setVisible] = React.useState(false);
    return (
        <div className="flex w-full flex-col gap-1">
            <div className="flex w-full items-center gap-1.5">
                <input
                    type={visible ? "text" : "password"}
                    value={value}
                    placeholder={placeholder}
                    disabled={disabled}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => onChange(e.target.value)}
                    className="h-8 min-w-0 flex-1 rounded-md border border-border-secondary bg-transparent px-2 text-sm text-text-primary outline-none focus:border-accent disabled:opacity-50"
                />
                <Button
                    size="sm"
                    variant="ghost"
                    className={SETTING_CONTROL_BTN}
                    aria-label={visible ? "Hide key" : "Show key"}
                    onClick={() => setVisible((v) => !v)}
                >
                    <Icon icon={visible ? EyeOff20Regular : Eye20Regular} />
                </Button>
            </div>
            {warning ? <div className="text-xs text-amber-500">{warning}</div> : null}
        </div>
    );
}

/** Keychain availability, probed once per mounted settings view. */
function useVaultStatus(): boolean | null {
    const [available, setAvailable] = React.useState<boolean | null>(
        typeof window === "undefined" ? null : areSecretsVaulted() ? true : null,
    );
    React.useEffect(() => {
        if (available !== null) return;
        let cancelled = false;
        void vaultAvailable().then((supported) => {
            if (!cancelled) setAvailable(supported);
        });
        return () => {
            cancelled = true;
        };
    }, [available]);
    return available;
}

function TextInput({
    value,
    placeholder,
    onChange,
}: {
    value: string;
    placeholder: string;
    onChange: (next: string) => void;
}) {
    return (
        <input
            type="text"
            value={value}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => onChange(e.target.value)}
            className="h-8 w-full rounded-md border border-border-secondary bg-transparent px-2 text-sm text-text-primary outline-none focus:border-accent"
        />
    );
}

function ProviderCard({ id, providers }: { id: ProviderId; providers: ProvidersSettings }) {
    const preset = providerPreset(id);
    const connection = providers.connections[id];
    const [modelsOpen, setModelsOpen] = React.useState(false);
    const [testing, setTesting] = React.useState(false);
    const [testResult, setTestResult] = React.useState<{
        ok: boolean;
        message: string;
        models: string[];
    } | null>(null);
    const [imported, setImported] = React.useState(0);
    const [checking, setChecking] = React.useState(false);
    const [checkResult, setCheckResult] = React.useState<{ ok: boolean; message: string } | null>(null);
    const [advancedOpen, setAdvancedOpen] = React.useState(
        Object.keys(connection.headers ?? {}).length > 0 || Boolean(connection.authStyle),
    );
    const [matchedProviders, setMatchedProviders] = React.useState(0);
    const models = modelIdsFor(id, providers.connections);
    const usable = isConnectionUsable(id, providers.connections);
    const presetHeaders = Object.entries(preset.headers ?? {});

    const testConnection = async () => {
        setTesting(true);
        setTestResult(null);
        setImported(0);
        try {
            const report = await commands.aiTestProvider(
                id,
                preset.kind,
                connection.apiKey,
                connection.baseUrl || preset.baseUrl,
            );
            setTestResult({
                ok: report.ok,
                message: report.ok ? `${report.message} (${report.latencyMs} ms)` : report.message,
                models: report.models,
            });
        } catch (error) {
            setTestResult({
                ok: false,
                message: error instanceof Error ? error.message : String(error),
                models: [],
            });
        } finally {
            setTesting(false);
        }
    };

    /**
     * Send one real completion through the app's own wire — the only way to be
     * sure a chat will answer (a model list can be served by a gateway that
     * still rejects completions).
     */
    const checkConnection = async () => {
        setChecking(true);
        setCheckResult(null);
        try {
            const report = await commands.aiCheckProvider(id, {
                kind: preset.kind,
                apiKey: connection.apiKey,
                baseUrl: connection.baseUrl || preset.baseUrl,
                model: checkModel,
                headers: providerHeaders(id, connection),
                authStyle: providerAuthStyle(id, connection),
            });
            setCheckResult({
                ok: report.ok,
                message: report.ok ? `${report.message} (${report.latencyMs} ms)` : report.message,
            });
        } catch (error) {
            setCheckResult({
                ok: false,
                message: error instanceof Error ? error.message : String(error),
            });
        } finally {
            setChecking(false);
        }
    };

    /** Adopt the models the provider actually reported for this key. */
    const importModels = () => {
        if (!testResult || testResult.models.length === 0) return;
        const ids = modelsWithProviderPrefix(id, testResult.models);
        update({ models: ids });
        setImported(ids.length);
    };

    /** Model to check with: the first one this connection offers. */
    const checkModel =
        models[0] ??
        (providers.defaultModel.startsWith(`${id}/`) ? providers.defaultModel : "");

    const update = (patch: Partial<typeof connection>) => {
        updateSettingSection("ai", {
            providers: {
                ...providers,
                connections: {
                    ...providers.connections,
                    [id]: { ...connection, ...patch },
                },
            },
        });
    };

    return (
        <SettingCard>
            <div className="flex flex-col gap-3 px-4 py-3.5">
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-sm font-medium text-text-primary">
                            <span>{preset.label}</span>
                            {preset.docsUrl ? (
                                <button
                                    type="button"
                                    aria-label={`Get a ${preset.label} key`}
                                    className="shrink-0 text-text-muted hover:text-text-primary"
                                    onClick={() => void commands.openUrlExternal(preset.docsUrl)}
                                >
                                    <Icon icon={Link20Regular} />
                                </button>
                            ) : null}
                            <span className="flex shrink-0 items-center gap-1 text-xs font-normal text-text-muted">
                                <span
                                    className={
                                        usable
                                            ? "h-1.5 w-1.5 rounded-full bg-emerald-500"
                                            : "h-1.5 w-1.5 rounded-full bg-text-muted"
                                    }
                                    aria-hidden
                                />
                                {!usable
                                    ? "not configured"
                                    : preset.keyless && !connection.apiKey.trim()
                                      ? "no key needed"
                                      : "ready"}
                            </span>
                        </div>
                        <div className="text-sm text-text-muted">
                            {preset.kind === "openai"
                                ? "OpenAI-compatible API"
                                : preset.kind === "anthropic"
                                  ? "Anthropic Messages API"
                                  : "Google Generative Language API"}
                        </div>
                        {preset.note ? (
                            <div className="text-xs text-text-muted">{preset.note}</div>
                        ) : null}
                    </div>
                    <SettingSwitch
                        checked={connection.enabled}
                        onChange={(enabled) => update({ enabled })}
                    />
                </div>

                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                    <KeyInput
                        value={connection.apiKey}
                        placeholder={preset.keyHint || "API key"}
                        onChange={(apiKey) => update({ apiKey })}
                        warning={keyFormatWarning(id, connection.apiKey)}
                    />
                    <TextInput
                        value={connection.baseUrl}
                        placeholder={preset.baseUrl || "https://host/v1"}
                        onChange={(baseUrl) => update({ baseUrl })}
                    />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        size="sm"
                        variant="secondary"
                        className={SETTING_CONTROL_BTN}
                        disabled={testing || (!usable && id !== "custom")}
                        onClick={() => void testConnection()}
                    >
                        {testing ? "Testing…" : "Test connection"}
                    </Button>
                    <Button
                        size="sm"
                        variant="secondary"
                        className={SETTING_CONTROL_BTN}
                        disabled={checking || !checkModel}
                        title={
                            checkModel
                                ? `Sends one short completion with ${checkModel}`
                                : "Add a model id for this connection first"
                        }
                        onClick={() => void checkConnection()}
                    >
                        {checking ? "Checking…" : "Check chat"}
                    </Button>
                    {testResult?.ok && testResult.models.length > 0 ? (
                        <Button
                            size="sm"
                            variant="ghost"
                            className={SETTING_CONTROL_BTN}
                            onClick={importModels}
                        >
                            {imported > 0
                                ? `${imported} models imported`
                                : `Use these ${testResult.models.length} models`}
                        </Button>
                    ) : null}
                    {testResult ? (
                        <span
                            className={
                                testResult.ok
                                    ? "text-xs text-text-muted"
                                    : "text-xs whitespace-pre-line text-amber-500"
                            }
                        >
                            {testResult.message}
                        </span>
                    ) : null}
                </div>

                {checkResult ? (
                    <div
                        className={
                            checkResult.ok
                                ? "text-xs text-text-muted"
                                : "text-xs whitespace-pre-line text-amber-500"
                        }
                    >
                        {checkResult.message}
                    </div>
                ) : null}

                {models.length > 0 ? (
                    <div className="text-xs text-text-muted">
                        <button
                            type="button"
                            className="hover:text-text-primary"
                            onClick={() => setModelsOpen((v) => !v)}
                        >
                            {modelsOpen ? "Hide models" : `${models.length} models`}
                        </button>
                        {modelsOpen ? (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                                {models.map((model) => (
                                    <span
                                        key={model}
                                        className="rounded border border-border-secondary px-1.5 py-0.5"
                                    >
                                        {model.split("/").slice(1).join("/")}
                                    </span>
                                ))}
                            </div>
                        ) : null}
                    </div>
                ) : null}

                <div className="flex flex-col gap-2">
                    <button
                        type="button"
                        className="self-start text-xs text-text-muted hover:text-text-primary"
                        onClick={() => setAdvancedOpen((v) => !v)}
                    >
                        {advancedOpen ? "Hide request headers" : "Request headers & auth"}
                    </button>
                    {advancedOpen ? (
                        <>
                            <SettingRow
                                title="Auth header"
                                description="Where the key above is sent. Leave on the default unless the endpoint expects otherwise."
                            >
                                <SettingSelect
                                    value={connection.authStyle}
                                    onChange={(value) => update({ authStyle: value as AuthStyle | "" })}
                                    options={[
                                        {
                                            value: "",
                                            label: `Default (${providerAuthStyle(id, connection)})`,
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
                                title="Extra headers"
                                description="One Name: value per line. Values are stored in the OS keychain beside the key."
                            >
                                <textarea
                                    value={formatHeaderLines(connection.headers)}
                                    placeholder={"HTTP-Referer: https://example.com\nX-Tenant: acme"}
                                    spellCheck={false}
                                    rows={2}
                                    onChange={(e) =>
                                        update({ headers: parseHeaderLines(e.target.value) })
                                    }
                                    className="w-full rounded-md border border-border-secondary bg-transparent px-2 py-1 font-mono text-xs text-text-primary outline-none focus:border-accent"
                                />
                            </SettingRow>
                            {presetHeaders.length > 0 ? (
                                <div className="text-xs text-text-muted">
                                    {preset.label} always sends{" "}
                                    {presetHeaders
                                        .map(([name, value]) => `${name}: ${value}`)
                                        .join(", ")}
                                    . Your lines above win on conflicts.
                                </div>
                            ) : null}
                        </>
                    ) : null}
                </div>

                {preset.id === "custom" ? (
                    <SettingRow
                        title="Extra model ids"
                        description="Comma-separated ids your endpoint serves (e.g. llama3.1, qwen2.5-coder)."
                    >
                        <TextInput
                            value={connection.extraModels.join(", ")}
                            placeholder="model-a, model-b"
                            onChange={(raw) =>
                                update({
                                    extraModels: raw
                                        .split(",")
                                        .map((s) => s.trim())
                                        .filter(Boolean),
                                })
                            }
                        />
                    </SettingRow>
                ) : null}

                {preset.models.length === 0 && connection.extraModels.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                        <Button
                            size="sm"
                            variant="ghost"
                            className={SETTING_CONTROL_BTN}
                            onClick={() => {
                                const matched = providersForModelNames(
                                    connection.extraModels,
                                    providers.connections,
                                );
                                if (matched.length === 0) return;
                                updateSettingSection("ai", {
                                    providers: {
                                        ...providers,
                                        connections: Object.fromEntries(
                                            Object.entries(providers.connections).map(([key, value]) => [
                                                key,
                                                matched.includes(key as ProviderId)
                                                    ? { ...value, enabled: true }
                                                    : value,
                                            ]),
                                        ) as typeof providers.connections,
                                    },
                                });
                                setMatchedProviders(matched.length);
                            }}
                        >
                            {matchedProviders > 0
                                ? `${matchedProviders} providers enabled`
                                : "Enable providers these models belong to"}
                        </Button>
                        {matchedProviders > 0 ? (
                            <span>Add a key to them above, then Test connection.</span>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </SettingCard>
    );
}

export function ProvidersSettingsView() {
    const settings = useSettings();
    const providers = settings.ai.providers;
    const models = availableModels(providers);
    const embeddable = embeddingsAvailable(providers);
    const embeddingOptions = embeddingModelOptions(providers);
    const vault = useVaultStatus();
    const [query, setQuery] = React.useState("");
    // A provider with no known embedding defaults (a local runtime) needs the
    // model id typed in, so the select becomes a text field.
    const needsEmbeddingId = embeddable && embeddingOptions.length === 0;
    // Configured connections first in each group, then everything else: the two
    // or three the user actually keys are the ones they keep coming back to.
    const groups = providerGroups()
        .map((group) => {
            const presets = group.presets
                .filter((preset) => matchesProviderQuery(preset, query))
                .sort(
                    (a, b) =>
                        Number(isConnectionUsable(b.id, providers.connections)) -
                        Number(isConnectionUsable(a.id, providers.connections)),
                );
            return {
                group: group.group,
                presets,
                ready: presets.filter((preset) =>
                    isConnectionUsable(preset.id, providers.connections),
                ).length,
            };
        })
        .filter((group) => group.presets.length > 0);
    const configuredCount = PROVIDER_PRESETS.filter((preset) =>
        isConnectionUsable(preset.id, providers.connections),
    ).length;
    const configuredLabel =
        configuredCount === 0
            ? "No providers configured yet"
            : `${configuredCount} provider${configuredCount === 1 ? "" : "s"} ready`;

    return (
        <>
            <SettingSection
                id="settings-providers"
                title="Model providers"
                description="Bring your own keys. Requests go straight from your machine to the provider — BetterShape never proxies them."
                card={false}
            >
                {vault === false ? (
                    <div className="mb-2.5 rounded-md border border-amber-500/40 px-3 py-2 text-xs text-amber-500">
                        No OS keychain is available on this machine, so keys are kept in the app&apos;s
                        local settings file. Install a Secret Service provider (gnome-keyring,
                        KWallet) to store them encrypted.
                    </div>
                ) : null}
                <div className="mb-2.5 flex flex-wrap items-center gap-2">
                    <input
                        type="search"
                        value={query}
                        placeholder="Search providers and models…"
                        spellCheck={false}
                        onChange={(e) => setQuery(e.target.value)}
                        className="h-8 w-full max-w-xs rounded-md border border-border-secondary bg-transparent px-2 text-sm text-text-primary outline-none focus:border-accent"
                    />
                    <span className="text-xs text-text-muted">
                        {configuredLabel}
                    </span>
                </div>
                <div className="flex flex-col gap-4">
                    {groups.map((group) => (
                        <div key={group.group} className="flex flex-col gap-2.5">
                            <div className="flex items-baseline gap-2">
                                <span className="text-xs font-medium tracking-wide text-text-muted uppercase">
                                    {group.group}
                                </span>
                                {group.ready > 0 ? (
                                    <span className="text-xs text-text-muted">
                                        {group.ready} of {group.presets.length} ready
                                    </span>
                                ) : null}
                            </div>
                            {group.presets.map((preset) => (
                                <ProviderCard key={preset.id} id={preset.id} providers={providers} />
                            ))}
                        </div>
                    ))}
                    {groups.length === 0 ? (
                        <div className="text-sm text-text-muted">
                            No provider matches “{query}”.
                        </div>
                    ) : null}
                </div>
            </SettingSection>

            <SettingSection
                id="settings-providers-defaults"
                title="Defaults"
                description="What Auto uses, and which model powers the semantic codebase index."
            >
                <SettingCard>
                    <SettingRow
                        title="Default model"
                        description="Used for Auto, titles, captions, subagent fallbacks and quick decisions."
                    >
                        <SettingSelect
                            value={providers.defaultModel}
                            onChange={(value) =>
                                updateSettingSection("ai", {
                                    providers: { ...providers, defaultModel: value },
                                })
                            }
                            options={[
                                { value: "auto", label: "First available" },
                                ...models.map((model) => ({
                                    value: model.id,
                                    label: `${model.name} · ${model.provider}`,
                                })),
                            ]}
                        />
                    </SettingRow>
                    <SettingRow
                        title="Embedding model"
                        description={
                            embeddable
                                ? "OpenAI-compatible embeddings for semantic search."
                                : "Add an OpenAI, OpenRouter, Mistral or custom OpenAI-wire key to enable semantic search."
                        }
                    >
                        {needsEmbeddingId ? (
                            <TextInput
                                value={providers.embeddingModel}
                                placeholder="nomic-embed-text"
                                onChange={(value) =>
                                    updateSettingSection("ai", {
                                        providers: { ...providers, embeddingModel: value },
                                    })
                                }
                            />
                        ) : (
                            <SettingSelect
                                value={providers.embeddingModel || embeddingOptions[0] || ""}
                                onChange={(value) =>
                                    updateSettingSection("ai", {
                                        providers: { ...providers, embeddingModel: value },
                                    })
                                }
                                disabled={!embeddable || embeddingOptions.length === 0}
                                options={
                                    embeddingOptions.length > 0
                                        ? embeddingOptions.map((model) => ({
                                              value: model,
                                              label: model,
                                          }))
                                        : [{ value: "", label: "None available" }]
                                }
                            />
                        )}
                    </SettingRow>
                </SettingCard>
            </SettingSection>

            <SettingSection
                id="settings-providers-services"
                title="Other services"
                description="Optional keys for the agent's web search and for plugins."
            >
                <SettingCard>
                    <SettingRow
                        title="Web search"
                        description="The agent's web_search tool uses your own search account."
                    >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <SettingSelect
                                value={providers.services.search.provider}
                                onChange={(value) =>
                                    updateSettingSection("ai", {
                                        providers: {
                                            ...providers,
                                            services: {
                                                ...providers.services,
                                                search: {
                                                    ...providers.services.search,
                                                    provider: value as
                                                        | "none"
                                                        | "tavily"
                                                        | "brave",
                                                },
                                            },
                                        },
                                    })
                                }
                                options={SEARCH_PROVIDERS.map((p) => ({ value: p.id, label: p.label }))}
                            />
                            {providers.services.search.provider !== "none" ? (
                                <KeyInput
                                    value={providers.services.search.apiKey}
                                    placeholder={
                                        SEARCH_PROVIDERS.find(
                                            (p) => p.id === providers.services.search.provider,
                                        )?.keyHint ?? "API key"
                                    }
                                    onChange={(apiKey) =>
                                        updateSettingSection("ai", {
                                            providers: {
                                                ...providers,
                                                services: {
                                                    ...providers.services,
                                                    search: { ...providers.services.search, apiKey },
                                                },
                                            },
                                        })
                                    }
                                    warning={searchKeyWarning(
                                        providers.services.search.provider,
                                        providers.services.search.apiKey,
                                    )}
                                />
                            ) : null}
                        </div>
                    </SettingRow>
                    <SettingRow
                        title="Composio API key"
                        description="Powers plugins. Create one at composio.dev, then connect accounts in Plugins."
                    >
                        <KeyInput
                            value={providers.services.composio.apiKey}
                            placeholder="ck_…"
                            onChange={(apiKey) =>
                                updateSettingSection("ai", {
                                    providers: {
                                        ...providers,
                                        services: {
                                            ...providers.services,
                                            composio: { ...providers.services.composio, apiKey },
                                        },
                                    },
                                })
                            }
                        />
                    </SettingRow>
                    <SettingRow
                        title="Composio user id"
                        description="Scopes connected accounts. Keep the default unless you know you need another."
                    >
                        <TextInput
                            value={providers.services.composio.userId}
                            placeholder="bettershape-local"
                            onChange={(userId) =>
                                updateSettingSection("ai", {
                                    providers: {
                                        ...providers,
                                        services: {
                                            ...providers.services,
                                            composio: { ...providers.services.composio, userId },
                                        },
                                    },
                                })
                            }
                        />
                    </SettingRow>
                </SettingCard>
            </SettingSection>
        </>
    );
}
