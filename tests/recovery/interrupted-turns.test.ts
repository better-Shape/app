import { createElement, type ReactElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listenCustomEvent } from "../helpers/events";
import { mockInvoke, type InvokeHandler } from "../helpers/tauri";

import type { TurnJournal } from "@/lib/backend/types";
import {
    describeJournal,
    formatJournalAge,
    InterruptedTurns,
    journalHeading,
    journalKey,
} from "@/features/agent/recovery/interrupted-turns";

/**
 * The backend writes a journal when a turn starts (`send_chat.rs`) and rewrites
 * it as `interrupted` when the user presses Stop (`approvals.rs`). Anything still
 * on disk at the next launch means the last session died mid-turn. These cover
 * the two halves of surfacing that: what the banner may say about a record it
 * barely knows, and that "could not check" is never drawn as "nothing to report".
 *
 * The IPC boundary is mocked rather than the `commands` wrapper, so the wrapper
 * and its command name are exercised. Nothing here checks that name against the
 * Rust side; that agreement comes from reading `conversation.rs`, not from here.
 */

const KNOWN_NOW = "2026-03-10T12:00:00Z";

/** Mirrors what `save_turn_journal` writes; `updated_at` is epoch seconds. */
function journal(over: Partial<TurnJournal> = {}): TurnJournal {
    return {
        conversationId: "9f2c1ab4d3e5f607",
        turnId: "turn-0001",
        projectPath: "/Users/dev/bettershape",
        status: "running",
        updatedAt: Date.parse(KNOWN_NOW) / 1000,
        subagentIds: [],
        note: null,
        ...over,
    };
}

/** Same shape, stamped relative to the wall clock so rendered ages are stable. */
function journalAged(hours: number, over: Partial<TurnJournal> = {}): TurnJournal {
    return journal({ ...over, updatedAt: (Date.now() - hours * 3_600_000) / 1000 });
}

function mount(node: ReactElement) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(node));
    return { host, root };
}

function unmount(root: Root, host: HTMLElement) {
    act(() => root.unmount());
    host.remove();
}

async function pause(ms: number) {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
    });
}

async function waitUntil(predicate: () => boolean, what: string, timeoutMs = 4000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await pause(20);
    }
    throw new Error(`Timed out waiting for ${what}`);
}

function rows(host: HTMLElement): HTMLElement[] {
    return Array.from(host.querySelectorAll<HTMLElement>("[data-interrupted-turn]"));
}

function banner(host: HTMLElement): HTMLElement | null {
    return host.querySelector<HTMLElement>("[data-interrupted-turns]");
}

function buttonIn(row: HTMLElement, labelPrefix: string): HTMLButtonElement {
    const match = Array.from(row.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
        (button.getAttribute("aria-label") ?? "").startsWith(labelPrefix),
    );
    if (!match) throw new Error(`No "${labelPrefix}…" button inside: ${row.textContent}`);
    return match;
}

describe("journal timestamps", () => {
    it("reads updated_at as epoch seconds, not milliseconds", () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date(KNOWN_NOW));
            // The Rust writer is `SystemTime::duration_since(UNIX_EPOCH).as_secs_f64()`,
            // so the value on the wire is seconds. Read as milliseconds these stamps sit
            // ~55 years in the past, which `formatTimeAgo` rejects outright ("-"), so a
            // seconds/milliseconds mix-up cannot land near any expected label.
            //
            // Note on what this does and does not pin: `formatJournalAge` normalises the
            // unit, but so does `formatTimeAgo` itself (`repo-history.ts` calls
            // `toTimestampMs` on its argument), so deleting the call in `formatJournalAge`
            // leaves every assertion here green. What these assertions actually pin is
            // that a seconds value renders as a real age rather than "-"; the unit
            // handling itself is owned and tested by `toTimestampMs`.
            expect(formatJournalAge(Date.parse("2026-03-10T09:00:00Z") / 1000)).toBe("3h ago");
            expect(formatJournalAge(Date.parse("2026-03-10T11:55:00Z") / 1000)).toBe("5m ago");
            expect(formatJournalAge(Date.parse("2026-03-08T12:00:00Z") / 1000)).toBe("2d ago");
            expect(formatJournalAge(Date.parse("2026-03-10T11:59:30Z") / 1000)).toBe("just now");
        } finally {
            vi.useRealTimers();
        }
    });

    it("rejects a timestamp it cannot trust rather than showing a wrong age", () => {
        // The guard in `formatJournalAge` is load-bearing: without it a NaN or a
        // zero stamp reaches `formatTimeAgo`, which substitutes `Date.now()` and
        // reports the record as brand new.
        expect(formatJournalAge(Number.NaN)).toBe("unknown time");
        expect(formatJournalAge(0)).toBe("unknown time");
        expect(formatJournalAge(-1)).toBe("unknown time");
    });

    it("measures elapsed time rather than calendar days, across a DST change", () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date("2026-03-07T11:00:00Z"));
            // 2026-03-08 02:00 local is the US spring-forward instant. The next
            // stamp is 24 real hours later but reads as a different wall clock
            // pair; only elapsed-time arithmetic gives one day.
            expect(formatJournalAge(Date.parse("2026-03-07T11:00:00Z") / 1000)).toBe("just now");
            vi.setSystemTime(new Date("2026-03-08T11:00:00Z"));
            expect(formatJournalAge(Date.parse("2026-03-07T11:00:00Z") / 1000)).toBe("1d ago");
        } finally {
            vi.useRealTimers();
        }
    });

    it("refuses to invent an age for a timestamp it cannot trust", () => {
        for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
            const age = formatJournalAge(bad);
            expect(age).not.toBe("just now");
            expect(age).not.toMatch(/\d/);
        }
    });
});

