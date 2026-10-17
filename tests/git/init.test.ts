import { describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { invoke, type InvokeArgs } from "@tauri-apps/api/core";

describe("init", () => {
    it("invoke", async () => {
        // The mock records the arguments the renderer passed, so it declares the
        // parameter it is called with. A zero-argument `vi.fn()` compiles as a
        // call with one argument only because the mock's type came from the
        // inferred signature.
        const spy = vi.fn((_args?: InvokeArgs) => undefined);
        mockIPC((cmd, args) => {
            if (cmd === "git_init") {
                spy(args);
                return undefined;
            }
        });

        await invoke("git_init", { path: "C:/projects/demo" });
        expect(spy).toHaveBeenCalledWith({ path: "C:/projects/demo" });
    });

    it("errors", async () => {
        mockIPC((cmd) => {
            if (cmd === "git_init") throw new Error("Repository already exists");
        });

        await expect(invoke("git_init", { path: "C:/projects/demo" })).rejects.toThrow(
            "Repository already exists",
        );
    });
});
