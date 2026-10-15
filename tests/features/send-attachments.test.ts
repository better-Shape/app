import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComposerAttachment } from "@/features/chat/ui/composer/attachments";
import { messageWithAttachments, waitForSendAttachments } from "@/features/chat/lib/send-attachments";

function attachment(overrides: Partial<ComposerAttachment> = {}): ComposerAttachment {
    return {
        id: "one", name: "notes.txt", kind: "file", status: "ready", size: 5, mimeType: "text/plain",
        file: new File(["hello"], "notes.txt", { type: "text/plain" }), ...overrides,
    };
}
function serialize(file: ComposerAttachment) {
    return messageWithAttachments("message", [file], new AbortController().signal);
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("attachment serialization", () => {
    it("keeps plain messages unchanged", async () => {
        await expect(messageWithAttachments("message", [], new AbortController().signal)).resolves.toBe("message");
    });
    it("preserves image payloads", async () => {
        await expect(serialize(attachment({ kind: "image", name: "image.png", mimeType: "image/png", dataUrl: "data:image/png;base64,aGVsbG8=" })))
            .resolves.toBe('<attached_image name="image.png" type="image/png" size="5">data:image/png;base64,aGVsbG8=</attached_image>\n\nmessage');
    });
    it("preserves text and its fallback MIME type", async () => {
        await expect(serialize(attachment({ mimeType: "" })))
            .resolves.toBe('<attached_file name="notes.txt" type="text/plain" size="5">\nhello\n</attached_file>\n\nmessage');
    });
    it("retains the text limit and original-size disclosure", async () => {
        const text = "a".repeat(80001);
        const result = await serialize(attachment({ file: new File([text], "notes.txt"), size: text.length }));
        expect(result).toContain("a".repeat(80000) + "\n... [truncated, 80001 chars total]");
        expect(result).not.toContain(text);
    });
    it("explicitly describes audio without pretending transcription is supported", async () => {
        const result = await serialize(attachment({ kind: "audio", mimeType: "" }));
        expect(result).toContain('type="audio"');
        expect(result).toContain("transcription not available in this turn");
    });
    it("inlines supported binary assets with usage instructions", async () => {
        const result = await serialize(attachment({ name: "font.woff", mimeType: "font/woff" }));
        expect(result).toContain('<attached_asset name="font.woff"');
        expect(result).toContain('usable="true"');
        expect(result).toContain("aGVsbG8=");
    });
    it("does not read oversized binary assets into memory", async () => {
        const read = vi.spyOn(FileReader.prototype, "readAsDataURL");
        const result = await serialize(attachment({ name: "font.woff", mimeType: "font/woff", size: 2_500_001 }));
        expect(read).not.toHaveBeenCalled();
        expect(result).toContain("Binary asset too large to inline (2500001 bytes)");
    });
    it.each([
        { kind: "image" as const, dataUrl: undefined },
        { name: "archive.zip", mimeType: "application/zip" },
    ])("rejects an attachment that cannot be represented instead of omitting it", async overrides => {
        await expect(serialize(attachment(overrides))).rejects.toThrow(/attachment/i);
    });
    it("handles synchronous FileReader start failures and detaches the abort handler", async () => {
        vi.spyOn(FileReader.prototype, "readAsText").mockImplementation(() => { throw new Error("unreadable"); });
        const controller = new AbortController();
        const remove = vi.spyOn(controller.signal, "removeEventListener");
        await expect(messageWithAttachments("message", [attachment()], controller.signal)).rejects.toThrow("Could not read attachment");
        expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    });
    it("cancels a pending file read and clears its event handlers", async () => {
        const read = vi.spyOn(FileReader.prototype, "readAsText").mockReturnValue(undefined);
        const controller = new AbortController();
        const sending = messageWithAttachments("message", [attachment()], controller.signal);
        const outcome = expect(sending).rejects.toMatchObject({ name: "AbortError" });
        controller.abort();
        await outcome;
        const reader = read.mock.contexts[0] as FileReader;
        expect(reader).toBeInstanceOf(FileReader);
        expect(reader.onload).toBeNull();
        expect(reader.onerror).toBeNull();
        expect(reader.onabort).toBeNull();
    });
});

describe("submitted attachment ownership", () => {
    it("waits for submitted processing updates but ignores newly added files", async () => {
        vi.useFakeTimers();
        let files = [attachment({ status: "processing" })];
        const waiting = waitForSendAttachments(["one"], () => files, new AbortController().signal);
        files = [attachment(), attachment({ id: "two", status: "error" })];
        await vi.advanceTimersByTimeAsync(40);
        await expect(waiting).resolves.toEqual([attachment()]);
    });
    it("rejects removed submitted attachments", async () => {
        await expect(waitForSendAttachments(["missing"], () => [], new AbortController().signal)).rejects.toThrow("removed");
    });
    it("cancels processing waits immediately without leaving a timer", async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        const waiting = waitForSendAttachments(["one"], () => [attachment({ status: "processing" })], controller.signal);
        const outcome = expect(waiting).rejects.toMatchObject({ name: "AbortError" });
        controller.abort();
        await outcome;
        expect(vi.getTimerCount()).toBe(0);
    });
});
