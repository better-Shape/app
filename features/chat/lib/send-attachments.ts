import { mimeCharset } from "@/lib/http/mime-charset";
import { escapeXmlAttr } from "@/lib/chat/xml";
import type { ComposerAttachment } from "@/features/chat/ui/composer/attachments";

const ATTACHMENT_PROCESSING_TIMEOUT_MS = 8_000;
const ATTACHMENT_PROCESSING_POLL_MS = 40;
const MAX_TEXT_ATTACHMENT_CHARACTERS = 80_000;
// Four bytes per character leaves enough decoded text for the UTF-16 output budget,
// including multibyte UTF-8 input, without reading the rest of a large file.
const MAX_TEXT_ATTACHMENT_READ_BYTES = MAX_TEXT_ATTACHMENT_CHARACTERS * 4;
const MAX_INLINE_BINARY_BYTES = 2_500_000;

const CODE_EXTENSIONS = new Set([
    "ts", "tsx", "js", "jsx", "rs", "py", "go", "java", "c", "cpp", "h", "hpp",
    "css", "scss", "less", "html", "xml", "svg", "json", "toml", "yaml", "yml",
    "md", "mdx", "sh", "bat", "ps1", "rb", "php", "swift", "kt", "kts", "dart",
    "lua", "r", "sql", "graphql", "gql", "proto", "txt", "log", "csv", "lock",
    "env", "ini", "cfg", "conf",
]);
const BINARY_EXTENSIONS = new Set(["ttf", "otf", "woff", "woff2", "eot", "ico", "icns", "pdf"]);

/** Reject cancelled preparation before scheduling another read or wait. */
function assertActive(signal: AbortSignal) {
    if (signal.aborted) throw new DOMException("Send preparation cancelled", "AbortError");
}

/** Wait one processing interval while letting Stop cancel and release the timer immediately. */
function pause(signal: AbortSignal): Promise<void> {
    assertActive(signal);
    return new Promise((resolve, reject) => {
        const cancel = () => {
            clearTimeout(timer);
            reject(new DOMException("Send preparation cancelled", "AbortError"));
        };
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", cancel);
            resolve();
        }, ATTACHMENT_PROCESSING_POLL_MS);
        signal.addEventListener("abort", cancel, { once: true });
    });
}

/** Follow processing updates only for the files submitted with this message. Never send a partial set. */
export async function waitForSendAttachments(
    submittedIds: readonly string[],
    currentFiles: () => readonly ComposerAttachment[],
    signal: AbortSignal,
): Promise<ComposerAttachment[]> {
    const deadline = Date.now() + ATTACHMENT_PROCESSING_TIMEOUT_MS;
    while (true) {
        assertActive(signal);
        const current = new Map(currentFiles().map(file => [file.id, file]));
        const files = submittedIds.map(id => {
            const file = current.get(id);
            if (!file) throw new Error("An attachment was removed during preparation. Review the message and retry.");
            if (file.status === "error") throw new Error(`Attachment "${file.name}" could not be processed. Retry or remove it before sending.`);
            return file;
        });
        if (files.every(file => file.status === "ready")) return files;
        if (Date.now() >= deadline) throw new Error("An attachment is still processing. Wait for it to finish, then retry.");
        await pause(signal);
    }
}

/** Fence the exact serialized inputs at admission; later additions belong to the next draft. */
export function assertSendAttachmentsUnchanged(
    prepared: readonly ComposerAttachment[],
    currentFiles: readonly ComposerAttachment[],
): void {
    const current = new Map(currentFiles.map(file => [file.id, file]));
    for (const file of prepared) {
        const live = current.get(file.id);
        if (!live) throw new Error("An attachment was removed during preparation. Review the message and retry.");
        if (live.status !== "ready" || live.file !== file.file || live.dataUrl !== file.dataUrl
            || live.name !== file.name || live.kind !== file.kind || live.mimeType !== file.mimeType || live.size !== file.size) {
            throw new Error("An attachment changed during preparation. Review the message and retry.");
        }
    }
}

/** Read one file with settled error/abort handling and no retained signal or reader callbacks. */
function readAttachment(file: ComposerAttachment, dataUrl: boolean, signal: AbortSignal): Promise<string> {
    assertActive(signal);
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        const cleanup = () => {
            signal.removeEventListener("abort", cancel);
            reader.onload = null;
            reader.onerror = null;
            reader.onabort = null;
        };
        const fail = () => {
            cleanup();
            reject(new Error(`Could not read attachment "${file.name}". Retry or remove it before sending.`));
        };
        const cancel = () => { cleanup(); reader.abort(); reject(new DOMException("Send preparation cancelled", "AbortError")); };
        reader.onload = () => {
            const result = reader.result;
            if (typeof result !== "string") { fail(); return; }
            cleanup();
            resolve(result);
        };
        reader.onerror = fail;
        reader.onabort = fail;
        signal.addEventListener("abort", cancel, { once: true });
        try {
            if (dataUrl) reader.readAsDataURL(file.file);
            else reader.readAsText(file.file.slice(0, MAX_TEXT_ATTACHMENT_READ_BYTES, file.file.type), mimeCharset(file.file.type));
        } catch { fail(); }
    });
}

