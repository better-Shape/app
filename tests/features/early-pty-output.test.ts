import { expect, it } from "vitest";
import { EarlyPtyOutput } from "@/features/terminal/early-pty-output";

it("preserves selected chunk order and discards unrelated records on activation", () => {
    const output = new EarlyPtyOutput();
    output.append(1, "ready"); output.append(2, "unrelated"); output.append(1, "error");
    expect(output.take(1)).toEqual(["ready", "error"]);
    expect(output.take(2)).toEqual([]);
});
it("bounds both character retention and chunk-object counts", () => {
    const output = new EarlyPtyOutput();
    for (let i = 0; i < 1000; i++) output.append(1, String(i));
    const chunks = output.take(1);
    expect(chunks).toHaveLength(128);
    expect(chunks.at(-1)).toBe("999");
    output.append(1, "x".repeat(1_000_000));
    output.append(1, "last");
    expect(output.take(1).join("").length).toBeLessThanOrEqual(32_768);
});
it("bounds unknown PTY cardinality and clears cancelled startup records", () => {
    const output = new EarlyPtyOutput();
    for (let id = 0; id < 1000; id++) output.append(id, "data");
    expect(output.take(999)).toEqual([]);
    output.append(1, "cancelled"); output.clear();
    expect(output.take(1)).toEqual([]);
});
