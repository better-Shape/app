import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
    EditorSplitProvider,
    useSplitFocusedFile,
} from "@/core/providers/editor";

/**
 * The status bar mounts in `features/agent/layout.tsx`, a sibling of the
 * workspace, so it cannot read the split context. These tests pin the published
 * store instead: a component outside the provider must still see the focused
 * group's file, and must keep seeing it after the provider unmounts.
 */

const backend = vi.hoisted(() => ({
    active_file: "/repo/left.ts" as string | null,
    open_files: [] as { path: string }[],
    commands: { openFile: vi.fn() },
}));

vi.mock("@/lib/backend", () => ({
    commands: backend.commands,
    useProjectState: () => ({ active_file: backend.active_file, open_files: backend.open_files }),
}));

function Readout({ label }: { label: string }) {
    const path = useSplitFocusedFile();
    return <span data-testid={label}>{path ?? "none"}</span>;
}

let host: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
    backend.active_file = "/repo/left.ts";
    backend.open_files = [{ path: "/repo/left.ts" }];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    host.remove();
});

async function render(node: ReactNode) {
    await act(async () => root?.render(node));
}

it("reports the backend active file before any split exists", async () => {
    await render(
        <EditorSplitProvider>
            <Readout label="focused" />
        </EditorSplitProvider>,
    );
    expect(host.querySelector('[data-testid="focused"]')?.textContent).toBe("/repo/left.ts");
});

it("publishes the focused file to a component outside the provider", async () => {
    await render(<Readout label="outside" />);
    // Nothing has published yet, so an outside reader must not invent a path.
    expect(host.querySelector('[data-testid="outside"]')?.textContent).toBe("none");

    // Provider and reader are SIBLINGS, the way layout.tsx and the workspace are.
    await render(
        <>
            <Readout label="outside" />
            <EditorSplitProvider>
                <Readout label="inside" />
            </EditorSplitProvider>
        </>,
    );
    expect(host.querySelector('[data-testid="outside"]')?.textContent).toBe("/repo/left.ts");
    expect(host.querySelector('[data-testid="inside"]')?.textContent).toBe("/repo/left.ts");
});

it("stops reporting the file once the provider is gone", async () => {
    await render(
        <EditorSplitProvider>
            <Readout label="inside" />
        </EditorSplitProvider>,
    );
    expect(host.querySelector('[data-testid="inside"]')?.textContent).toBe("/repo/left.ts");

    // Unmount the provider entirely: an editor split cannot still be in effect.
    await render(<Readout label="inside" />);
    expect(host.querySelector('[data-testid="inside"]')?.textContent).toBe("none");
});