/** Mark escaped names so native lookup can distinguish them from legacy literals. */
function attachmentNameAttributes(value: string): string {
    const name = escapeXmlAttr(value);
    const encoding = name === value ? "" : ' name_encoding="xml"';
    return `name="${name}"${encoding}`;
}

/** Keep the existing text/audio/oversized-asset envelope and MIME fallback. */
function attachedFile(file: ComposerAttachment, content: string, fallbackType = "application/octet-stream"): string {
    return `<attached_file ${attachmentNameAttributes(file.name)} type="${escapeXmlAttr(file.mimeType || fallbackType)}" size="${file.size}">\n${content}\n</attached_file>`;
}

/** Require prepared image data instead of silently omitting a malformed attachment. */
function imageBlock(file: ComposerAttachment): string {
    if (!file.dataUrl) throw new Error(`Attachment "${file.name}" has no prepared image data. Retry or remove it before sending.`);
    return `<attached_image ${attachmentNameAttributes(file.name)} type="${escapeXmlAttr(file.mimeType)}" size="${file.size}">${file.dataUrl}</attached_image>`;
}

/** Disclose bytes, not an invented character count, when only a prefix was decoded. */
async function textBlock(file: ComposerAttachment, signal: AbortSignal): Promise<string> {
    const text = await readAttachment(file, false, signal);
    const partialRead = file.file.size > MAX_TEXT_ATTACHMENT_READ_BYTES;
    const total = partialRead ? `${file.file.size} bytes` : `${text.length} chars`;
    const content = partialRead || text.length > MAX_TEXT_ATTACHMENT_CHARACTERS
        ? `${text.slice(0, MAX_TEXT_ATTACHMENT_CHARACTERS)}\n... [truncated, ${total} total]`
        : text;
    return attachedFile(file, content, "text/plain");
}

/** Inline supported binary assets only within the size budget, otherwise provide an explicit notice. */
async function binaryBlock(file: ComposerAttachment, signal: AbortSignal): Promise<string> {
    if (file.size > MAX_INLINE_BINARY_BYTES) {
        return attachedFile(file, `[Binary asset too large to inline (${file.size} bytes). Ask the user for a path in the repo, or copy it locally.]`);
    }
    const dataUrl = await readAttachment(file, true, signal);
    return `<attached_asset ${attachmentNameAttributes(file.name)} type="${escapeXmlAttr(file.mimeType || "application/octet-stream")}" size="${file.size}" usable="true">\n` +
        "When the user asks to use this file (e.g. apply a font, add an icon), write it into the project from this data URL and wire it up — do not only describe it.\n" +
        `${dataUrl}\n</attached_asset>`;
}

/** Accept either a MIME prefix or a known extension for files with incomplete metadata. */
function hasFileType(file: ComposerAttachment, prefix: string, extensions: ReadonlySet<string>): boolean {
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    return file.mimeType.startsWith(prefix) || extensions.has(extension);
}

/** Serialize supported text/binary files and fail unsupported formats explicitly. */
function fileBlock(file: ComposerAttachment, signal: AbortSignal): Promise<string> {
    if (hasFileType(file, "text/", CODE_EXTENSIONS)) return textBlock(file, signal);
    if (hasFileType(file, "font/", BINARY_EXTENSIONS)) return binaryBlock(file, signal);
    throw new Error(`Attachment "${file.name}" cannot be included in this message. Use a supported file type or remove it before sending.`);
}

/** Dispatch attachment kinds without weakening cancellation or complete-set guarantees. */
function attachmentBlock(file: ComposerAttachment, signal: AbortSignal): string | Promise<string> {
    assertActive(signal);
    if (file.kind === "image") return imageBlock(file);
    if (file.kind === "audio") {
        return attachedFile(file, "[Audio file attached — playback in UI; transcription not available in this turn.]", "audio");
    }
    return fileBlock(file, signal);
}

/** Serialize every submitted attachment or reject the whole preparation for an explicit retry. */
export async function messageWithAttachments(
    message: string,
    files: readonly ComposerAttachment[],
    signal: AbortSignal,
): Promise<string> {
    const blocks: string[] = [];
    for (const file of files) blocks.push(await attachmentBlock(file, signal));
    assertActive(signal);
    return blocks.length ? `${blocks.join("\n\n")}\n\n${message}` : message;
}
