"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import {
    effortDisplayLabel,
    effortsForModel,
    type ReasoningEffort,
} from "./reasoning-effort";
import styles from "./thinking-bar.module.css";

function clamp(n: number, max: number) {
    return Math.max(0, Math.min(max, n));
}

export function ThinkingEffortControl({
    effort,
    modelId,
    onChange,
    disabled,
}: {
    effort: ReasoningEffort;
    modelId: string;
    onChange: (effort: ReasoningEffort) => void;
    disabled?: boolean;
}) {
    const options = effortsForModel(modelId);
    const fallbackEffort = options.at(-1)?.value ?? effort;
    const selected = options.some((stop) => stop.value === effort) ? effort : fallbackEffort;
    const index = Math.max(0, options.findIndex((stop) => stop.value === selected));
    const maxIndex = Math.max(0, options.length - 1);
    const [dragPos, setDragPos] = useState<number | null>(null);
    const pointerCancelled = useRef(false);
    const pos = dragPos ?? index;
    const fill = maxIndex === 0 ? 1 : pos / maxIndex;
    const shown = options.at(clamp(Math.round(pos), maxIndex)) ?? options.at(index) ?? { value: selected, label: selected, description: "" };

    // A new effort level (from the model or a click) ends any drag in progress.
    const [seenIndex, setSeenIndex] = useState(index);
    if (index !== seenIndex) {
        setSeenIndex(index);
        setDragPos(null);
    }

    const settle = (raw: number) => {
        const n = clamp(raw, maxIndex);
        const nearest = Math.round(n);
        return Math.abs(n - nearest) <= 0.2 ? nearest : n;
    };

    const commit = (raw: number) => {
        const snapped = clamp(Math.round(raw), maxIndex);
        setDragPos(snapped);
        const next = options[snapped];
        if (next && next.value !== selected) onChange(next.value);
        else setDragPos(null);
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="xs"
                    disabled={disabled}
                    className="h-8 pl-0 font-normal text-text-muted hover:text-text-primary hover:bg-transparent"
                    aria-label={`Thinking ${effortDisplayLabel(selected)}`}
                >
                    <span className="text-sm">{effortDisplayLabel(selected)}</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="end"
                className="w-66"
                onCloseAutoFocus={(event) => event.preventDefault()}
            >
                <div
                    className="flex flex-col gap-3 px-2.5 pb-5 pt-1"
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <div className="flex h-5 items-center justify-center overflow-hidden">
                        <span className="text-sm text-text-primary">
                            {effortDisplayLabel(shown.value)}
                        </span>
                    </div>
                    <div className="relative h-[35px]">
                        <div className="absolute inset-x-[1.5px] top-1/2 h-[35px] -translate-y-1/2 overflow-hidden rounded-full bg-panel-hover">
                            <div className={`relative h-full overflow-hidden ${dragPos !== null ? styles.isDragging : ""}`}>
                                <div
                                    className={styles.fill}
                                    style={{ transform: `scaleX(${fill})` }}
                                />
                            </div>
                        </div>
                        {options.length > 1 ? (
                            <div className="pointer-events-none absolute inset-x-[20.5px] top-1/2 h-[15px] -translate-y-1/2">
                                {options.map((stop, i) => (
                                    <span
                                        key={stop.value}
                                        className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/65"
                                        style={{ left: `${(i / maxIndex) * 100}%` }}
                                    />
                                ))}
                            </div>
                        ) : null}
                        <input
                            type="range"
                            min={0}
                            max={maxIndex}
                            step={0.001}
                            value={pos}
                            disabled={disabled || options.length <= 1}
                            aria-label="Thinking level"
                            aria-valuetext={effortDisplayLabel(shown.value)}
                            onChange={(event) => setDragPos(settle(Number(event.target.value)))}
                            onPointerDown={() => {
                                pointerCancelled.current = false;
                            }}
                            onPointerUp={(event) => {
                                if (pointerCancelled.current) return;
                                commit(Number(event.currentTarget.value));
                            }}
                            onPointerCancel={() => {
                                pointerCancelled.current = true;
                                setDragPos(null);
                            }}
                            onKeyUp={(event) => {
                                pointerCancelled.current = false;
                                if (
                                    event.key === "ArrowLeft" ||
                                    event.key === "ArrowRight" ||
                                    event.key === "ArrowUp" ||
                                    event.key === "ArrowDown" ||
                                    event.key === "Home" ||
                                    event.key === "End"
                                ) {
                                    commit(Number(event.currentTarget.value));
                                }
                            }}
                            onBlur={(event) => {
                                if (pointerCancelled.current) {
                                    pointerCancelled.current = false;
                                    setDragPos(null);
                                    return;
                                }
                                commit(Number(event.currentTarget.value));
                            }}
                            className={`${styles.range} absolute inset-x-0 top-1/2 w-full -translate-x-0.5 -translate-y-1/2 cursor-pointer`}
                        />
                    </div>
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