describe("journal summaries", () => {
    function summaryAt(over: Partial<TurnJournal> = {}) {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date(KNOWN_NOW));
            return describeJournal(journal(over));
        } finally {
            vi.useRealTimers();
        }
    }

    it("names the conversation by id, because no title was recorded", () => {
        expect(journalHeading(journal())).toContain("9f2c1ab4");
        // A short id is shown whole rather than elided.
        expect(journalHeading(journal({ conversationId: "abc" }))).not.toContain("…");
        expect(journalHeading(journal({ conversationId: "abc" }))).toContain("abc");
    });

    it("reports only what the record actually holds", () => {
        const summary = summaryAt({
            projectPath: "/Users/dev/bettershape",
            subagentIds: ["s1", "s2"],
            note: "Stopped by user",
        });
        expect(summary.detail).toContain("bettershape");
        expect(summary.detail).toContain("2 subagents");
        expect(summary.detail).toContain("Stopped by user");
        // The folder name, not the whole machine path.
        expect(summary.detail).not.toContain("/Users/dev");
    });

    it("says nothing extra when the record is bare", () => {
        const summary = summaryAt({ projectPath: null, subagentIds: [], note: null });
        expect(summary.detail).toBeNull();
    });

    it("counts one subagent in the singular and reads the folder off a Windows path", () => {
        expect(summaryAt({ subagentIds: ["s1"] }).detail).toContain("1 subagent");
        expect(summaryAt({ subagentIds: ["s1"] }).detail).not.toContain("1 subagents");
        expect(summaryAt({ projectPath: "C:\\Users\\dev\\bettershape" }).detail).toContain(
            "bettershape",
        );
    });

    it("never renders a bare label for a record with no id or no usable time", () => {
        const summary = summaryAt({ conversationId: "", updatedAt: 0 });
        expect(summary.heading.trim()).not.toBe("Chat");
        expect(summary.age).not.toBe("just now");
    });

    it("keeps two turns of the same conversation on separate rows", () => {
        expect(journalKey(journal({ turnId: "turn-0001" }))).not.toBe(
            journalKey(journal({ turnId: "turn-0002" })),
        );
    });
});

