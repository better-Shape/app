"use client";

/**
 * Settings → Providers.
 *
 * Everything BetterShape needs a key for lives here: model providers (OpenAI,
 * Anthropic, Google, and any OpenAI-compatible endpoint), the semantic index
 * embedding model, web search, and Composio for plugins. Keys are stored in the
 * app's local settings and pushed to the Rust side; nothing leaves the machine.
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
    modelIdsFor,
    providerPreset,
    type ProviderId,
    type ProvidersSettings,
} from "@/lib/ai/providers";
import { getSettings, updateSettingSection } from "@/lib/settings";
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
}: {
    value: string;
    placeholder: string;
    onChange: (next: string) => void;
    disabled?: boolean;
}) {
    const [visible, setVisible] = React.useState(false);
    return (
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
    );
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
    const models = modelIdsFor(id, providers.connections);
    const usable = isConnectionUsable(id, providers.connections);

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
                    />
                    <TextInput
                        value={connection.baseUrl}
                        placeholder={preset.baseUrl || "https://host/v1"}
                        onChange={(baseUrl) => update({ baseUrl })}
                    />
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

    return (
        <>
            <SettingSection
                id="settings-providers"
                title="Model providers"
                description="Bring your own keys. Requests go straight from your machine to the provider — BetterShape never proxies them."
                card={false}
            >
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
                                : "Add an OpenAI, OpenRouter or custom OpenAI-wire key to enable semantic search."
                        }
                    >
                        <SettingSelect
                            value={providers.embeddingModel || "text-embedding-3-small"}
                            onChange={(value) =>
                                updateSettingSection("ai", {
                                    providers: { ...providers, embeddingModel: value },
                                })
                            }
                            disabled={!embeddable}
                            options={
                                embeddingOptions.length > 0
                                    ? embeddingOptions.map((model) => ({ value: model, label: model }))
                                    : [{ value: "text-embedding-3-small", label: "text-embedding-3-small" }]
                            }
                        />
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
