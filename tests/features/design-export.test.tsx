import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExportBlock } from "@/features/preview/design/panel/filters";
import { notificationStore } from "@/features/notifications";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
    notificationStore.clearAll();
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); notificationStore.clearAll(); });
function exportButton() {
    return [...host.querySelectorAll("button")].filter(button => button.textContent === "Export").at(-1)!;
}
it("reports a rejected export and permits retry without an unhandled rejection", async () => {
    const exportSelection = vi.fn().mockRejectedValueOnce(new Error("Permission denied")).mockResolvedValue(undefined);
    await act(async () => root.render(<ExportBlock onExport={exportSelection} />));
    await act(async () => exportButton().click());
    expect(exportSelection).toHaveBeenCalledOnce();
    expect(notificationStore.getSnapshot().notifications).toEqual([expect.objectContaining({
        type: "error", message: "Could not export selection", description: "Permission denied",
    })]);
    expect(exportButton().getAttribute("aria-busy")).not.toBe("true");
    await act(async () => exportButton().click());
    expect(exportSelection).toHaveBeenCalledTimes(2);
    expect(notificationStore.getSnapshot().notifications).toHaveLength(1);
});
it("handles synchronous export failures and restores the export control", async () => {
    await act(async () => root.render(<ExportBlock onExport={() => { throw new Error("Export setup failed"); }} />));
    await act(async () => exportButton().click());
    expect(notificationStore.getSnapshot().notifications[0]?.message).toBe("Could not export selection");
    expect(exportButton().getAttribute("aria-busy")).not.toBe("true");
});
it("keeps a pending export busy and a cancelled save quiet", async () => {
    let finish!: () => void;
    const exportSelection = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    await act(async () => root.render(<ExportBlock onExport={exportSelection} />));
    await act(async () => exportButton().click());
    const button = host.querySelector<HTMLButtonElement>('button[aria-busy="true"]')!;
    expect(button).not.toBeNull();
    expect(button.getAttribute("aria-disabled")).toBe("true");
    await act(async () => button.click());
    expect(exportSelection).toHaveBeenCalledOnce();
    await act(async () => finish());
    expect(exportButton().getAttribute("aria-busy")).not.toBe("true");
    expect(notificationStore.getSnapshot().notifications).toEqual([]);
});
