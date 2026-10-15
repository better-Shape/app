import { afterEach, expect, it, vi } from "vitest";
import { attachmentsToComposer, parseUserAttachments } from "@/features/chat/lib/user-attachments";
import { messageWithAttachments } from "@/features/chat/lib/send-attachments";
import type { ComposerAttachment } from "@/features/chat/ui/composer/attachments";

afterEach(() => vi.restoreAllMocks());
const signal = () => new AbortController().signal;

it.each(['font.woff', 'a>"<&.woff', 'literal&gt;.woff'])("round-trips serialized asset bytes and the exact name %s through restore and resend", async name => {
    const file = new File([new Uint8Array([0, 1, 127, 255])], name, { type: "font/woff" });
    const attachment: ComposerAttachment = { id: "original", file, name, kind: "file", status: "ready", mimeType: file.type, size: file.size };
    const original = await messageWithAttachments("use this font", [attachment], signal());
    const parsed = parseUserAttachments(original);
    expect(parsed.text).toBe("use this font");
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0].name).toBe(name);
    expect(parsed.attachments[0].dataUrl).toBe("data:font/woff;base64,AAF//w==");
    const restored = await attachmentsToComposer(parsed.attachments);
    expect(restored[0].status).toBe("ready");
    expect(restored[0].file.size).toBe(4);
    expect(await messageWithAttachments(parsed.text, restored, signal())).toBe(original);
});

it("preserves bare legacy asset payloads and literal entity-looking names", () => {
    const parsed = parseUserAttachments('<attached_asset name="literal&gt;.woff" type="font/woff">data:font/woff;base64,YQ==</attached_asset>');
    expect(parsed.attachments[0]).toMatchObject({ name: "literal&gt;.woff", dataUrl: "data:font/woff;base64,YQ==" });
});

it("decodes versioned image names once and preserves their data URL", async () => {
    const parsed = parseUserAttachments('<attached_image name="a&amp;gt;.png" name_encoding="xml" type="image/png">data:image/png;base64,YQ==</attached_image>');
    expect(parsed.attachments[0]).toMatchObject({ name: "a&gt;.png", kind: "image", dataUrl: "data:image/png;base64,YQ==" });
    const [restored] = await attachmentsToComposer(parsed.attachments);
    expect(restored.status).toBe("ready");
    expect(restored.dataUrl).toBe(parsed.attachments[0].dataUrl);
});

it.each(["absent", "unreadable"])("does not label %s stored bytes as a ready empty file", async state => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unreadable payload"));
    const [restored] = await attachmentsToComposer([{ name: "font.woff", mimeType: "font/woff", kind: "file", size: 4,
        dataUrl: state === "unreadable" ? "data:font/woff;base64,broken" : undefined }]);
    expect(restored.status).toBe("error");
    expect(restored.error).toMatch(/reattach/i);
    expect(fetcher).toHaveBeenCalledTimes(state === "unreadable" ? 1 : 0);
});
