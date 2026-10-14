import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Also expose the diagnostic through the Checks API, not just artifact/log storage. */
export function failureAnnotation(log) {
    const clean = log.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
    const tail = clean.trim().split(/\r?\n/).slice(-100).join("\n").slice(-12_000);
    const escaped = tail.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
    return `::error title=Native build failed::${escaped || "Build failed without diagnostic output."}`;
}

/** Read a bounded diagnostic tail from stdin, never an arbitrary caller-supplied path. */
export async function failureAnnotationFromStream(input) {
    let tail = "";
    for await (const chunk of input) tail = (tail + chunk).slice(-64_000);
    return failureAnnotation(tail);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    process.stdin.setEncoding("utf8");
    console.error(await failureAnnotationFromStream(process.stdin));
}
