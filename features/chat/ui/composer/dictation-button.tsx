"use client";

import { MicPulse20Regular } from "@fluentui/react-icons/headless/svg/mic-pulse";
import { Arc } from "loading-dev";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { commands } from "@/lib/backend";
import { notificationStore } from "@/features/notifications";
import { useSettings, microphoneConstraints } from "@/lib/settings";
import { Icon } from "@/components/ui/icon";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
    startDictation,
    type DictationSession,
    type DictationState,
} from "@/lib/editor/dictation";

function formatElapsed(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

function safeListen<T>(
    eventName: string,
    handler: (event: { payload: T }) => void,
): Promise<() => void> {
    try {
        return listen<T>(eventName, handler).catch(() => () => {});
    } catch {
        return Promise.resolve(() => {});
    }
}

/**
 * Records one utterance and hands it to the system recognizer, which answers with a
 * `dictation-text` event carrying the recognized string.
 *
 * Pressing Escape while listening cancels capture cleanly without touching existing
 * composer text.
 */
export const DictationButton = memo(function DictationButton() {
    const settings = useSettings();
    const [state, setState] = useState<DictationState>("idle");
    const [isStarting, setIsStarting] = useState(false);
    const [level, setLevel] = useState(0);
    const [elapsedSec, setElapsedSec] = useState(0);
    const session = useRef<DictationSession | null>(null);
    const startingRef = useRef(false);
    const processingRef = useRef(false);
    const startAttemptIdRef = useRef(0);

    const dispose = useCallback(() => {
        const hadActiveOrPending =
            session.current !== null || startingRef.current || processingRef.current;
        if (startingRef.current || processingRef.current) {
            startAttemptIdRef.current += 1;
            startingRef.current = false;
            setIsStarting(false);
        }
        if (processingRef.current) {
            processingRef.current = false;
            commands.dictationStop().catch(() => {
                /* ignore recognizer teardown errors */
            });
        }
        session.current?.dispose();
        session.current = null;
        setLevel(0);
        setElapsedSec(0);
        if (hadActiveOrPending) {
            setState("idle");
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        const unlisteners: (() => void)[] = [];

        safeListen<string>("dictation-text", (event) => {
            const text = event.payload?.trim();
            processingRef.current = false;
            commands.dictationStop().catch(() => {
                /* ignore recognizer teardown errors */
            });
            setState("idle");
            setLevel(0);
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
                /* ignore listener setup failures */
            });

        safeListen<string>("dictation-error", (event) => {
            const message = event.payload?.trim();
            if (message) notificationStore.add(message, "error");
            startAttemptIdRef.current += 1;
            startingRef.current = false;
            processingRef.current = false;
            setIsStarting(false);
            session.current?.dispose();
            session.current = null;
            setState("error");
            setLevel(0);
        })
            .then((stop) => {
                if (cancelled) stop();
                else unlisteners.push(stop);
            })
            .catch(() => {
                /* ignore listener setup failures */
            });

        return () => {
            cancelled = true;
            for (const stop of unlisteners) stop();
            dispose();
        };
    }, [dispose]);

    const isListening = state === "listening" && !isStarting;
    const isProcessing = state === "processing";

    useEffect(() => {
        if (!isListening && !isStarting && !isProcessing) return undefined;
        const started = Date.now();
        const timer = isListening
            ? window.setInterval(() => {
                  setElapsedSec(Math.floor((Date.now() - started) / 1000));
              }, 500)
            : null;
        const processingTimeout = isProcessing
            ? window.setTimeout(() => {
                  dispose();
              }, 10_000)
            : null;
        const onKey = (event: KeyboardEvent) => {
            if (
                event.key === "Escape"
                && (session.current || startingRef.current || processingRef.current)
            ) {
                event.preventDefault();
                event.stopPropagation();
                dispose();
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => {
            if (timer !== null) window.clearInterval(timer);
            if (processingTimeout !== null) window.clearTimeout(processingTimeout);
            window.removeEventListener("keydown", onKey, true);
        };
    }, [isListening, isStarting, isProcessing, dispose]);

    const toggle = useCallback(async () => {
        if (session.current) {
            session.current.commit();
            session.current = null;
            setLevel(0);
            setElapsedSec(0);
            return;
        }
        if (startingRef.current || processingRef.current) {
            dispose();
            return;
        }
        setElapsedSec(0);
        startingRef.current = true;
        const attemptId = ++startAttemptIdRef.current;
        setIsStarting(true);
        try {
            const active = await startDictation(
                {
                    onText: (text) => {
                        if (startAttemptIdRef.current !== attemptId) return;
                        processingRef.current = false;
                        setState("idle");
                        setLevel(0);
                        window.dispatchEvent(
                            new CustomEvent("bettershape-dictation-text", { detail: { text } }),
                        );
                    },
                    onError: (message) => {
                        if (startAttemptIdRef.current !== attemptId) return;
                        processingRef.current = false;
                        notificationStore.add(message, "error");
                    },
                    onState: (next) => {
                        if (startAttemptIdRef.current !== attemptId) return;
                        processingRef.current = next === "processing";
                        setState(next);
                    },
                    onLevel: (next) => {
                        if (startAttemptIdRef.current === attemptId) setLevel(next);
                    },
                },
                microphoneConstraints(settings.voice.deviceId),
                {
                    start: () => commands.dictationStart(),
                    stop: () => commands.dictationStop(),
                    push: (wav) => commands.dictationPush(wav),
                },
            );
            if (startAttemptIdRef.current !== attemptId) {
                active.dispose();
                return;
            }
            startingRef.current = false;
            setIsStarting(false);
            session.current = active;
        } catch {
            if (startAttemptIdRef.current === attemptId) {
                startingRef.current = false;
                processingRef.current = false;
                setIsStarting(false);
            }
            // `startDictation` has already surfaced the reason; the state is "error".
        }
    }, [dispose, settings.voice.deviceId]);

    const label = isStarting
        ? "Cancel microphone start"
        : isListening
          ? "Stop dictation"
          : isProcessing
            ? "Cancel dictation"
            : "Dictate";

    const barA = Math.round(4 + Math.min(1, level * 0.85 + 0.18) * 8);
    const barB = Math.round(5 + Math.min(1, level * 1.15 + 0.28) * 9);
    const barC = Math.round(4 + Math.min(1, level * 0.75 + 0.15) * 8);

    return (
        <Tooltip
            content={label}
            shortcut={isListening || isProcessing ? "Esc to cancel" : undefined}
        >
            <button
                type="button"
                aria-label={label}
                aria-pressed={isListening}
                onClick={() => {
                    toggle().catch(() => {
                        /* ignore toggle rejections */
                    });
                }}
                className={cn(
                    "flex h-[32px] shrink-0 items-center justify-center rounded-full transition-[background-color,color,padding,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] motion-reduce:transform-none motion-reduce:transition-none enabled:active:scale-[0.96] disabled:opacity-50",
                    isListening
                        ? "gap-1.5 bg-error/15 px-2.5 text-error hover:bg-error/22"
                        : "w-[32px] text-text-muted hover:bg-[var(--btn-hover)] hover:text-text-primary",
                )}
            >
                {isProcessing ? (
                    <Arc size={15} />
                ) : isListening ? (
                    <>
                        <span className="flex h-3.5 items-center gap-[2px]" aria-hidden>
                            <span
                                className="w-[2px] rounded-full bg-current transition-[height] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] motion-reduce:h-2 motion-reduce:transition-none"
                                style={{ height: `${barA}px` }}
                            />
                            <span
                                className="w-[2px] rounded-full bg-current transition-[height] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] motion-reduce:h-3 motion-reduce:transition-none"
                                style={{ height: `${barB}px` }}
                            />
                            <span
                                className="w-[2px] rounded-full bg-current transition-[height] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] motion-reduce:h-2 motion-reduce:transition-none"
                                style={{ height: `${barC}px` }}
                            />
                        </span>
                        <span className="text-2xs font-medium tabular-nums">
                            {formatElapsed(elapsedSec)}
                        </span>
                    </>
                ) : (
                    <Icon icon={MicPulse20Regular} />
                )}
            </button>
        </Tooltip>
    );
});
