/**
 * A popped-out file is keyed by its window label. The label used to be the first
 * 48 sanitized characters of the path, so two long siblings shared one label and
 * the second open focused the first file's window.
 */
import { expect, it } from "vitest";
import { popoutLabel } from "@/lib/window/open-editor-popout";

const repeated = (name: string) => `/repo/src/deeply/nested/directory/that/keeps/going/${name}.ts`;

it("keeps two long sibling paths apart", () => {
    const first = popoutLabel(repeated("first-file"));
    const second = popoutLabel(repeated("second-file"));
    expect(first).not.toBe(second);
});

it("is stable for the same path", () => {
    expect(popoutLabel(repeated("first-file"))).toBe(popoutLabel(repeated("first-file")));
});

it("stays a label Tauri accepts", () => {
    const label = popoutLabel("/repo/a file with spaces & symbols.ts");
    expect(label).toMatch(/^popout-[A-Za-z0-9_-]+$/);
});
