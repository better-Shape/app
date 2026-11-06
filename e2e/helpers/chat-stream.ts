import type { Page } from "@playwright/test";

/** The conversation the `project` seed opens (`get_current_conversation_id` in lib/preview/tauri-mock.ts). */
const SEEDED_CONVERSATION = "preview-conversation";

/**
 * Streams markdown into the seeded conversation as one assistant turn, through the preview
 * event bridge (`plugin:event|emit`) that carries the backend's own `chat_started` and
 * `chat_token` events. The turn id has the native `<sequence>:<id>` shape `TurnOrder` admits.
 * The text starts on a fresh block, so it never runs into the seeded answer before it.
 */
export const streamAssistantMarkdown = (page: Page, markdown: string, sequence = 1) =>
    page.evaluate(
        async ({ chunk, conversationId, turnId }) => {
            const { invoke } = (window as unknown as {
                __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> };
            }).__TAURI_INTERNALS__;
            await invoke("plugin:event|emit", { event: "chat_started", payload: { turnId, conversationId } });
            await invoke("plugin:event|emit", { event: "chat_token", payload: { chunk, turnId, conversationId } });
        },
        { chunk: `\n\n${markdown}\n`, conversationId: SEEDED_CONVERSATION, turnId: `${sequence}:e2e` },
    );
