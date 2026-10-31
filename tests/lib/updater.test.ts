import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
    checkAppUpdate: vi.fn(),
    openUrlExternal: vi.fn(async () => undefined),
}));

vi.mock("@/lib/backend", () => ({ commands: backend }));

import { describeUpdateStatus, type UpdateStatus } from "@/lib/window/updater";

/** A fresh module per test: the status is module state. */
async function loadUpdater() {
    vi.resetModules();
    return import("@/lib/window/updater");
}

beforeEach(() => {
    backend.checkAppUpdate.mockReset();
    backend.openUrlExternal.mockClear();
    localStorage.clear();
});

describe("checkForAppUpdates", () => {
    const release = (overrides: Partial<{ latest: string; newer: boolean }> = {}) => ({
        current: "1.0.3",
        latest: "1.1.0",
        newer: true,
        url: "https://github.com/Owie6789/BetterShape/releases/tag/v1.1.0",
        notes: "Fixes",
        ...overrides,
    });

    it("offers the release the check found", async () => {
        backend.checkAppUpdate.mockResolvedValue(release());
        const updater = await loadUpdater();

        const status = await updater.checkForAppUpdates();

        expect(status).toMatchObject({
            kind: "available",
            version: "1.1.0",
            notes: "Fixes",
            url: "https://github.com/Owie6789/BetterShape/releases/tag/v1.1.0",
        });
        expect(updater.getUpdateStatus().kind).toBe("available");
    });

    it("says up to date when GitHub has nothing newer", async () => {
        backend.checkAppUpdate.mockResolvedValue(release({ latest: "1.0.3", newer: false }));
        const updater = await loadUpdater();

        expect((await updater.checkForAppUpdates()).kind).toBe("upToDate");
    });

    it("keeps a dismissed version quiet until the check is forced", async () => {
        backend.checkAppUpdate.mockResolvedValue(release());
        const updater = await loadUpdater();
        await updater.checkForAppUpdates();
        updater.dismissAvailableUpdate();
        expect(localStorage.getItem("bettershape-update-dismissed-version")).toBe("1.1.0");

        expect((await updater.checkForAppUpdates({ silent: true })).kind).toBe("idle");
        expect((await updater.checkForAppUpdates({ force: true })).kind).toBe("available");
    });

    it("reports a check that could not reach GitHub", async () => {
        backend.checkAppUpdate.mockRejectedValue(new Error("Could not reach GitHub: offline"));
        const updater = await loadUpdater();

        const status = await updater.checkForAppUpdates();

        expect(status.kind).toBe("error");
        expect(status.kind === "error" && status.message).toContain("offline");
    });

    it("opens the release page instead of pretending to install", async () => {
        backend.checkAppUpdate.mockResolvedValue(release());
        const updater = await loadUpdater();
        await updater.checkForAppUpdates();

        await updater.downloadAndInstallUpdate();

        expect(backend.openUrlExternal).toHaveBeenCalledWith(
            "https://github.com/Owie6789/BetterShape/releases/tag/v1.1.0",
        );
    });
});

describe("describeUpdateStatus", () => {
    it("does not call an unchecked update ready to install", () => {
        const available: UpdateStatus = {
            kind: "available",
            version: "1.0.1",
            notes: "",
        };
        expect(describeUpdateStatus(available)).toBe(
            "1.0.1 is available. Install it, then restart.",
        );
        expect(describeUpdateStatus(available).toLowerCase()).not.toContain(
            "ready to install",
        );
    });

    it("tells you to restart only after the download finished", () => {
        expect(describeUpdateStatus({ kind: "ready", version: "1.0.1" })).toBe(
            "1.0.1 is downloaded. Restart BetterShape to finish.",
        );
        expect(
            describeUpdateStatus({
                kind: "downloading",
                version: "1.0.1",
                progress: 40,
            }),
        ).toBe("Downloading 1.0.1… 40%");
    });

    it("stays boring when nothing is pending", () => {
        expect(describeUpdateStatus({ kind: "idle" })).toBe(
            "You're on the latest version.",
        );
        expect(describeUpdateStatus({ kind: "upToDate" })).toBe(
            "You're on the latest version.",
        );
    });
});
