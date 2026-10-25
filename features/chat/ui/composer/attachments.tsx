"use client";

import { Camera20Filled } from "@fluentui/react-icons/headless/svg/camera";
import { Code20Regular } from "@fluentui/react-icons/headless/svg/code";
import { Dismiss20Regular } from "@fluentui/react-icons/headless/svg/dismiss";
import { Options20Regular } from "@fluentui/react-icons/headless/svg/options";
import { WindowConsole20Regular } from "@fluentui/react-icons/headless/svg/window-console";



import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useObjectUrl } from "@/lib/ui/use-object-url";
import { type IconGlyph, Icon } from "@/components/ui/icon";
import { CopyButton } from "@/components/ui/copy-button";
import {
    BETTERSHAPE_MODAL_PANEL_CLASS,
    BETTERSHAPE_OVERLAY_CLASS,
    BETTERSHAPE_OVERLAY_CONTENT_CLASS,
} from "@/lib/ui/modal-overlay";
import { useOverlayRoot } from "@/lib/ui/overlay-root";
import { FileIcon } from "@/components/ui/file-icon";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { randomSuffix } from "@/lib/utils";

const TEXT_PREVIEW_EXTENSIONS = new Set([
    "txt", "log", "md", "mdx", "json", "toml", "yaml", "yml", "csv",
    "ts", "tsx", "js", "jsx", "rs", "py", "go", "java", "c", "cpp", "h", "hpp",
    "css", "scss", "html", "xml", "sh", "sql", "graphql", "env", "ini", "cfg", "conf",
]);

/** Is previewable text attachment. */
const isPreviewableTextAttachment = (att: ComposerAttachment): boolean => {
    if (att.status !== "ready" || att.size <= 0 || att.size > 256_000) return false;
    if (att.kind === "terminal" || att.kind === "code") return true;
    if (att.kind !== "file") return false;
    if (att.mimeType.startsWith("text/") || att.mimeType === "application/json") return true;
    return TEXT_PREVIEW_EXTENSIONS.has(getFileExtension(att.name));
};
const IMAGE_EXTENSIONS = new Set([
    "png", "jpg", "jpeg", "gif", "bmp", "webp", "svg", "ico", "tiff", "tif", "avif", "heic", "heif",
]);

const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "m4a", "ogg", "flac", "aac", "wma"]);

export type AttachmentKind = "image" | "audio" | "file" | "terminal" | "code";

export type ComposerAttachment = {
    id: string;
    file: File;
    name: string;
    kind: AttachmentKind;
    status: "processing" | "ready" | "error";
    /** Prepared data URL for vision (compressed). */
    dataUrl?: string;
    mimeType: string;
    size: number;
    error?: string;
    /** Normalized 0–1 bar heights for an audio waveform. */
    peaks?: number[];
};

function getFileExtension(name: string): string {
    const parts = name.split(".");
    return parts.length > 1 ? (parts.pop() ?? "").toLowerCase() : "";
}

export function isImageFile(file: File): boolean {
    if (file.type.startsWith("image/")) return true;
    return IMAGE_EXTENSIONS.has(getFileExtension(file.name));
}

export function isAudioFile(file: File): boolean {
    if (file.type.startsWith("audio/")) return true;
    return AUDIO_EXTENSIONS.has(getFileExtension(file.name));
}

export function attachmentKind(file: File): AttachmentKind {
    if (file.type === "text/x-bettershape-terminal") return "terminal";
    if (file.type === "text/x-bettershape-code") return "code";
    if (isImageFile(file)) return "image";
    if (isAudioFile(file)) return "audio";
    return "file";
}

function newId() {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `att-${Date.now()}-${randomSuffix(6)}`;
}

/** Downscale large images so vision tokens stay cheap. */
async function compressImageFile(file: File): Promise<{ dataUrl: string; mimeType: string }> {
    const ext = getFileExtension(file.name);
    // Keep animated / vector as-is (or read raw).
    if (ext === "gif" || ext === "svg" || file.type === "image/gif" || file.type === "image/svg+xml") {
        const dataUrl = await readAsDataUrl(file);
        return { dataUrl, mimeType: file.type || "image/gif" };
    }

    const bitmap = await createImageBitmap(file);
    const maxEdge = 1280;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        bitmap.close();
        const dataUrl = await readAsDataUrl(file);
        return { dataUrl, mimeType: file.type || "image/jpeg" };
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const preferPng = file.type === "image/png" || ext === "png" || ext === "webp";
    const mimeType = preferPng ? "image/png" : "image/jpeg";
    const dataUrl = canvas.toDataURL(mimeType, preferPng ? undefined : 0.82);
    return { dataUrl, mimeType };
}

function readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

export function createPendingAttachment(file: File, peaks?: number[]): ComposerAttachment {
    return {
        id: newId(),
        file,
        name: file.name,
        kind: attachmentKind(file),
        status: "processing",
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        peaks,
    };
}

export function formatAttachmentSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    const mb = bytes / (1024 * 1024);
    return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

