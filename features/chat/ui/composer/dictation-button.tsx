"use client";

import { MicPulse20Regular } from "@fluentui/react-icons/headless/svg/mic-pulse";
import { Arc } from "loading-dev";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { commands } from "@/lib/backend";
import { notificationStore } from "@/features/notifications";
import { useSettings, microphoneConstraints } from "@/lib/settings";
import { Icon } from "@/components/ui/icon";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
    startDictation,
    type DictationHandlers,
    type DictationSession,
    type DictationState,
} from "@/lib/editor/dictation";

/** Formats recording elapsed seconds as `m:ss`. */
const formatElapsed = (sec: number): string => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
};

/** Subscribes to a Tauri event while safely falling back to a no-op outside the desktop bridge. */
const safeListen = <T,>(
    eventName: string,
    handler: (event: { payload: T }) => void,
): Promise<() => void> =>
    Promise.resolve()
        .then(() => listen<T>(eventName, handler))
        .catch(() => () => undefined);

/** Registers an async event listener onto `unlisteners`, or disposes immediately if unmounted. */
const attachSafeListener = <T,>(
    eventName: string,
    handler: (event: { payload: T }) => void,
    isCancelled: () => boolean,
    unlisteners: Array<() => void>,
): void => {
    safeListen<T>(eventName, handler)
        .then((stop) => {
            if (isCancelled()) stop();
            else unlisteners.push(stop);
        })
        .catch(() => {
            /* ignore listener setup failures */
        });
};

type DictationRefs = {
    session: React.MutableRefObject<DictationSession | null>;
    startingRef: React.MutableRefObject<boolean>;
    processingRef: React.MutableRefObject<boolean>;
    startAttemptIdRef: React.MutableRefObject<number>;
    abortRef: React.MutableRefObject<AbortController | null>;
};

/** Checks whether dictation currently owns an active session, startup, or recognizer push. */
const hasPendingOrActiveDictation = (refs: DictationRefs): boolean =>
    refs.session.current !== null ||
    refs.startingRef.current ||
    refs.processingRef.current;

/** Cancels in-flight startup or processing bookkeeping on `refs` and stops any processing push. */
const abortPendingDictationPhases = (
    refs: DictationRefs,
    setIsStarting: React.Dispatch<React.SetStateAction<boolean>>,
): void => {
    refs.abortRef.current?.abort();
    refs.abortRef.current = null;
    if (refs.startingRef.current || refs.processingRef.current) {
        refs.startAttemptIdRef.current += 1;
        refs.startingRef.current = false;
        setIsStarting(false);
    }
    if (refs.processingRef.current) {
        refs.processingRef.current = false;
        commands.dictationStop().catch(() => {
            /* ignore recognizer teardown errors */
        });
    }
};

type DictationUiSetters = {
    setState: React.Dispatch<React.SetStateAction<DictationState>>;
    setIsStarting: React.Dispatch<React.SetStateAction<boolean>>;
    setLevel: React.Dispatch<React.SetStateAction<number>>;
    setElapsedSec: React.Dispatch<React.SetStateAction<number>>;
};

/** Handles a `dictation-text` backend event by stopping the recognizer and dispatching text. */
const handleRecognizedDictationEvent = (
    rawText: string | undefined,
    refs: DictationRefs,
    ui: DictationUiSetters,
): void => {
    const text = rawText?.trim();
    refs.processingRef.current = false;
    commands.dictationStop().catch(() => {
        /* ignore recognizer teardown errors */
    });
    ui.setState("idle");
    ui.setLevel(0);
    if (!text) return;
    window.dispatchEvent(
        new CustomEvent("bettershape-dictation-text", { detail: { text } }),
    );
};

