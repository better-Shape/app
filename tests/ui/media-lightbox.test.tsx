import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MediaLightbox } from "@/features/chat/ui/blocks/lightbox";
import type { DesignPreviewItem } from "@/features/chat/ui/blocks/gallery";

let host: HTMLDivElement;
let root: Root;
const close = vi.fn();
function designs(prefix: string): DesignPreviewItem[] {
    return ["One", "Two"].map(name => ({ id: `${prefix}-${name}`, name: `${prefix} ${name}`,
        style: "", path: `data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22/%3E#${prefix}-${name}`, width: 1, height: 1, kind: "png" }));
}
const original = designs("Original");
function Probe({ capture }: { capture?: () => void }) {
    useLayoutEffect(() => { capture?.(); }, [capture]);
    return null;
}
function Harness({ rows = original, index = 0, open = true, capture }: {
    rows?: DesignPreviewItem[]; index?: number; open?: boolean; capture?: () => void;
}) {
    return <><MediaLightbox open={open} onClose={close} designs={rows} initialIndex={index} />
        <Probe capture={capture} /></>;
}
function page(name: string) {
    const button = host.querySelector<HTMLButtonElement>(`button[aria-label="Show ${name}"]`);
    if (!button) throw new Error(`Missing pager button: ${name}`);
    act(() => button.click());
}
function selectedLabel() { return host.querySelector("[role=dialog]")?.getAttribute("aria-label"); }
beforeEach(() => { close.mockReset(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("commits only the requested preview when the design collection changes", async () => {
    await act(async () => root.render(<Harness />));
    page("Original Two");
    const labels: (string | null | undefined)[] = [];
    await act(async () => root.render(<Harness rows={designs("Replacement")} capture={() => labels.push(selectedLabel())} />));
    expect(labels).toEqual(["Replacement One"]);
});

it("commits the new initial index without first exposing the previous preview", async () => {
    await act(async () => root.render(<Harness />));
    const labels: (string | null | undefined)[] = [];
    await act(async () => root.render(<Harness index={1} capture={() => labels.push(selectedLabel())} />));
    expect(labels).toEqual(["Original Two"]);
});

it("reopens directly at the initial preview instead of the last paged preview", async () => {
    await act(async () => root.render(<Harness />));
    page("Original Two");
    await act(async () => root.render(<Harness open={false} />));
    const labels: (string | null | undefined)[] = [];
    await act(async () => root.render(<Harness capture={() => labels.push(selectedLabel())} />));
    expect(labels).toEqual(["Original One"]);
});

it("preserves paging when parent props are unchanged", async () => {
    await act(async () => root.render(<Harness />));
    page("Original Two");
    await act(async () => root.render(<Harness />));
    expect(selectedLabel()).toBe("Original Two");
    expect(host.querySelector('[aria-label="Show Original Two"]')?.getAttribute("aria-current")).toBe("true");
    expect(host.querySelector("img")?.getAttribute("src")).toBe(original[1].path);
});

it("keeps HTML previews sandboxed and removes the Escape listener while closed", async () => {
    await act(async () => root.render(<MediaLightbox open onClose={close} src="data:text/html,Preview" title="HTML preview" kind="html" />));
    expect(host.querySelector("iframe")?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(host.querySelector("iframe")?.getAttribute("title")).toBe("HTML preview");
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(close).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<MediaLightbox open={false} onClose={close} />));
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(close).toHaveBeenCalledTimes(1);
    expect(host.querySelector("[role=dialog]")).toBeNull();
});
