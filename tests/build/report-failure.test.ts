import { expect, it } from "vitest";
import { failureAnnotation, failureAnnotationFromStream } from "../../scripts/build/report-failure.mjs";

it("escapes workflow commands in compiler output and strips terminal color", () => {
    expect(failureAnnotation("\u001b[31merror: failed\u001b[0m\n::warning::untrusted 100%\r\nlast")).toBe("::error title=Native build failed::error: failed%0A::warning::untrusted 100%25%0Alast");
});
it("bounds annotations to a useful tail, not an entire compiler log", () => {
    const result = failureAnnotation("first\n" + "x".repeat(20000) + "\nlast");
    expect(result).not.toContain("first");
    expect(result).toContain("last");
    expect(result.length).toBeLessThan(12100);
});
it("does not claim success when the log is empty", () => {
    expect(failureAnnotation("")).toContain("Build failed without diagnostic output");
});

it("reads a bounded stream instead of an arbitrary CLI file path", async () => {
    async function* chunks() { yield "unbounded-prefix\n"; yield "x".repeat(80_000); yield "\nerror: final failure"; }
    const result = await failureAnnotationFromStream(chunks());
    expect(result).not.toContain("unbounded-prefix");
    expect(result).toContain("error: final failure");
    expect(result.length).toBeLessThan(12_100);
});
