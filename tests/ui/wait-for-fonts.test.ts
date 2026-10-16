import { describe, expect, it } from "vitest";
import { waitForFonts } from "@/lib/ui/wait-for-fonts";

/** Minimal `Document` stand-in exposing only what `waitForFonts` touches. */
const docWith = (fonts: unknown) => ({ fonts }) as unknown as Document;

describe("waitForFonts", () => {
    it("awaits the pending font loads before resolving", async () => {
        let settled = false;
        const ready = new Promise<void>((resolve) =>
            setTimeout(() => {
                settled = true;
                resolve();
            }, 5),
        );

        await waitForFonts(docWith({ ready }));

        expect(settled).toBe(true);
    });

    it("resolves when the document exposes no FontFaceSet", async () => {
        await expect(waitForFonts(docWith(undefined))).resolves.toBeUndefined();
    });

    it("swallows a rejected FontFaceSet so the caller still proceeds", async () => {
        const ready = Promise.reject(new Error("font decode failed"));

        await expect(waitForFonts(docWith({ ready }))).resolves.toBeUndefined();
    });

    it("does not branch on the promise, which is truthy even when unset", async () => {
        // A FontFaceSet whose `ready` never settles must leave the caller waiting,
        // while a document with no FontFaceSet must resolve immediately. A
        // truthiness check on the promise would pass both cases instantly.
        const never = new Promise<void>(() => {});
        let resolved = false;
        void waitForFonts(docWith({ ready: never })).then(() => {
            resolved = true;
        });

        await new Promise((r) => setTimeout(r, 10));
        expect(resolved).toBe(false);

        await waitForFonts(docWith(undefined));
    });
});
