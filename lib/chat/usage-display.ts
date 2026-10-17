import type { LastTurnUsage } from "@/lib/chat/last-turn-usage";
import type { MessageUsageStatsPayload } from "@/lib/backend/types";
import { modelOption } from "@/lib/ai/providers";

/**
 * Per-message usage reported by the native turn event.
 *
 * `lib/backend/types.ts` owns the shape because the same payload arrives on the
 * IPC event, on a persisted conversation and on the renderer message. It used to
 * be written out three times and `autoPercent` was dropped from this copy, so a
 * caller holding a real event object failed to typecheck here.
 */
export type MessageUsageStats = MessageUsageStatsPayload;

export function isAutoModelId(model?: string | null): boolean {
    if (!model) return false;
    const normalized = model === "openrouter/auto" ? "auto" : model;
    return normalized === "auto";
}

export function formatModelLabel(model?: string | null): string {
    if (!model?.trim()) return "";
    if (isAutoModelId(model)) return "Auto";
    const slug = model.includes("/") ? model.split("/").pop()! : model;
    return slug
        .split("-")
        .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
        .join(" ");
}

/** Message header: Auto when Auto was selected; otherwise the concrete model name. */
export function formatMessageModelLabel(
    model?: string | null,
    stats?: MessageUsageStats,
): string {
    if (stats?.usedAuto || isAutoModelId(model)) return "Auto";
    return formatModelLabel(model);
}

/** Per-message usage for the details popover — one joined line (tests / legacy). */
export function formatMessageUsageLine(
    stats: MessageUsageStats | undefined,
    model?: string | null,
): string {
    return formatMessageUsageRows(stats, model)
        .map((r) => r.value)
        .join(" · ") || "";
}

/** Separate usage fields; omit anything without data. */
export function formatMessageUsageRows(
    stats: MessageUsageStats | undefined,
    _model?: string | null,
): Array<{ label: string; value: string }> {
    if (!stats) return [];
    const rows: Array<{ label: string; value: string }> = [];
    const tokens = stats.tokens ?? 0;
    const input = stats.inputTokens;
    const output = stats.outputTokens;

    if (tokens > 0) {
        rows.push({ label: "Tokens", value: tokens.toLocaleString() });
    }

    if (input != null && input > 0) {
        rows.push({ label: "Input", value: input.toLocaleString() });
    }
    if (output != null && output > 0) {
        rows.push({ label: "Output", value: output.toLocaleString() });
    }

    return rows;
}

export type ChatUsageDisplay = {
    mode: "tokens";
    /** Ring fill for the last turn relative to the model's context window. */
    percent: number;
    /** Short primary line, e.g. "12.4K tokens". */
    title: string;
    /** Secondary line — kept for API compat; prefer empty / same as title. */
    detail: string;
    /** Single-line tooltip. */
    tooltip: string;
    tokens?: number;
};

/** Parse a catalog context window ("400K", "1M") into tokens. */
function contextWindowTokens(selectedModel: string): number {
    const raw = modelOption(selectedModel).contextWindow.trim().toUpperCase();
    if (!raw) return 0;
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value) || value <= 0) return 0;
    if (raw.endsWith("M")) return Math.round(value * 1_000_000);
    if (raw.endsWith("K")) return Math.round(value * 1_000);
    return Math.round(value);
}

/** Age after which the last turn's figure is history, not live feedback. */
export const LAST_TURN_TTL_MS = 15 * 60 * 1000;

/**
 * The composer ring shows the last turn's share of the model's context window.
 * There is no account budget to display any more — you pay your provider directly.
 *
 * `now` is injectable so the TTL is testable without touching the clock.
 */
export function resolveChatUsageDisplay(
    selectedModel: string,
    lastTurn?: LastTurnUsage | null,
    now: number = Date.now(),
): ChatUsageDisplay {
    const fresh =
        lastTurn && Number.isFinite(lastTurn.at) && now - lastTurn.at <= LAST_TURN_TTL_MS
            ? lastTurn
            : null;
    const tokens = fresh?.tokens ?? 0;
    if (tokens <= 0) {
        return {
            mode: "tokens",
            percent: 0,
            title: "",
            detail: "",
            tooltip: "Token usage appears after the first reply",
        };
    }
    const window = contextWindowTokens(selectedModel);
    const percent = window > 0 ? Math.min(100, Math.round((tokens / window) * 100)) : 0;
    const title = `${tokens.toLocaleString()} tokens`;
    return {
        mode: "tokens",
        percent,
        title,
        detail: title,
        tooltip:
            window > 0
                ? `${title} · ${percent}% of the ${modelOption(selectedModel).contextWindow} context window`
                : `${title} in the last turn`,
        tokens,
    };
}
