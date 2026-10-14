"use client";

import { MicPulse20Regular } from "@fluentui/react-icons/headless/svg/mic-pulse";
import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { commands } from "@/lib/backend";
import { notificationStore } from "@/features/notifications";
import { useSettings, microphoneConstraints } from "@/lib/settings";
import { Icon } from "@/components/ui/icon";
import { Tooltip } from "@/components/ui/tooltip";
import {
    startDictation,
    type DictationSession,
    type DictationState,
} from "@/lib/editor/dictation";

/**
 * Records one utterance and hands it to the system recognizer, which answers with a
 * `dictation-text` event carrying the recognized string.
 *
 * The text is re-broadcast as `bettershape-dictation-text` so the composer can insert
 * it at the caret without this component needing to know anything about the composer.
 */
export function DictationButton() {
    const settings = useSettings();
    const [state, setState] = useState<DictationState>("idle");
    const session = useRef<DictationSession | null>(null);

    const dispose = useCallback(() => {
        session.current?.dispose();
        session.current = null;
    }, []);

    useEffect(() => {
        let cancelled = false;
        const unlisteners: (() => void)[] = [];

        void listen<string>("dictation-text", (event) => {
            const text = event.payload?.trim();
            if (!text) return;
            window.dispatchEvent(
                new CustomEvent("bettershape-dictation-text", { detail: { text } }),
            );
        })
            .then((stop) => {
                if (cancelled) stop();
                else unlisteners.push(stop);
            })
            .catch(() => {
                /* the event bridge is unavailable outside a Tauri window */
            });

        void listen<string>("dictation-error", (event) => {
            const message = event.payload?.trim();
            if (message) notificationStore.add(message, "error");
            setState("error");
        })
            .then((stop) => {
                if (cancelled) stop();
                else unlisteners.push(stop);
            })
            .catch(() => {
                /* see above */
            });

        return () => {
            cancelled = true;
            for (const stop of unlisteners) stop();
            dispose();
        };
    }, [dispose]);

    const toggle = useCallback(async () => {
        if (session.current) {
            session.current.commit();
            session.current = null;
            return;
        }
        try {
            const active = await startDictation(
                {
                    onText: (text) => {
                        window.dispatchEvent(
                            new CustomEvent("bettershape-dictation-text", { detail: { text } }),
                        );
                    },
                    onError: (message) => notificationStore.add(message, "error"),
                    onState: setState,
                },
                microphoneConstraints(settings.voice.deviceId),
                {
                    start: () => commands.dictationStart(),
                    stop: () => commands.dictationStop(),
                    push: (wav) => commands.dictationPush(wav),
                },
            );
            session.current = active;
        } catch {
            // `startDictation` has already surfaced the reason; the state is "error".
        }
    }, [settings.voice.deviceId]);

    const label =
        state === "listening"
            ? "Stop dictation"
            : state === "processing"
              ? "Processing dictation…"
              : "Dictate";

    return (
        <Tooltip content={label}>
            <button
                type="button"
                aria-label={label}
                aria-pressed={state === "listening"}
                disabled={state === "processing"}
                onClick={() => void toggle()}
                className={
                    state === "listening"
                        ? "flex size-7 shrink-0 items-center justify-center rounded-md bg-error/15 text-error"
                        : "flex size-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-panel-hover hover:text-text-primary disabled:opacity-50"
                }
            >
                <Icon icon={MicPulse20Regular} className={state === "listening" ? "animate-pulse" : undefined} />
            </button>
        </Tooltip>
    );
}