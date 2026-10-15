import { beforeEach, expect, it, vi } from "vitest";
const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/backend", () => ({ commands: { readFile: read } }));
import { invalidateGlobalsCssCache, resolveGlobalsCss, updateGlobalsCssCache } from "@/lib/ui/css-variables-loader";
import { getCachedGlobalsCssContent, setCachedGlobalsCssContent } from "@/lib/ui/css-variables";

beforeEach(() => { invalidateGlobalsCssCache(); read.mockReset(); });
function deferred() {
    let resolve!: (content: string) => void;
    const promise = new Promise<string>(done => { resolve = done; });
    return { promise, resolve };
}
it("does not assign unowned display content to a project's source path", async () => {
    setCachedGlobalsCssContent(":root { --foreign: red; }");
    read.mockResolvedValue(":root { --local: blue; }");
    expect(await resolveGlobalsCss("/project")).toEqual({ path: "/project/app/globals.css", content: ":root { --local: blue; }" });
});
it("shares discovery only for the same project", async () => {
    const a = deferred();
    read.mockImplementation(async (path: string) => path.startsWith("/a/") ? a.promise : ":root { --b: blue; }");
    const pending = resolveGlobalsCss("/a");
    const same = resolveGlobalsCss("/a");
    const b = resolveGlobalsCss("/b");
    a.resolve(":root { --a: red; }");
    expect((await b).path).toBe("/b/app/globals.css");
    expect((await pending).path).toBe("/a/app/globals.css");
    expect(await same).toEqual(await pending);
    expect(getCachedGlobalsCssContent()).toContain("--b");
    expect(read).toHaveBeenCalledTimes(2);
});
it("does not repopulate an invalidated cache from an obsolete discovery", async () => {
    const old = deferred();
    read.mockReturnValueOnce(old.promise).mockResolvedValue(":root { --new: blue; }");
    const pending = resolveGlobalsCss("/project");
    invalidateGlobalsCssCache();
    await resolveGlobalsCss("/project");
    old.resolve(":root { --old: red; }"); await pending;
    expect(getCachedGlobalsCssContent()).toContain("--new");
    expect((await resolveGlobalsCss("/project")).content).toContain("--new");
});
it("does not reuse another project's content when the new project has no CSS", async () => {
    read.mockResolvedValueOnce(":root { --a: red; }");
    await resolveGlobalsCss("/a");
    read.mockRejectedValue(new Error("not found"));
    expect(await resolveGlobalsCss("/b")).toEqual({ path: null, content: "" });
    expect(getCachedGlobalsCssContent()).toBe("");
});
it("retries discovery after a file is created following an earlier miss", async () => {
    read.mockRejectedValue(new Error("not found"));
    expect((await resolveGlobalsCss("/project")).path).toBeNull();
    read.mockResolvedValue(":root { --new: red; }");
    expect((await resolveGlobalsCss("/project")).path).toBe("/project/app/globals.css");
});

it("keeps acknowledged content and its path together despite an obsolete read", async () => {
    const old = deferred(); read.mockReturnValueOnce(old.promise);
    const pending = resolveGlobalsCss("/project");
    updateGlobalsCssCache("/project", "/project/app/globals.css", ":root { --saved: green; }");
    old.resolve(":root { --obsolete: red; }"); await pending;
    expect(await resolveGlobalsCss("/project")).toEqual({ path: "/project/app/globals.css", content: ":root { --saved: green; }" });
    expect(getCachedGlobalsCssContent()).toContain("--saved");
});
it.each(["", ":root {}", "body { color: red; }"])("can locate an existing stylesheet before its first token: %j", async content => {
    read.mockResolvedValue(content);
    expect(await resolveGlobalsCss("/project")).toEqual({ path: "/project/app/globals.css", content });
});


it("does not invalidate another project's cached CSS after a stale write acknowledgement", async () => {
    read.mockResolvedValue(":root { --other: green; }");
    await resolveGlobalsCss("/other");
    const calls = read.mock.calls.length;
    invalidateGlobalsCssCache("/original");
    expect(await resolveGlobalsCss("/other")).toEqual({ path: "/other/app/globals.css", content: ":root { --other: green; }" });
    expect(read).toHaveBeenCalledTimes(calls);
});

it("does not cancel another project's pending discovery when invalidating a stale owner", async () => {
    let finish!: (content: string) => void;
    read.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    const loading = resolveGlobalsCss("/other");
    invalidateGlobalsCssCache("/original");
    finish(":root { --other: green; }");
    await loading;
    expect((await resolveGlobalsCss("/other")).content).toBe(":root { --other: green; }");
    expect(read).toHaveBeenCalledTimes(1);
});