/** Handles a `dictation-error` backend event by tearing down active capture and surfacing an error. */
const handleBackendDictationError = (
    rawMessage: string | undefined,
    refs: DictationRefs,
    ui: DictationUiSetters,
): void => {
    const message = rawMessage?.trim();
    if (message) notificationStore.add(message, "error");
    refs.abortRef.current?.abort();
    refs.abortRef.current = null;
    refs.startAttemptIdRef.current += 1;
    refs.startingRef.current = false;
    refs.processingRef.current = false;
    ui.setIsStarting(false);
    refs.session.current?.dispose();
    refs.session.current = null;
    ui.setState("error");
    ui.setLevel(0);
};

/** Subscribes to `dictation-text` and `dictation-error` backend events for the lifetime of the control. */
const useDictationIpcListeners = (
    refs: DictationRefs,
    ui: DictationUiSetters,
    dispose: () => void,
): void => {
    useEffect(() => {
        let cancelled = false;
        const unlisteners: Array<() => void> = [];
        const isCancelled = (): boolean => cancelled;

        attachSafeListener<string>(
            "dictation-text",
            (event) => handleRecognizedDictationEvent(event.payload, refs, ui),
            isCancelled,
            unlisteners,
        );
        attachSafeListener<string>(
            "dictation-error",
            (event) => handleBackendDictationError(event.payload, refs, ui),
            isCancelled,
            unlisteners,
        );

        return () => {
            cancelled = true;
            for (const stop of unlisteners) stop();
            dispose();
        };
    }, [dispose, refs, ui]);
};

/** Starts an elapsed-seconds interval while `isListening` is active, returning its timer ID. */
const startListeningTimer = (
    isListening: boolean,
    setElapsedSec: React.Dispatch<React.SetStateAction<number>>,
): number | null => {
    if (!isListening) return null;
    const started = Date.now();
    return window.setInterval(() => {
        setElapsedSec(Math.floor((Date.now() - started) / 1000));
    }, 500);
};

/** Starts a 10-second safety timeout while `isProcessing` is active, returning its timer ID. */
const startProcessingSafetyTimeout = (
    isProcessing: boolean,
    dispose: () => void,
): number | null =>
    isProcessing ? window.setTimeout(dispose, 10_000) : null;

/** Clears nullable `intervalId` and `timeoutId` browser timers. */
const clearOptionalTimers = (
    intervalId: number | null,
    timeoutId: number | null,
): void => {
    if (intervalId !== null) window.clearInterval(intervalId);
    if (timeoutId !== null) window.clearTimeout(timeoutId);
};

/** Wires elapsed timer, processing watchdog, and Escape-to-cancel capture listener. */
const useDictationTimersAndEscape = (
    flags: { isListening: boolean; isStarting: boolean; isProcessing: boolean },
    refs: DictationRefs,
    setElapsedSec: React.Dispatch<React.SetStateAction<number>>,
    dispose: () => void,
): void => {
    const { isListening, isStarting, isProcessing } = flags;
    useEffect(() => {
        if (!isListening && !isStarting && !isProcessing) return undefined;
        const timer = startListeningTimer(isListening, setElapsedSec);
        const processingTimeout = startProcessingSafetyTimeout(
            isProcessing,
            dispose,
        );
        const onKey = (event: KeyboardEvent): void => {
            if (event.key !== "Escape" || !hasPendingOrActiveDictation(refs)) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            dispose();
        };
        window.addEventListener("keydown", onKey, true);
        return () => {
            clearOptionalTimers(timer, processingTimeout);
            window.removeEventListener("keydown", onKey, true);
        };
    }, [dispose, isListening, isProcessing, isStarting, refs, setElapsedSec]);
};

