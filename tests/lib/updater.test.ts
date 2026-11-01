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
    const release = (overrides: Partial<{ latest: string; newer: boolean; published: boolean }> = {}) => ({
        current: "1.0.3",
        latest: "1.1.0",
        newer: true,
        published: true,
        url: "https://github.com/better-Shape/app/releases/tag/v1.1.0",
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
            url: "https://github.com/better-Shape/app/releases/tag/v1.1.0",
        });
        expect(updater.getUpdateStatus().kind).toBe("available");
    });

    it("says up to date when GitHub has nothing newer", async () => {
        backend.checkAppUpdate.mockResolvedValue(release({ latest: "1.0.3", newer: false }));
        const updater = await loadUpdater();

        expect((await updater.checkForAppUpdates()).kind).toBe("upToDate");
    });

    it("reports a repository that has published nothing as no release", async () => {
        // A project with no release answers 404, which is an answer, not a failure.
        backend.checkAppUpdate.mockResolvedValue(
            release({ latest: "", newer: false, published: false }),
        );
        const updater = await loadUpdater();

        expect((await updater.checkForAppUpdates()).kind).toBe("noRelease");
    });

    it("asks for the channel the settings name", async () => {
        backend.checkAppUpdate.mockResolvedValue(release());
        const updater = await loadUpdater();

        await updater.checkForAppUpdates({ channel: "nightly" });
        expect(backend.checkAppUpdate).toHaveBeenLastCalledWith("nightly");

        await updater.checkForAppUpdates();
        expect(backend.checkAppUpdate).toHaveBeenLastCalledWith("stable");
    });

    it("keeps a dismissed version quiet until the check is forced", async () => {
        backend.checkAppUpdate.mockResolvedValue(release());
        const updater = await loadUpdater();
        await updater.checkForAppUpdates();
        updater.dismissAvailableUpdate();
        expect(localStorage.getItem("bettershape-update-dismissed-version")).toBe("1.1.0");

        expect((await updater.checkForAppUpdates()).kind).toBe("idle");
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

        await updater.openUpdateDownloadPage();

        expect(backend.openUrlExternal).toHaveBeenCalledWith(
            "https://github.com/better-Shape/app/releases/tag/v1.1.0",
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
            "1.0.1 is available. Open its release page to download it.",
        );
        expect(describeUpdateStatus(available).toLowerCase()).not.toContain(
            "ready to install",
        );
        expect(describeUpdateStatus(available).toLowerCase()).not.toContain("restart");
    });

    it("says so when the repository has published nothing", () => {
        expect(describeUpdateStatus({ kind: "noRelease" })).toBe(
            "Nothing has been published on this channel yet.",
        );
    });

    it("stays boring when nothing is pending", () => {
        expect(describeUpdateStatus({ kind: "idle" })).toBe(
            "You're on the latest version.",
        );
        expect(describeUpdateStatus({ kind: "upToDate" })).toBe(
            "You're on the latest version.",
        );
        expect(describeUpdateStatus({ kind: "checking" })).toBe("Checking for updates...");
    });
});
