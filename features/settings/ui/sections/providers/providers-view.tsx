"use client";

/**
 * Settings → Providers (v2 — deep architecture).
 *
 * Two-zone layout (industry standard from Cline / Zed / Cursor / VS Code):
 *
 *   ┌─ Configured ─────────────────────────────────────────────┐
 *   │ The providers the user has keyed/enabled. Each card is  │
 *   │ expanded to show key, base URL, test/check, per-model   │
 *   │ visibility, and advanced headers/auth.                  │
 *   └──────────────────────────────────────────────────────────┘
 *   ┌─ Add a provider ────────────────────────────────────────┐
 *   │ Compact search/select. Selecting a preset adds it to    │
 *   │ Configured and scrolls to it.                           │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Defaults: per-feature model routing (chat, agent, commits, embeddings) with
 * "Ask every time" as an explicit chatMode. Selectors auto-disable options the
 * chosen model can't support (e.g. no tool-use models are hidden from Agent).
 *
 * Deep search: typing in the main search filters BOTH configured and
 * available providers, auto-expands matching cards, and highlights matching
 * model rows inside the cards via a data attribute.
 */

import React from "react";
import { Icon } from "@/components/ui/icon";
import { notify } from "@/features/notifications";
import {
    PROVIDER_PRESETS,
    SEARCH_PROVIDERS,
    availableModels,
    providerGroups,
    matchesProviderQuery,
    embeddingModelOptions,
    embeddingsAvailable,
    providerPreset,
    searchKeyWarning,
    modelForFeature,
    withFeatureModel,
    setChatMode,
} from "@/lib/ai/providers";
import type { ChatMode, FeatureModel, ModelOption, ProviderId, ProviderPreset, ProvidersSettings } from "@/lib/ai/providers";
import { updateSettingSection, useSettings } from "@/lib/settings";
import {
    SettingCard,
    SettingRow,
    SettingSection,
    SettingSelect,
    SettingSwitch,
} from "../../shared/controls";
import {
    Add20Regular,
    Key20Regular,
    Search20Regular,
    Shield20Regular,
    ChevronUp20Regular,
    ChevronDown20Regular,
} from "./status";
import { KeyInput, TextInput } from "./inputs";
import { ProviderCard } from "./provider-card";
import { useVaultStatus } from "./use-vault-status";
import { forgetSecret } from "@/lib/ai/vault";

/* ------------------------------------------------------------------------ */
/* Feature routing                                                           */
/* ------------------------------------------------------------------------ */

type FeatureSlot = {
    id: FeatureModel;
    label: string;
    description: string;
    /** Capabilities required of a model picked for this slot. */
    requires: { vision?: boolean; toolUse?: boolean };
    /** If true, shows a text input + embedding-specific affordances. */
    embeddings?: boolean;
};

const FEATURE_SLOTS: FeatureSlot[] = [
    {
        id: "chat",
        label: "Chat",
        description: "Used for new chats and quick questions.",
        requires: {},
    },
    {
        id: "agent",
        label: "Agent / Auto",
        description: "Drives the agent loop. Must support tool use.",
        requires: { toolUse: true },
    },
    {
        id: "commits",
        label: "Commit messages",
        description: "Generates commit subjects and bodies.",
        requires: {},
    },
];

function optionsForFeature(
    models: ModelOption[],
    requires: FeatureSlot["requires"],
    currentId: string,
): { value: string; label: string; disabled?: boolean; hint?: string }[] {
    const out: { value: string; label: string; disabled?: boolean; hint?: string }[] = [
        { value: "", label: "Same as chat" },
        { value: "auto", label: "First available", disabled: false },
    ];
    for (const m of models) {
        let disabled = false;
        let hint: string | undefined;
        if (requires.toolUse && !m.capabilities.toolUse) {
            disabled = true;
            hint = "No tool use";
        }
        if (requires.vision && !m.capabilities.vision) {
            disabled = true;
            hint = hint ? `${hint} · no vision` : "No vision";
        }
        // Always show the currently selected model even if it doesn't satisfy
        // the requirements, so users aren't forced off a stale pick.
        if (m.id === currentId) {
            disabled = false;
            hint = undefined;
        }
        out.push({
            value: m.id,
            label: `${m.name} · ${m.provider}`,
            disabled,
            hint,
        });
    }
    return out;
}

/* ------------------------------------------------------------------------ */
/* Main view                                                                 */
/* ------------------------------------------------------------------------ */