/** Builds attempt-scoped `DictationHandlers` carrying `signal` for cancellation safety. */
const buildAttemptDictationHandlers = (
    attemptId: number,
    signal: AbortSignal,
    refs: DictationRefs,
    ui: DictationUiSetters,
): DictationHandlers => ({
    signal,
    onText: (text) => {
        if (refs.startAttemptIdRef.current !== attemptId) return;
        refs.processingRef.current = false;
        ui.setState("idle");
        ui.setLevel(0);
        window.dispatchEvent(
            new CustomEvent("bettershape-dictation-text", { detail: { text } }),
        );
    },
    onError: (message) => {
        if (refs.startAttemptIdRef.current !== attemptId) return;
        refs.processingRef.current = false;
        notificationStore.add(message, "error");
    },
    onState: (next) => {
        if (refs.startAttemptIdRef.current !== attemptId) return;
        refs.processingRef.current = next === "processing";
        ui.setState(next);
    },
    onLevel: (next) => {
        if (refs.startAttemptIdRef.current === attemptId) ui.setLevel(next);
    },
    onMaxDurationReached: () => {
        if (refs.startAttemptIdRef.current !== attemptId) return;
        refs.session.current = null;
        ui.setLevel(0);
        ui.setElapsedSec(0);
        notificationStore.add(
            "Dictation limit reached",
            "info",
            "Reached the 5-minute recording limit. Transcribing your speech now.",
        );
    },
});

const DICTATION_IPC_BRIDGE = {
    start: () => commands.dictationStart(),
    stop: () => commands.dictationStop(),
    push: (wav: number[]) => commands.dictationPush(wav),
};

/** Resolves the accessible button/tooltip label from current dictation flags. */
const resolveDictationLabel = (flags: {
    isStarting: boolean;
    isListening: boolean;
    isProcessing: boolean;
}): string => {
    if (flags.isStarting) return "Cancel microphone start";
    if (flags.isListening) return "Stop dictation";
    return flags.isProcessing ? "Cancel dictation" : "Dictate";
};

/** Renders the live three-bar RMS waveform + elapsed timer while listening. */
const ListeningWaveformBadge = ({
    level,
    elapsedSec,
}: {
    level: number;
    elapsedSec: number;
}): React.ReactElement => {
    const barA = Math.round(4 + Math.min(1, level * 0.85 + 0.18) * 8);
    const barB = Math.round(5 + Math.min(1, level * 1.15 + 0.28) * 9);
    const barC = Math.round(4 + Math.min(1, level * 0.75 + 0.15) * 8);
    const barClass =
        "w-[2px] rounded-full bg-current transition-[height] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] motion-reduce:transition-none";
    return (
        <>
            <span className="flex h-3.5 items-center gap-[2px]" aria-hidden>
                <span
                    className={cn(barClass, "motion-reduce:h-2")}
                    style={{ height: `${barA}px` }}
                />
                <span
                    className={cn(barClass, "motion-reduce:h-3")}
                    style={{ height: `${barB}px` }}
                />
                <span
                    className={cn(barClass, "motion-reduce:h-2")}
                    style={{ height: `${barC}px` }}
                />
            </span>
            <span className="text-2xs font-medium tabular-nums">
                {formatElapsed(elapsedSec)}
            </span>
        </>
    );
};

/** Selects the inner icon/spinner/waveform content for `DictationButton`. */
const renderDictationButtonBody = (
    isProcessing: boolean,
    isListening: boolean,
    level: number,
    elapsedSec: number,
): React.ReactElement => {
    if (isProcessing) return <Arc size={15} />;
    if (isListening) {
        return <ListeningWaveformBadge level={level} elapsedSec={elapsedSec} />;
    }
    return <Icon icon={MicPulse20Regular} />;
};

/** Commits an active session or cancels pending startup/processing; returns `true` when handled. */
const tryFinishOrCancelExistingAttempt = (
    refs: DictationRefs,
    ui: DictationUiSetters,
    dispose: () => void,
): boolean => {
    if (refs.session.current) {
        refs.session.current.commit();
        refs.session.current = null;
        ui.setLevel(0);
        ui.setElapsedSec(0);
        return true;
    }
    if (refs.startingRef.current || refs.processingRef.current) {
        dispose();
        return true;
    }
    return false;
};

