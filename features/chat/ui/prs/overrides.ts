"use client";

/**
 * Optimistic row overrides.
 *
 * A close or merge leaves the host list saying "open" until the next read comes
 * back, so the row is told what it is about to be the moment the button is
 * pressed. The host is given a trust window to catch up; after that the read
 * wins again even if it still disagrees.
 */

import { useSyncExternalStore } from "react";
import type { PrItem } from "./mapping";

export const PR_OVERRIDE_TRUST_MS = 60_000;

const SWEEP_INTERVAL_MS = 5_000;
const MAX_PENDING = 200;

export type PrOverridePatch = {
    status?: string;
    draft?: boolean;
};

type PrOverrideEntry = PrOverridePatch & { expiresAt: number };

let entries = new Map<string, PrOverrideEntry>();
let version = 0;
let timer: ReturnType<typeof setInterval> | null = null;

const listeners = new Set<() => void>();

function emit() {
    version += 1;
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function stopTimer() {
    if (timer !== null) {
        clearInterval(timer);
        timer = null;
    }
}

function startTimer() {
    if (timer !== null) return;
    timer = setInterval(() => {
        sweepPrOverrides();
    }, SWEEP_INTERVAL_MS);
}

export function applyPrOverride(id: string, patch: PrOverridePatch, now = Date.now()): void {
    const previous = entries.get(id);
    const next = new Map(entries);
    if (next.size >= MAX_PENDING && !previous) {
        let oldestKey: string | null = null;
        let oldest = Number.POSITIVE_INFINITY;
        for (const [key, entry] of next) {
            if (entry.expiresAt < oldest) {
                oldest = entry.expiresAt;
                oldestKey = key;
            }
        }
        if (oldestKey !== null) next.delete(oldestKey);
    }
    next.set(id, { ...previous, ...patch, expiresAt: now + PR_OVERRIDE_TRUST_MS });
    entries = next;
    emit();
    startTimer();
}

export function clearPrOverride(id: string): void {
    if (!entries.has(id)) return;
    const next = new Map(entries);
    next.delete(id);
    entries = next;
    emit();
    if (next.size === 0) stopTimer();
}

function isFresh(entry: PrOverrideEntry, now: number): boolean {
    return entry.expiresAt > now;
}

/**
 * Drop an override as soon as a read agrees with it, so the row does not keep a
 * stale local patch on top of data the host has already confirmed.
 */
export function settlePrOverrides(items: PrItem[], now = Date.now()): void {
    let changed = false;
    const next = new Map(entries);
    for (const [id, entry] of next) {
        const observed = items.find((item) => item.id === id);
        const agrees =
            !isFresh(entry, now) ||
            (observed !== undefined &&
                (entry.status === undefined || observed.status === entry.status) &&
                (entry.draft === undefined || Boolean(observed.draft) === entry.draft));
        if (agrees) {
            next.delete(id);
            changed = true;
        }
    }
    if (!changed) return;
    entries = next;
    emit();
    if (next.size === 0) stopTimer();
}

export function sweepPrOverrides(now = Date.now()): void {
    let changed = false;
    const next = new Map<string, PrOverrideEntry>();
    for (const [id, entry] of entries) {
        if (isFresh(entry, now)) next.set(id, entry);
        else changed = true;
    }
    if (!changed) return;
    entries = next;
    emit();
    if (next.size === 0) stopTimer();
}

function freshEntry(id: string, now: number): PrOverrideEntry | null {
    const entry = entries.get(id);
    return entry && isFresh(entry, now) ? entry : null;
}

/** Pure read: an expired entry is simply ignored. No mutation, safe during render. */
export function readPrOverride(id: string, now = Date.now()): PrOverridePatch | null {
    const entry = freshEntry(id, now);
    return entry ? { status: entry.status, draft: entry.draft } : null;
}

export function applyPrOverrides(items: PrItem[], now = Date.now()): PrItem[] {
    let changed = false;
    const out = items.map((item) => {
        const override = freshEntry(item.id, now);
        if (!override) return item;
        const status = override.status ?? item.status;
        const draft = override.draft ?? item.draft;
        if (status === item.status && draft === item.draft) return item;
        changed = true;
        return { ...item, status, draft };
    });
    return changed ? out : items;
}

export function pendingPrOverrideCount(): number {
    return entries.size;
}

/** Bumps when an override is written, cleared, settled or swept. */
export function usePrOverridesVersion(): number {
    return useSyncExternalStore(
        subscribe,
        () => version,
        () => version,
    );
}