describe("interrupted turns banner", () => {
    let invokes = 0;
    let respond: InvokeHandler = () => [];

    beforeEach(() => {
        invokes = 0;
        respond = () => [];
        window.sessionStorage.clear();
        mockInvoke((cmd, payload) => {
            if (cmd !== "get_open_turn_journals") return undefined;
            invokes += 1;
            return respond(cmd, payload);
        });
    });

    function mountBanner() {
        return mount(createElement(InterruptedTurns));
    }

    it("renders nothing at all once the backend reports no unfinished turns", async () => {
        respond = () => [];
        const { host, root } = mountBanner();
        try {
            await waitUntil(() => invokes > 0, "the check to run");
            await pause(120);
            // Not a message and not an empty box: nothing occupies the layout.
            expect(host.childElementCount).toBe(0);
            expect(host.textContent).toBe("");
            expect(banner(host)).toBeNull();
        } finally {
            unmount(root, host);
        }
    });

    it("renders one row per journal, carrying the fields the record holds", async () => {
        respond = () => [
            journalAged(1, { conversationId: "aaaaaaa11111111", turnId: "t-1" }),
            journalAged(4, {
                conversationId: "bbbbbbb22222222",
                turnId: "t-2",
                projectPath: null,
                subagentIds: ["s1", "s2"],
                note: "Stopped by user",
                status: "interrupted",
            }),
        ];
        const { host, root } = mountBanner();
        try {
            await waitUntil(() => rows(host).length > 0, "the rows");
            expect(rows(host)).toHaveLength(2);
            const text = host.textContent ?? "";
            expect(text).toContain("aaaaaaa");
            expect(text).toContain("bbbbbbb");
            expect(text).toContain("2 subagents");
            expect(text).toContain("Stopped by user");
            // The subagent count belongs only to the journal that recorded it.
            expect(rows(host)[0].textContent).not.toContain("subagent");
        } finally {
            unmount(root, host);
        }
    });

    it("marks the banner as unfinished work in text, not by colour alone", async () => {
        respond = () => [journalAged(3)];
        const { host, root } = mountBanner();
        try {
            await waitUntil(() => rows(host).length > 0, "the row");
            const text = host.textContent ?? "";
            expect(text).toMatch(/1 turn was left unfinished/);
            // The journal holds no title, so the banner says so out loud.
            expect(text).toContain("not its title");
            expect(buttonIn(rows(host)[0], "Open ").getAttribute("aria-label")).toContain("3h ago");
            expect(buttonIn(rows(host)[0], "Dismiss ").getAttribute("aria-label")).toContain(
                "9f2c1ab4",
            );
        } finally {
            unmount(root, host);
        }
    });

    it("says the check failed instead of reporting that nothing was interrupted", async () => {
        respond = () => Promise.reject(new Error("journal directory unreadable"));
        const { host, root } = mountBanner();
        try {
            await waitUntil(() => banner(host) !== null, "the failure banner");
            expect(banner(host)?.getAttribute("data-interrupted-turns")).toBe("failed");
            const text = host.textContent ?? "";
            expect(text).toContain("Could not check for interrupted turns");
            expect(text).toContain("journal directory unreadable");
            // Structurally distinct from the empty case, which renders no node at all.
            expect(rows(host)).toHaveLength(0);
        } finally {
            unmount(root, host);
        }
    });

    it("checks again on request and can still find the interrupted turn", async () => {
        let firstCall = true;
        respond = () => {
            if (firstCall) {
                firstCall = false;
                return Promise.reject(new Error("boom"));
            }
            return [journalAged(2)];
        };
        const { host, root } = mountBanner();
        try {
            await waitUntil(() => banner(host) !== null, "the failure banner");
            act(() => {
                buttonIn(banner(host)!, "Check again").click();
            });
            await waitUntil(() => rows(host).length > 0, "the row after a successful retry");
            expect(invokes).toBe(2);
            expect(banner(host)?.getAttribute("data-interrupted-turns")).toBe("");
        } finally {
            unmount(root, host);
        }
    });

    it("asks the backend once per mount", async () => {
        // Catches a poll or a re-fetch loop being introduced. It does not by itself
        // prove the StrictMode mount guard, which is not reachable without one.
        respond = () => [journalAged(1)];
        const { host, root } = mountBanner();
        try {
            await waitUntil(() => invokes > 0, "the check to run");
            await pause(250);
            expect(invokes).toBe(1);
        } finally {
            unmount(root, host);
        }
    });

    it("opens the chat with the event the app already listens for", async () => {
        respond = () => [
            journalAged(1, { conversationId: "aaaaaaa11111111", turnId: "t-1" }),
            journalAged(1, { conversationId: "bbbbbbb22222222", turnId: "t-2" }),
        ];
        const loads = listenCustomEvent<{ id?: string }>("bettershape-chat-load");
        const { host, root } = mountBanner();
        try {
            await waitUntil(() => rows(host).length === 2, "the rows");
            act(() => buttonIn(rows(host)[1], "Open ").click());
            expect(loads.events).toHaveLength(1);
            expect(loads.events[0].detail).toEqual({ id: "bbbbbbb22222222" });
        } finally {
            loads.off();
            unmount(root, host);
        }
    });

    it("dismisses one row and keeps it dismissed for the rest of the session", async () => {
        respond = () => [
            journalAged(1, { conversationId: "aaaaaaa11111111", turnId: "t-1" }),
            journalAged(1, { conversationId: "bbbbbbb22222222", turnId: "t-2" }),
        ];
        const first = mountBanner();
        try {
            await waitUntil(() => rows(first.host).length === 2, "the rows");
            act(() => buttonIn(rows(first.host)[0], "Dismiss ").click());
            expect(rows(first.host)).toHaveLength(1);
            expect(first.host.textContent).not.toContain("aaaaaaa");
            expect(first.host.textContent).toContain("bbbbbbb");
        } finally {
            unmount(first.root, first.host);
        }

        // A second mount must check again (so the answer is never cached for the
        // app's lifetime) and still honour the dismissal.
        const second = mountBanner();
        try {
            await waitUntil(() => invokes >= 2, "the remount to check again");
            await pause(120);
            expect(rows(second.host)).toHaveLength(1);
            expect(second.host.textContent).not.toContain("aaaaaaa");
        } finally {
            unmount(second.root, second.host);
        }
    });

    it("renders nothing once the only row has been dismissed", async () => {
        respond = () => [journalAged(1)];
        const { host, root } = mountBanner();
        try {
            await waitUntil(() => rows(host).length === 1, "the row");
            act(() => buttonIn(rows(host)[0], "Dismiss ").click());
            expect(host.childElementCount).toBe(0);
            // The backend still has the turn, so dismissing must not re-check.
            expect(invokes).toBe(1);
        } finally {
            unmount(root, host);
        }
    });
});