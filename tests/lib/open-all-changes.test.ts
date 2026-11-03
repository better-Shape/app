import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    ALL_CHANGES_FOCUS_EVENT,
    ALL_CHANGES_FOCUS_KEY,
    openAllChangesTab,
} from "@/lib/window/open-all-changes";

const openEvents: CustomEvent<string>[] = [];
const record = (event: Event) => openEvents.push(event as CustomEvent<string>);

describe("openAllChangesTab", () => {
    beforeEach(() => {
        openEvents.length = 0;
        sessionStorage.clear();
        window.addEventListener("bettershape-set-active-tab", record);
    });

    afterEach(() => {
        window.removeEventListener("bettershape-set-active-tab", record);
        sessionStorage.clear();
    });

    it("asks the workspace to activate the all-changes tab", () => {
        openAllChangesTab();
        expect(openEvents).toHaveLength(1);
        expect(openEvents[0].detail).toBe("all-changes");
    });

    it("carries the focused file to the tab that reads it", () => {
        openAllChangesTab("src/app.tsx");
        expect(sessionStorage.getItem(ALL_CHANGES_FOCUS_KEY)).toBe("src/app.tsx");
    });

    it("opens without a focus path when none is given", () => {
        openAllChangesTab();
        expect(sessionStorage.getItem(ALL_CHANGES_FOCUS_KEY)).toBeNull();
    });

    it("clears a focus path left by an earlier request", () => {
        openAllChangesTab("src/app.tsx");
        openAllChangesTab();
        // Otherwise a plain "open all changes" scrolls to a file nobody asked for.
        expect(sessionStorage.getItem(ALL_CHANGES_FOCUS_KEY)).toBeNull();
    });

    it("notifies a tab that is already mounted", () => {
        const seen: unknown[] = [];
        const listener = (event: Event) => seen.push((event as CustomEvent).detail);
        window.addEventListener(ALL_CHANGES_FOCUS_EVENT, listener);
        openAllChangesTab("src/app.tsx");
        openAllChangesTab();
        window.removeEventListener(ALL_CHANGES_FOCUS_EVENT, listener);
        // CustomEvent normalises an undefined detail to null.
        expect(seen).toEqual(["src/app.tsx", null]);
    });
});