export function Waveform({
    peaks,
    className,
}: {
    peaks: number[];
    className?: string;
}) {
    const bars = peaks.length ? peaks : [0.35, 0.6, 0.4, 0.8, 0.5, 0.7, 0.45, 0.3, 0.55];
    return (
        <span className={cn("flex h-6 items-center gap-0.5", className)} aria-hidden>
            {/*
              Bars are positional slots rather than items: the array is regenerated whole when
              the audio changes, and two bars can carry the same amplitude.
            */}
            {bars.map((peak, slot) => (
                <span
                    key={slot}
                    className="w-0.5 rounded-full bg-text-secondary"
                    style={{ height: `${Math.max(15, Math.round(peak * 100))}%` }}
                />
            ))}
        </span>
    );
}

export async function processAttachment(att: ComposerAttachment): Promise<ComposerAttachment> {
        try {
        let result: ComposerAttachment;
        if (att.kind === "image") {
            const { dataUrl, mimeType } = await compressImageFile(att.file);
            let standardized = dataUrl;
            if (dataUrl.startsWith("data:image/jpg;base64,")) {
                standardized = dataUrl.replace("data:image/jpg;base64,", "data:image/jpeg;base64,");
            }
            result = {
                ...att,
                status: "ready",
                dataUrl: standardized,
                mimeType,
            };
        } else {
            result = { ...att, status: "ready" };
        }
        return result;
    } catch (err) {
        return {
            ...att,
            status: "error",
            error: err instanceof Error ? err.message : "Failed to process file",
        };
    }
}


const KIND_ICON: Record<Exclude<AttachmentKind, "file">, IconGlyph> = {
    image: Camera20Filled,
    audio: Options20Regular,
    terminal: WindowConsole20Regular,
    code: Code20Regular,
};

function KindIcon({ kind, name }: { kind: AttachmentKind; name: string }) {
    if (kind === "file") return <FileIcon name={name} className="size-3.5" />;
    const Glyph = KIND_ICON[kind];
    return <Icon icon={Glyph} className="text-text-muted" />;
}

/** Renders the RemoveButton UI component. */
const RemoveButton = ({ name, onRemove }: { name: string; onRemove: () => void }) => {
    return (
        <Tooltip content={`Remove ${name}`} side="top">
            <button
                type="button"
                aria-label={`Remove ${name}`}
                onClick={onRemove}
                className="absolute -right-2 -top-2 z-10 flex size-[24px] items-center justify-center rounded-full border border-border-subtle bg-surface-2 text-text-secondary opacity-0 shadow-xs transition-[opacity,background-color,color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary active:scale-[0.94] group-hover:opacity-100 focus-visible:opacity-100 motion-reduce:transform-none motion-reduce:transition-none"
            >
                <Icon icon={Dismiss20Regular} className="size-3" />
            </button>
        </Tooltip>
    );
};

