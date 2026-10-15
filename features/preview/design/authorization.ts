import { getBackgroundPreviewService, sameProjectPath } from "@/features/terminal/background-run";

/** A design preview may edit only the project/origin pair explicitly opened by the host. */
export type DesignAuthorization = { projectPath: string; origin: string; serviceId: number };
export const OFF_DESIGN_ORIGIN = "https://preview.bettershape.invalid";

export function authorizeDesignPreview(projectPath: string, url: string): DesignAuthorization | null {
    if (!projectPath) return null;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
        if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) return null;
        // The IDE's own development document is never a project preview.
        if (parsed.port === "48921" || parsed.port === "1420") return null;
        if (parsed.username || parsed.password) return null;
        const service = getBackgroundPreviewService();
        if (!service || !sameProjectPath(service.projectPath, projectPath)) return null;
        if (new URL(service.url).origin !== parsed.origin) return null;
        return { projectPath, origin: parsed.origin, serviceId: service.ptyId };
    } catch { return null; }
}

/** Revalidate on use so stopping/replacing a server revokes existing frame grants. */
export function isCurrentDesignAuthorization(authorization: DesignAuthorization | null, projectPath: string): authorization is DesignAuthorization {
    if (!authorization || authorization.projectPath !== projectPath) return false;
    const current = authorizeDesignPreview(projectPath, authorization.origin);
    return current?.serviceId === authorization.serviceId;
}

/** Pin outgoing data to the authorized origin even after cross-origin frame navigation. */
export function designMessageOrigin(authorization: DesignAuthorization | null, projectPath: string): string {
    return isCurrentDesignAuthorization(authorization, projectPath) ? authorization.origin : OFF_DESIGN_ORIGIN;
}

export function acceptsDesignMessage(
    event: Pick<MessageEvent, "source" | "origin">,
    frame: Pick<HTMLIFrameElement, "contentWindow"> | null,
    authorization: DesignAuthorization | null,
    projectPath: string,
): boolean {
    return Boolean(frame?.contentWindow && authorization
        && isCurrentDesignAuthorization(authorization, projectPath)
        && event.source === frame.contentWindow
        && event.origin === authorization.origin);
}

/** The native iframe initializer may see many local documents; run only in this session's origin. */
export function scopeDesignBridge(script: string, authorization: DesignAuthorization): string {
    return `(function () { if (location.origin !== ${JSON.stringify(authorization.origin)}) return;\n${script}\n})();`;
}
