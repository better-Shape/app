import { createInterface } from "node:readline";

const patterns = [
    /-----BEGIN (?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED) )?PRIVATE KEY-----/,
    /sk-[a-zA-Z0-9_-]{20,}/,
    /gh[po]_[a-zA-Z0-9]{36}/,
    /AKIA[0-9A-Z]{16}/,
    /aws_secret_access_key\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}/i,
];
const secretReference = /\$\{\{\s*secrets\.[a-zA-Z_][a-zA-Z0-9_]*\s*\}\}/g;
let inHunk = false;
let detected = false;
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    if (line.startsWith("diff --git ")) inHunk = false;
    else if (line.startsWith("@@ ")) inHunk = true;
    else if (inHunk && line.startsWith("+")) {
        const added = line.slice(1).replace(secretReference, "");
        if (patterns.some(pattern => pattern.test(added))) detected = true;
    }
}
if (detected) {
    console.error("::error::Potential secret value detected in added lines. Review the diff without logging credential values.");
    process.exitCode = 1;
} else {
    console.log("No obvious secret values found in added lines.");
}