/** Composer chip: image preview thumbnail or file-kind icon + filename. */
export const ComposerFileTile = ({
    kind,
    name,
    size,
    src,
    busy,
    failed,
    onPreview,
}: {
    kind: AttachmentKind;
    name: string;
    size?: number;
    src?: string | null;
    busy?: boolean;
    failed?: boolean;
    onPreview?: () => void;
}) => {
    const sizeText = typeof size === "number" && size > 0 ? formatAttachmentSize(size) : "";
    const tooltipLabel = [
        name,
        sizeText,
        onPreview ? "Click to preview" : "",
    ]
        .filter(Boolean)
        .join(" · ");

    const inner = (
        <>
            {busy ? (
                <span className="size-3 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            ) : kind === "image" && src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={src}
                    alt=""
                    className="size-4 shrink-0 rounded-[3px] object-cover ring-1 ring-border-subtle"
                />
            ) : (
                <KindIcon kind={kind} name={name} />
            )}
            <span className="min-w-0 truncate">{failed ? "Failed" : name}</span>
            {!failed && sizeText ? (
                <span className="shrink-0 text-2xs font-normal tabular-nums text-text-muted">
                    {sizeText}
                </span>
            ) : null}
        </>
    );

    const tileClass = cn(
        "inline-flex h-7 max-w-60 items-center gap-1.5 rounded-lg border border-border-subtle bg-surface-2 px-2 text-xs font-medium text-text-primary transition-[background-color,border-color,color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]",
        onPreview && "cursor-pointer hover:border-border-secondary hover:bg-[var(--btn-hover)] active:scale-[0.98]",
        failed && "border-error/40 text-error",
    );

    return (
        <Tooltip content={tooltipLabel} side="top" delayDuration={220}>
            {onPreview ? (
                <button
                    type="button"
                    aria-label={`Preview ${name}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        onPreview();
                    }}
                    className={tileClass}
                >
                    {inner}
                </button>
            ) : (
                <div className={tileClass}>{inner}</div>
            )}
        </Tooltip>
    );
};

/** Sent-message chip: filename only. */
export const MessageAttachmentPill = ({ name }: { kind?: AttachmentKind; name: string }) => {
    return (
        <Tooltip content={name} side="top" delayDuration={220}>
            <span className="inline-flex h-7 max-w-52 items-center rounded-full border border-border-subtle bg-surface-1 px-2.5 text-xs text-text-primary">
                <span className="min-w-0 truncate">{name}</span>
            </span>
        </Tooltip>
    );
};

/** Renders the AttachmentPill UI component. */
const AttachmentPill = ({
    attachment,
    onRemove,
    onPreview,
}: {
    attachment: ComposerAttachment;
    onRemove: () => void;
    onPreview?: (attachment: ComposerAttachment) => void;
}) => {
    const preview = useObjectUrl(
        attachment.kind === "image" ? attachment.file : null,
        attachment.dataUrl,
    );
    const busy = attachment.status === "processing";
    const failed = attachment.status === "error";
    const canPreview = isPreviewableTextAttachment(attachment);
    return (
        <div className="group relative shrink-0">
            <ComposerFileTile
                kind={attachment.kind}
                name={attachment.name}
                size={attachment.size}
                src={preview}
                busy={busy}
                failed={failed}
                onPreview={canPreview && onPreview ? () => onPreview(attachment) : undefined}
            />
            <RemoveButton name={attachment.name} onRemove={onRemove} />
        </div>
    );
};

/** Renders the ComposerAttachments UI component. */
export const ComposerAttachments = ({
    attachments,
    onRemove,
    onInsertInline,
}: {
    attachments: ComposerAttachment[];
    onRemove: (id: string) => void;
    onInsertInline?: (id: string, text: string) => void;
}) => {
    const overlayRoot = useOverlayRoot();
    const previewReqIdRef = React.useRef(0);
    const [previewing, setPreviewing] = React.useState<{
        id: string;
        name: string;
        size: number;
        text: string;
        lineCount: number;
    } | null>(null);

    const handleOpenPreview = React.useCallback((att: ComposerAttachment) => {
        const reqId = ++previewReqIdRef.current;
        att.file
            .text()
            .then((raw) => {
                if (previewReqIdRef.current !== reqId) return;
                const normalized = raw.replace(/\r\n/g, "\n");
                const lineCount = normalized.length === 0 ? 0 : normalized.split("\n").length;
                setPreviewing({
                    id: att.id,
                    name: att.name,
                    size: att.size,
                    text: normalized,
                    lineCount,
                });
            })
            .catch(() => {
                /* ignore unreadable blob */
            });
    }, []);

    if (attachments.length === 0) return null;

    return (
        <>
            <div className="flex flex-wrap gap-1.5 overflow-visible px-2.5 pt-1.5 pb-1">
                {attachments.map((att) => (
                    <AttachmentPill
                        key={att.id}
                        attachment={att}
                        onRemove={() => onRemove(att.id)}
                        onPreview={handleOpenPreview}
                    />
                ))}
            </div>
            <Dialog.Root
                open={Boolean(previewing)}
                onOpenChange={(open) => {
                    if (!open) {
                        previewReqIdRef.current += 1;
                        setPreviewing(null);
                    }
                }}
            >
                <Dialog.Portal container={overlayRoot}>
                    <Dialog.Overlay className={BETTERSHAPE_OVERLAY_CLASS} />
                    <Dialog.Content
                        className={cn(
                            BETTERSHAPE_OVERLAY_CONTENT_CLASS,
                            BETTERSHAPE_MODAL_PANEL_CLASS,
                            "fixed top-[14%] left-1/2 z-50 flex w-[min(640px,calc(100%-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-xl focus:outline-none",
                        )}
                    >
                        {previewing ? (
                            <>
                                <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-3.5 py-2.5">
                                    <div className="flex min-w-0 items-center gap-2">
                                        <Dialog.Title className="truncate text-sm font-medium text-text-primary">
                                            {previewing.name}
                                        </Dialog.Title>
                                        <Dialog.Description className="shrink-0 text-xs tabular-nums text-text-muted">
                                            {previewing.lineCount}{" "}
                                            {previewing.lineCount === 1 ? "line" : "lines"} ·{" "}
                                            {formatAttachmentSize(previewing.size)}
                                        </Dialog.Description>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                        {onInsertInline && previewing.text.length <= 24_000 ? (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const { id, text } = previewing;
                                                    setPreviewing(null);
                                                    onInsertInline(id, text);
                                                }}
                                                className="rounded-md px-2 py-1 text-xs font-medium text-text-secondary transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary"
                                            >
                                                Insert inline
                                            </button>
                                        ) : null}
                                        <CopyButton text={previewing.text} label="Copy content" />
                                        <Dialog.Close asChild>
                                            <button
                                                type="button"
                                                aria-label="Close attachment preview"
                                                className="flex size-[24px] items-center justify-center rounded-md text-text-muted transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary"
                                            >
                                                <Icon icon={Dismiss20Regular} className="size-3.5" />
                                            </button>
                                        </Dialog.Close>
                                    </div>
                                </div>
                                <pre className="max-h-[360px] overflow-auto bg-panel p-3.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-text-primary custom-scrollbar select-text">
                                    {previewing.text}
                                </pre>
                            </>
                        ) : null}
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>
        </>
    );
};