/** Starts a fresh microphone dictation attempt and binds the resulting session when still current. */
const beginNewDictationAttempt = async (
    deviceId: string,
    refs: DictationRefs,
    ui: DictationUiSetters,
): Promise<void> => {
    refs.abortRef.current?.abort();
    const controller = new AbortController();
    refs.abortRef.current = controller;
    ui.setElapsedSec(0);
    refs.startingRef.current = true;
    const attemptId = (refs.startAttemptIdRef.current += 1);
    ui.setIsStarting(true);
    try {
        const active = await startDictation(
            buildAttemptDictationHandlers(attemptId, controller.signal, refs, ui),
            microphoneConstraints(deviceId),
            DICTATION_IPC_BRIDGE,
        );
        if (refs.startAttemptIdRef.current !== attemptId) {
            active.dispose();
            return;
        }
        refs.startingRef.current = false;
        ui.setIsStarting(false);
        refs.session.current = active;
    } catch {
        if (refs.startAttemptIdRef.current === attemptId) {
            refs.startingRef.current = false;
            refs.processingRef.current = false;
            ui.setIsStarting(false);
        }
    }
};

/** Resolves `"Esc to cancel"` shortcut hint whenever dictation is starting, listening, or processing. */
const resolveDictationShortcutHint = (flags: {
    isStarting: boolean;
    isListening: boolean;
    isProcessing: boolean;
}): string | undefined =>
    flags.isStarting || flags.isListening || flags.isProcessing
        ? "Esc to cancel"
        : undefined;

/**
 * Records one utterance and hands it to the system recognizer, which answers with a
 * `dictation-text` event carrying the recognized string.
 *
 * Pressing Escape while listening cancels capture cleanly without touching existing
 * composer text.
 */
const DictationButtonInner = (): React.ReactElement => {
    const settings = useSettings();
    const [state, setState] = useState<DictationState>("idle");
    const [isStarting, setIsStarting] = useState(false);
    const [level, setLevel] = useState(0);
    const [elapsedSec, setElapsedSec] = useState(0);
    const session = useRef<DictationSession | null>(null);
    const startingRef = useRef(false);
    const processingRef = useRef(false);
    const startAttemptIdRef = useRef(0);
    const abortRef = useRef<AbortController | null>(null);

    const refs = React.useMemo<DictationRefs>(
        () => ({ session, startingRef, processingRef, startAttemptIdRef, abortRef }),
        [],
    );
    const ui = React.useMemo<DictationUiSetters>(
        () => ({ setState, setIsStarting, setLevel, setElapsedSec }),
        [],
    );

    const dispose = useCallback(() => {
        const currentRefs: DictationRefs = {
            session,
            startingRef,
            processingRef,
            startAttemptIdRef,
            abortRef,
        };
        const hadActive = hasPendingOrActiveDictation(currentRefs);
        abortPendingDictationPhases(currentRefs, setIsStarting);
        session.current?.dispose();
        session.current = null;
        setLevel(0);
        setElapsedSec(0);
        if (hadActive) setState("idle");
    }, []);

    useDictationIpcListeners(refs, ui, dispose);

    const isListening = state === "listening" && !isStarting;
    const isProcessing = state === "processing";
    const phaseFlags = { isStarting, isListening, isProcessing };
    useDictationTimersAndEscape(phaseFlags, refs, setElapsedSec, dispose);

    const toggle = useCallback(async () => {
        if (tryFinishOrCancelExistingAttempt(refs, ui, dispose)) return;
        await beginNewDictationAttempt(settings.voice.deviceId, refs, ui);
    }, [dispose, refs, settings.voice.deviceId, ui]);

    const label = resolveDictationLabel(phaseFlags);
    const shortcutHint = resolveDictationShortcutHint(phaseFlags);

    return (
        <Tooltip content={label} shortcut={shortcutHint}>
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
                {renderDictationButtonBody(isProcessing, isListening, level, elapsedSec)}
            </button>
        </Tooltip>
    );
};

export const DictationButton = memo(DictationButtonInner);
