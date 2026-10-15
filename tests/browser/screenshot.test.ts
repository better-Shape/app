import { describe, expect, it } from "vitest";
import { screenshotFailureMessage } from "@/features/agent/workspace/browser";

describe("screenshotFailureMessage", () => {
    it("passes a plain string rejection through", () => {
        expect(screenshotFailureMessage("The page is not attached.")).toBe(
            "The page is not attached.",
        );
    });

    it("unwraps an Error", () => {
        expect(screenshotFailureMessage(new Error("capture timed out"))).toBe("capture timed out");
    });

    it("falls back when the rejection carries nothing usable", () => {
        // A rejected invoke with no message must still tell the user something.
        expect(screenshotFailureMessage(undefined)).toBe("The page could not be captured.");
        expect(screenshotFailureMessage(null)).toBe("The page could not be captured.");
        expect(screenshotFailureMessage({})).toBe("The page could not be captured.");
        // A Tauri command that returns `Result<_, String>` rejects with the bare
        // Rust error string, so a non-string rejection is not the expected shape.
        // The fallback still has to produce something, rather than an empty toast.
        expect(screenshotFailureMessage({ message: "tab not found" })).toBe(
            "The page could not be captured.",
        );
    });

    it("does not treat an empty string as a message worth showing", () => {
        expect(screenshotFailureMessage("")).toBe("The page could not be captured.");
    });
});