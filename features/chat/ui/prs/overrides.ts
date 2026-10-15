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
export type PrOverrideSnapshot = ReadonlyMap<string, Readonly<PrOverrideEntry>>;

let entries = new Map<string, PrOverrideEntry>();
let timer: ReturnType<typeof setInterval> | null = null;

const listeners = new Set<() => void>();

function emit() {
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

/** Install a new immutable owner, carrying forward only still-trusted fields. */
function writePrOverride(id: string, patch: PrOverridePatch, now: number): PrOverrideEntry {
    const previous = freshEntry(id, now);
    const next = new Map(entries);
    if (next.size >= MAX_PENDING && !next.has(id)) {
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
    const entry = { ...previous, ...patch, expiresAt: now + PR_OVERRIDE_TRUST_MS };
    next.set(id, entry);
    entries = next;
    emit();
    startTimer();
    return entry;
}

/** Apply a fresh trust window after an optimistic or confirmed state change. */
export function applyPrOverride(id: string, patch: PrOverridePatch, now = Date.now()): void {
    writePrOverride(id, patch, now);
}

/** Stage one request's patch; rollback cannot renew old trust or overwrite a newer owner. */
export function stagePrOverride(id: string, patch: PrOverridePatch, now = Date.now()): () => void {
    const previous = freshEntry(id, now);
    const staged = writePrOverride(id, patch, now);
    return () => {
        if (entries.get(id) !== staged) return;
        if (!previous || !isFresh(previous, Date.now())) {
            clearPrOverride(id);
            return;
        }
        entries = new Map(entries).set(id, previous);
        emit();
        startTimer();
    };
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

function freshEntry(id: string, now: number, snapshot: PrOverrideSnapshot = entries): PrOverrideEntry | null {
    const entry = snapshot.get(id);
    return entry && isFresh(entry, now) ? entry : null;
}

/** Pure read: an expired entry is simply ignored. No mutation, safe during render. */
export function readPrOverride(id: string, now = Date.now()): PrOverridePatch | null {
    const entry = freshEntry(id, now);
    return entry ? { status: entry.status, draft: entry.draft } : null;
}

export function applyPrOverrides(items: PrItem[], now = Date.now(), snapshot: PrOverrideSnapshot = entries): PrItem[] {
    let changed = false;
    const out = items.map((item) => {
        const override = freshEntry(item.id, now, snapshot);
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

/** Immutable snapshots make optimistic changes explicit render dependencies. */
export function usePrOverridesSnapshot(): PrOverrideSnapshot {
    return useSyncExternalStore(
        subscribe,
        () => entries,
        () => entries,
    );
}