export function ProvidersSettingsView() {
    const settings = useSettings();
    const providers = settings.ai.providers;
    const allModels = availableModels(providers);
    const embeddable = embeddingsAvailable(providers);
    const embeddingOptions = embeddingModelOptions(providers);
    const vault = useVaultStatus();
    const [query, setQuery] = React.useState("");
    const needsEmbeddingId = embeddable && embeddingOptions.length === 0;

    // A provider card shows up in the "configured" zone as soon as the user
    // has enabled it, so they can paste a key into the card they just added
    // instead of being trapped on the FirstRun screen. `ProviderCard` itself
    // renders the key prompt and disabled Test button until the key is set.
    const configured = React.useMemo(
        () => PROVIDER_PRESETS.filter((preset) => providers.connections[preset.id]?.enabled),
        [providers.connections],
    );

    const unconfigured = React.useMemo(() => {
        const configuredIds = new Set(configured.map((p) => p.id));
        return providerGroups()
            .map((g) => ({
                group: g.group,
                presets: g.presets.filter((p) => !configuredIds.has(p.id) && matchesProviderQuery(p, query)),
            }))
            .filter((g) => g.presets.length > 0);
    }, [configured, query]);

    const groupsConfigured = React.useMemo(
        () =>
            providerGroups()
                .map((g) => ({
                    group: g.group,
                    presets: g.presets.filter(
                        (p) => configured.some((c) => c.id === p.id) && matchesProviderQuery(p, query),
                    ),
                }))
                .filter((g) => g.presets.length > 0),
        [configured, query],
    );

    const configuredCount = configured.length;
    const chatMode = providers.chatMode || "auto";
    const askOnNewChat = chatMode === "ask";

    const selectedChatModelId = askOnNewChat ? "" : chatMode === "auto" ? "" : chatMode;

    const update = (patch: Partial<ProvidersSettings>) =>
        updateSettingSection("ai", { providers: { ...providers, ...patch } });

    const addProvider = (id: ProviderId) => {
        if (!id) return;
        const preset = providerPreset(id);
        // Defensive: `normalizeProvidersSettings` guarantees an entry for every
        // preset at load time, but if older saved settings are missing a newly
        // added provider id, `existing` would be undefined and spreading it
        // would drop the required apiKey/baseUrl fields.
        const existing = providers.connections[id];
        update({
            connections: {
                ...providers.connections,
                [id]: {
                    ...(existing ?? {
                        apiKey: "",
                        baseUrl: "",
                        models: [],
                        hiddenModels: [],
                        extraModels: [],
                        discoveredModels: [],
                        headers: {},
                        authStyle: "",
                    }),
                    enabled: true,
                },
            },
        });
        notify.success(
            `${preset.label} added`,
            preset.keyless
                ? "No key required — expand the card and Test connection."
                : "Paste an API key, then Test connection.",
        );
        // Scroll into view after paint.
        requestAnimationFrame(() => {
            const el = document.querySelector(`[data-provider-id="${CSS.escape(id)}"]`);
            if (el) (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
        });
    };

    const resetProvider = async (id: ProviderId) => {
        const preset = providerPreset(id);
        // Also purge the key from the OS keychain when vaulted, otherwise a
        // vault-aware restart would hydrate the old apiKey back into the
        // cleared field and undo the reset.
        await forgetSecret(id);
        update({
            connections: {
                ...providers.connections,
                [id]: {
                    apiKey: "",
                    baseUrl: "",
                    enabled: preset.defaultEnabled ?? !preset.keyless,
                    models: [],
                    hiddenModels: [],
                    extraModels: [],
                    discoveredModels: [],
                    headers: {},
                    authStyle: "",
                },
            },
        });
        notify.info(`${preset.label} reset`, "Credentials and overrides cleared.");
    };

    return (
        <>
            <SettingSection
                id="settings-providers"
                title="Model providers"
                description="Bring your own keys. Models are fetched from each provider automatically on Test, with metadata enriched from the community models.dev catalog — no model-id typing needed. Requests go straight from your machine to the provider; BetterShape never proxies them."
                card={false}
                action={
                    configuredCount > 0 ? (
                        <span className="text-xs text-text-muted">
                            {configuredCount} configured
                        </span>
                    ) : null
                }
            >
                {vault === false ? (
                    <div className="mb-2.5 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs leading-4 text-warning">
                        <Icon icon={Shield20Regular} className="mt-px size-3.5 shrink-0" />
                        <span>
                            No OS keychain is available on this machine, so keys are stored in the
                            app&apos;s local settings file. Install a Secret Service provider
                            (gnome-keyring, KWallet) to store them encrypted.
                        </span>
                    </div>
                ) : null}

                {/* Primary search — filters both configured and addable providers. */}
                <div className="mb-3 flex items-center gap-2">
                    <div className="relative w-full max-w-sm">
                        <Icon
                            icon={Search20Regular}
                            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-text-disabled"
                        />
                        <input
                            type="search"
                            value={query}
                            placeholder="Search providers and models…"
                            spellCheck={false}
                            onChange={(e) => setQuery(e.target.value)}
                            className="h-8 w-full rounded-md border border-border-secondary bg-transparent pl-7 pr-2 text-sm text-text-primary placeholder:text-text-disabled outline-none focus:border-accent"
                        />
                    </div>
                </div>

                {/* ── First-run empty state ──────────────────────────────── */}
                {configuredCount === 0 && !query ? (
                    <FirstRun onAdd={addProvider} />
                ) : (
                    <>
                        {/* ── Configured zone ─────────────────────────────── */}
                        {groupsConfigured.length > 0 ? (
                            <div className="flex flex-col gap-4">
                                {groupsConfigured.map((group) => (
                                    <div key={group.group} className="flex flex-col gap-2">
                                        <div className="flex items-baseline gap-2 px-1">
                                            <span className="text-[11px] font-medium tracking-wide text-text-muted uppercase">
                                                {group.group}
                                            </span>
                                            <span className="text-[11px] text-text-disabled">
                                                {group.presets.length} ready
                                            </span>
                                        </div>
                                        <div className="flex flex-col gap-1.5">
                                            {group.presets.map((preset) => (
                                                <ProviderCard
                                                    key={preset.id}
                                                    id={preset.id}
                                                    providers={providers}
                                                    query={query}
                                                    defaultExpanded={query.trim().length > 0 || configuredCount <= 2}
                                                    onReset={() => resetProvider(preset.id)}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : query ? (
                            <div className="py-6 text-sm text-text-muted">
                                No configured providers match &ldquo;{query}&rdquo;.
                            </div>
                        ) : null}

                        {/* ── Add-a-provider zone ──────────────────────────── */}
                        <div className="mt-5">
                            <AddProviderBox
                                onAdd={addProvider}
                                groups={unconfigured}
                                totalAvailable={PROVIDER_PRESETS.length - configuredCount}
                                query={query}
                                onQueryChange={setQuery}
                            />
                        </div>
                    </>
                )}
            </SettingSection>

            {/* ── Defaults / routing ───────────────────────────────────── */}
            <SettingSection
                id="settings-providers-defaults"
                title="Defaults"
                description="Which model powers each part of the app. Empty slots inherit the chat default."
            >
                <SettingCard>
                    <SettingRow
                        title="Ask which model to use for new chats"
                        description="When on, every new chat opens the model picker instead of starting automatically."
                    >
                        <SettingSwitch
                            checked={askOnNewChat}
                            onChange={(on) => update(setChatMode(providers, on ? "ask" : "auto"))}
                        />
                    </SettingRow>
                    <SettingRow
                        title="Chat model"
                        description="Model used for new chats when not asking every time."
                    >
                        <SettingSelect
                            value={selectedChatModelId || "auto"}
                            onChange={(value) => {
                                if (value === "auto") update(setChatMode(providers, "auto"));
                                else update(setChatMode(providers, value as ChatMode));
                            }}
                            disabled={askOnNewChat}
                            className={askOnNewChat ? "opacity-60" : undefined}
                            options={[
                                { value: "auto", label: "First available" },
                                ...allModels.map((m) => ({ value: m.id, label: `${m.name} · ${m.provider}` })),
                            ]}
                        />
                    </SettingRow>
                    {FEATURE_SLOTS.slice(1).map((slot) => (
                        <SettingRow
                            key={slot.id}
                            title={`${slot.label} model`}
                            description={slot.description}
                        >
                            <SettingSelect
                                value={modelForFeature(providers, slot.id) || ""}
                                onChange={(value) => update(withFeatureModel(providers, slot.id, value))}
                                options={optionsForFeature(allModels, slot.requires, modelForFeature(providers, slot.id))}
                            />
                        </SettingRow>
                    ))}
                    <SettingRow
                        title="Embedding model"
                        description={
                            embeddable
                                ? "Drives semantic code search and the codebase index."
                                : "Add an OpenAI, OpenRouter, Mistral, or local OpenAI-wire key to enable semantic search."
                        }
                    >
                        {needsEmbeddingId ? (
                            <TextInput
                                value={modelForFeature(providers, "embeddings")}
                                placeholder="nomic-embed-text"
                                onChange={(value) => update(withFeatureModel(providers, "embeddings", value))}
                            />
                        ) : (
                            <SettingSelect
                                value={modelForFeature(providers, "embeddings") || embeddingOptions[0] || ""}
                                onChange={(value) => update(withFeatureModel(providers, "embeddings", value))}
                                disabled={!embeddable || embeddingOptions.length === 0}
                                options={
                                    embeddingOptions.length > 0
                                        ? [
                                              { value: "", label: "Best available" },
                                              ...embeddingOptions.map((m) => ({ value: m, label: m })),
                                          ]
                                        : [{ value: "", label: "None available" }]
                                }
                            />
                        )}
                    </SettingRow>
                </SettingCard>
            </SettingSection>

            {/* ── Other services ─────────────────────────────────────── */}
            <SettingSection
                id="settings-providers-services"
                title="Other services"
                description="Optional keys for web search and plugins."
            >
                <SettingCard>
                    <SettingRow
                        title="Web search"
                        description="The agent's web_search tool uses your own search account."
                    >
                        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                            <SettingSelect
                                value={providers.services.search.provider}
                                onChange={(value) =>
                                    update({
                                        services: {
                                            ...providers.services,
                                            search: {
                                                ...providers.services.search,
                                                provider: value as "none" | "tavily" | "brave",
                                            },
                                        },
                                    })
                                }
                                options={SEARCH_PROVIDERS.map((p) => ({ value: p.id, label: p.label }))}
                            />
                            {providers.services.search.provider !== "none" ? (
                                <div className="w-full sm:w-64">
                                    <KeyInput
                                        value={providers.services.search.apiKey}
                                        placeholder={
                                            SEARCH_PROVIDERS.find(
                                                (p) => p.id === providers.services.search.provider,
                                            )?.keyHint ?? "API key"
                                        }
                                        onChange={(apiKey) =>
                                            update({
                                                services: {
                                                    ...providers.services,
                                                    search: { ...providers.services.search, apiKey },
                                                },
                                            })
                                        }
                                        warning={searchKeyWarning(
                                            providers.services.search.provider,
                                            providers.services.search.apiKey,
                                        )}
                                    />
                                </div>
                            ) : null}
                        </div>
                    </SettingRow>
                    <SettingRow
                        title="Composio API key"
                        description="Powers plugins. Create one at composio.dev, then connect accounts in Plugins."
                    >
                        <div className="w-full sm:w-72">
                            <KeyInput
                                value={providers.services.composio.apiKey}
                                placeholder="ck_…"
                                onChange={(apiKey) =>
                                    update({
                                        services: {
                                            ...providers.services,
                                            composio: { ...providers.services.composio, apiKey },
                                        },
                                    })
                                }
                            />
                        </div>
                    </SettingRow>
                    <SettingRow
                        title="Composio user id"
                        description="Scopes connected accounts. Keep the default unless you know you need another."
                    >
                        <div className="w-full sm:w-72">
                            <TextInput
                                value={providers.services.composio.userId}
                                placeholder="bettershape-local"
                                onChange={(userId) =>
                                    update({
                                        services: {
                                            ...providers.services,
                                            composio: { ...providers.services.composio, userId },
                                        },
                                    })
                                }
                            />
                        </div>
                    </SettingRow>
                </SettingCard>
            </SettingSection>
        </>
    );
}

/* ------------------------------------------------------------------------ */
/* First-run and add-provider subcomponents                                  */
/* ------------------------------------------------------------------------ */

const RECOMMENDED_FIRST_PROVIDERS: ProviderId[] = ["openai", "anthropic", "google", "openrouter"];

function FirstRun({ onAdd }: { onAdd: (id: ProviderId) => void }) {
    const recs = RECOMMENDED_FIRST_PROVIDERS.map((id) => providerPreset(id));
    return (
        <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-border-subtle bg-surface-2/40 px-4 py-4 squircle-[18px]">
                <div className="flex items-start gap-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent/15 text-accent-text squircle-md">
                        <Icon icon={Key20Regular} className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-text-primary">Add your first provider</div>
                        <div className="mt-1 text-xs leading-4 text-text-muted">
                            BetterShape uses your own API keys — start with one of the major
                            providers below, or add any OpenAI-compatible endpoint. Keys are
                            stored in your OS keychain, never in plaintext.
                        </div>
                        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {recs.map((preset) => (
                                <button
                                    key={preset.id}
                                    type="button"
                                    onClick={() => onAdd(preset.id)}
                                    className="group flex items-center gap-3 rounded-lg border border-border-secondary bg-panel px-3 py-2.5 text-left transition-colors duration-fast hover:border-border hover:bg-panel-hover"
                                >
                                    <ProviderMonogramSm label={preset.label} />
                                    <div className="min-w-0 flex-1">
                                        <div className="text-sm font-medium text-text-primary">
                                            {preset.label}
                                        </div>
                                        <div className="text-[11px] text-text-disabled">
                                            {preset.models.length} models
                                        </div>
                                    </div>
                                    <Icon
                                        icon={Add20Regular}
                                        className="size-3.5 text-text-muted transition-colors duration-fast group-hover:text-text-primary"
                                    />
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function AddProviderBox({
    onAdd,
    groups,
    totalAvailable,
    query,
    onQueryChange,
}: {
    onAdd: (id: ProviderId) => void;
    groups: { group: string; presets: ProviderPreset[] }[];
    totalAvailable: number;
    query: string;
    onQueryChange: (q: string) => void;
}) {
    const [selected, setSelected] = React.useState<ProviderId | "">("");
    // Open the drawer when searching or when there are very few providers left.
    const [userDismissed, setUserDismissed] = React.useState(false);
    const open =
        !userDismissed && (totalAvailable < 8 || query.length > 0);
    const toggle = () => {
        if (open) setUserDismissed(true);
        else setUserDismissed(false);
    };

    const allFlat = groups.flatMap((g) => g.presets);

    return (
        <div className="rounded-xl border border-border-subtle bg-surface-2/30 squircle-[18px]">
            <button
                type="button"
                onClick={toggle}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                aria-expanded={open}
            >
                <div className="flex min-w-0 items-center gap-2">
                    <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent/15 text-accent-text squircle-sm">
                        <Icon icon={Add20Regular} className="size-3.5" />
                    </div>
                    <div className="min-w-0">
                        <div className="text-sm font-medium text-text-primary">Add a provider</div>
                        <div className="text-[11px] text-text-muted">
                            {totalAvailable} available — gateways, clouds, local runtimes
                        </div>
                    </div>
                </div>
                <Icon
                    icon={open ? ChevronUp20Regular : ChevronDown20Regular}
                    className="size-3.5 text-text-muted"
                />
            </button>
            {open ? (
                <div className="border-t border-border-subtle px-4 py-3">
                    {!query ? (
                        <div className="relative mb-3">
                            <Icon
                                icon={Search20Regular}
                                className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-text-disabled"
                            />
                            <input
                                type="search"
                                value={query}
                                placeholder="Filter available providers…"
                                onChange={(e) => onQueryChange(e.target.value)}
                                className="h-8 w-full max-w-xs rounded-md border border-border-secondary bg-transparent pl-7 pr-2 text-sm text-text-primary placeholder:text-text-disabled outline-none focus:border-accent"
                            />
                        </div>
                    ) : null}
                    {allFlat.length === 0 ? (
                        <div className="py-4 text-sm text-text-muted">
                            No available providers match &ldquo;{query}&rdquo;.
                        </div>
                    ) : (
                        <div className="flex flex-col gap-3">
                            {groups.map((g) => (
                                <div key={g.group}>
                                    <div className="mb-1.5 px-0.5 text-[11px] font-medium uppercase tracking-wide text-text-disabled">
                                        {g.group}
                                    </div>
                                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                                        {g.presets.map((preset) => (
                                            <button
                                                key={preset.id}
                                                type="button"
                                                onClick={() => {
                                                    setSelected(preset.id);
                                                    onAdd(preset.id);
                                                }}
                                                className={`group flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors duration-fast ${
                                                    selected === preset.id
                                                        ? "border-accent/60 bg-accent/10"
                                                        : "border-border-secondary bg-panel hover:border-border hover:bg-panel-hover"
                                                }`}
                                            >
                                                <ProviderMonogramSm label={preset.label} />
                                                <div className="min-w-0 flex-1">
                                                    <div className="truncate text-sm font-medium text-text-primary">
                                                        {preset.label}
                                                    </div>
                                                    <div className="truncate text-[11px] text-text-disabled">
                                                        {preset.kind === "anthropic"
                                                            ? "Messages API"
                                                            : preset.kind === "google"
                                                              ? "Generative Language"
                                                              : "OpenAI-compatible"}
                                                        {preset.keyless ? " · no key" : ""}
                                                    </div>
                                                </div>
                                                <Icon
                                                    icon={Add20Regular}
                                                    className="size-3.5 text-text-muted opacity-0 transition-opacity duration-fast group-hover:opacity-100"
                                                />
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            ) : null}
        </div>
    );
}

function ProviderMonogramSm({ label }: { label: string }) {
    const initials = label
        .split(/[\s()]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? "")
        .join("");
    return (
        <div
            className="flex size-6 shrink-0 items-center justify-center rounded-[4px] bg-surface-3 text-[10px] font-semibold text-text-secondary"
            aria-hidden
        >
            {initials}
        </div>
    );
}
