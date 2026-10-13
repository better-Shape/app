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
    embeddingModelOptions,
    embeddingsAvailable,
    isConnectionUsable,
    keyFormatWarning,
    modelIdsFor,
    modelsWithProviderPrefix,
    providerPreset,
    searchKeyWarning,
    type ProviderId,
    type ProvidersSettings,
} from "@/lib/ai/providers";
import { areSecretsVaulted, getSettings, updateSettingSection } from "@/lib/settings";
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
    const models = modelIdsFor(id, providers.connections);
    const usable = isConnectionUsable(id, providers.connections);

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

    /** Adopt the models the provider actually reported for this key. */
    const importModels = () => {
        if (!testResult || testResult.models.length === 0) return;
        const ids = modelsWithProviderPrefix(id, testResult.models);
        update({ models: ids });
        setImported(ids.length);
    };

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
                            {usable ? null : (
                                <span className="text-xs text-text-muted">not configured</span>
                            )}
                        </div>
                        <div className="text-sm text-text-muted">
                            {preset.kind === "openai"
                                ? "OpenAI-compatible API"
                                : preset.kind === "anthropic"
                                  ? "Anthropic Messages API"
                                  : "Google Generative Language API"}
                        </div>
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
            </div>
        </SettingCard>
    );
}

export function ProvidersSettingsView() {
    const settings = getSettings();
    const providers = settings.ai.providers;
    const models = availableModels(providers);
    const embeddable = embeddingsAvailable(providers);
    const embeddingOptions = embeddingModelOptions(providers);
    const vault = useVaultStatus();
    // A provider with no known embedding defaults (a local runtime) needs the
    // model id typed in, so the select becomes a text field.
    const needsEmbeddingId = embeddable && embeddingOptions.length === 0;

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
                <div className="flex flex-col gap-2.5">
                    {PROVIDER_PRESETS.map((preset) => (
                        <ProviderCard key={preset.id} id={preset.id} providers={providers} />
                    ))}
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
