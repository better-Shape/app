import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/backend", () => ({
    commands: {
        readFile: vi.fn(async () => "export const a = 1;\n"),
        getOutline: vi.fn(async () => ({ symbols: [] })),
        gitStatus: vi.fn(async () => []),
        lsDir: vi.fn(async () => []),
        openFile: vi.fn(async () => undefined),
    },
}));

import { Breadcrumbs } from "@/features/editor/ui/main/ui/breadcrumb";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
});

const render = async (props: Parameters<typeof Breadcrumbs>[0]) => {
    await act(async () => root.render(<Breadcrumbs {...props} />));
    return host.querySelector('[role="menubar"]');
};

describe("editor breadcrumb menubar role", () => {
    it("is a menubar when only folder menus render", async () => {
        // An image opens no outline, so the folder crumb alone makes the bar a menubar.
        expect(await render({ path: "/proj/src/image.png", projectPath: "/proj", isImage: true })).not.toBeNull();
    });

    it("is a menubar when only the outline menu renders", async () => {
        // With no project, no folder crumb resolves, so the file's outline alone makes it a menubar.
        expect(await render({ path: "/app.ts", projectPath: null })).not.toBeNull();
    });

    it("drops the role in compact mode, where no crumb opens a menu", async () => {
        expect(await render({ path: "/proj/src/app.ts", projectPath: "/proj", compact: true })).toBeNull();
    });

    it("drops the role for an image whose folders resolve to no path", async () => {
        // Outside the project the trail is the absolute path, and a drive segment such as `D:` is
        // not a folder name the project can join, so no folder crumb opens a menu.
        const bar = await render({ path: "D:\\pics\\shots\\screen.png", projectPath: "C:\\proj", isImage: true });
        expect(bar).toBeNull();
        expect(host.textContent).toContain("screen.png");
    });
});
