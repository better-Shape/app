import { beforeEach, expect, it, vi } from "vitest";
const backend = vi.hoisted(() => ({ probePreviewUrl: vi.fn(), rememberPreviewUrl: vi.fn(async () => {}) }));
vi.mock("@/lib/backend", () => ({ commands: backend }));
import { getPreviewCurrentUrl, resetPreviewState, showPreviewUrl } from "@/features/preview/store";
beforeEach(() => { resetPreviewState(); vi.clearAllMocks(); });
it("commits an already-probed local preview without a second reachability race", () => {
    backend.probePreviewUrl.mockResolvedValue(false);
    expect(showPreviewUrl("http://127.0.0.1:5173/page")).toBe(true);
    expect(getPreviewCurrentUrl()).toBe("http://127.0.0.1:5173/page");
    expect(backend.probePreviewUrl).not.toHaveBeenCalled();
});
it("does not report a committed design navigation for invalid or remote URLs", () => {
    expect(showPreviewUrl("file:///etc/passwd")).toBe(false);
    expect(showPreviewUrl("https://example.com")).toBe(false);
    expect(getPreviewCurrentUrl()).toBeNull();
});
