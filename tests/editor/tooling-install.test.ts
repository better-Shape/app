import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
    npmInstall: vi.fn(async (_path: string, _pkg: string, _dev: boolean) => undefined),
}));

const notify = vi.hoisted(() => ({
    warn: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
}));

vi.mock("@/lib/backend", () => ({ commands: backend }));
vi.mock("@/features/notifications", () => ({ notify }));

import {
    isMissingPrettierFailure,
    offerPrettierInstall,
    resetToolingInstallForTests,
} from "@/lib/editor/tooling-install";
import { resetSettings, updateSettingSection } from "@/lib/settings";

beforeEach(() => {
    resetToolingInstallForTests();
    resetSettings();
    backend.npmInstall.mockClear();
    notify.warn.mockClear();
    notify.success.mockClear();
    notify.error.mockClear();
});

describe("missing prettier detection", () => {
    it("recognises the failures npx --no-install produces", () => {
        expect(isMissingPrettierFailure("Prettier failed: npm error could not determine executable to run")).toBe(true);
        expect(isMissingPrettierFailure("Prettier failed: Error: Cannot find module 'prettier'")).toBe(true);
        expect(isMissingPrettierFailure("Prettier failed: prettier: not found")).toBe(true);
    });

    it("does not treat a broken file or config as a missing package", () => {
        expect(isMissingPrettierFailure("Prettier failed: [error] SyntaxError: Unexpected token (3:1)")).toBe(
            false,
        );
        expect(isMissingPrettierFailure("Prettier failed: Cannot find config for .prettierrc")).toBe(false);
    });
});

describe("tooling install preference", () => {
    it("installs Prettier as a dev dependency when the preference is automatic", async () => {
        updateSettingSection("workspace", { toolingInstall: "auto" });

        await offerPrettierInstall("/repo");

        expect(backend.npmInstall).toHaveBeenCalledWith("/repo", "prettier", true);
        expect(notify.success).toHaveBeenCalledWith(
            "Prettier installed",
            expect.stringContaining("next save"),
        );
    });

    it("offers the install as a toast action when the preference is to ask", async () => {
        updateSettingSection("workspace", { toolingInstall: "prompt" });

        await offerPrettierInstall("/repo");

        expect(backend.npmInstall).not.toHaveBeenCalled();
        const [, , options] = notify.warn.mock.calls[0];
        expect(options?.action?.label).toBe("Install");

        options.action.onClick();
        await vi.waitFor(() => {
            expect(backend.npmInstall).toHaveBeenCalledWith("/repo", "prettier", true);
        });
    });

    it("reports the missing package without touching the project when the preference is off", async () => {
        await offerPrettierInstall("/repo");

        expect(backend.npmInstall).not.toHaveBeenCalled();
        expect(notify.warn).toHaveBeenCalledWith(
            "Prettier is not installed",
            expect.stringContaining("npm install -D prettier"),
        );
    });

    it("asks once per project, so autosave does not repeat the toast", async () => {
        updateSettingSection("workspace", { toolingInstall: "prompt" });

        await offerPrettierInstall("/repo");
        await offerPrettierInstall("/repo");

        expect(notify.warn).toHaveBeenCalledTimes(1);
    });

    it("reports an install that fails instead of claiming success", async () => {
        updateSettingSection("workspace", { toolingInstall: "auto" });
        backend.npmInstall.mockRejectedValueOnce(new Error("EACCES: permission denied"));

        await offerPrettierInstall("/repo");

        expect(notify.error).toHaveBeenCalledWith(
            "Prettier could not be installed",
            "EACCES: permission denied",
            expect.objectContaining({ action: expect.objectContaining({ label: "Try again" }) }),
        );
        expect(notify.success).not.toHaveBeenCalled();
    });

    // Autosave calls this on every write, so a failed automatic install has to
    // stop after one attempt: each retry starts a package-manager process in the
    // user's project and raises another toast.
    it("does not retry a failed automatic install on the next save", async () => {
        updateSettingSection("workspace", { toolingInstall: "auto" });
        backend.npmInstall.mockRejectedValueOnce(new Error("EACCES: permission denied"));

        await offerPrettierInstall("/repo");
        await offerPrettierInstall("/repo");

        expect(backend.npmInstall).toHaveBeenCalledTimes(1);
        expect(notify.error).toHaveBeenCalledTimes(1);
    });

    it("still installs automatically for a different project", async () => {
        updateSettingSection("workspace", { toolingInstall: "auto" });
        backend.npmInstall.mockRejectedValueOnce(new Error("EACCES: permission denied"));

        await offerPrettierInstall("/repo");
        await offerPrettierInstall("/other");

        expect(backend.npmInstall).toHaveBeenCalledTimes(2);
    });
});
