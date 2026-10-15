import { createInterface } from "node:readline";

const patterns = [
    /-----BEGIN (?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED) )?PRIVATE KEY-----/,
    /sk-[a-zA-Z0-9_-]{20,}/,
    /gh[po]_[a-zA-Z0-9]{36}/,
    /AKIA[0-9A-Z]{16}/,
    /aws_secret_access_key\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}/i,
];
const secretReference = /\$\{\{\s*secrets\.[a-zA-Z_][a-zA-Z0-9_]*\s*\}\}/g;
const MAX_HUNK_CHARS = 256 * 1024;
let inHunk = false;
let detected = false;
let lines = [];
let hunkChars = 0;

function scanHunk() {
    // Context participates in recognizing expressions, but only added lines are
    // scanned. Preserve newlines when masking so that ownership cannot shift.
    const text = lines.map(line => line.text).join("\n").replace(secretReference, match => match.replace(/[^\r\n]/g, " "));
    const masked = text.split("\n");
    for (let index = 0; index < lines.length; index++) {
        if (lines[index].added && patterns.some(pattern => pattern.test(masked[index]))) detected = true;
    }
    lines = [];
    hunkChars = 0;
}

for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    if (line.startsWith("diff --git ")) {
        scanHunk();
        inHunk = false;
    } else if (line.startsWith("@@ ")) {
        scanHunk();
        inHunk = true;
    } else if (inHunk && (line.startsWith("+") || line.startsWith(" "))) {
        // Huge hunks are scanned in bounded chunks. An expression split at this
        // boundary is conservatively unmasked, never a reason to skip a secret.
        if (hunkChars + line.length > MAX_HUNK_CHARS) scanHunk();
        lines.push({ added: line.startsWith("+"), text: line.slice(1) });
        hunkChars += line.length;
    }
}
scanHunk();
if (detected) {
    console.error("::error::Potential secret value detected in added lines. Review the diff without logging credential values.");
    process.exitCode = 1;
} else {
    console.log("No obvious secret values found in added lines.");
}
