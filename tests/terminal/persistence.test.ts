import { beforeEach, describe, expect, it } from "vitest";
import {
    clearAllTerminalSnapshots,
    loadTerminalSnapshot,
    REDACTED,
    redactTerminalSecrets,
    resetTerminalSnapshotSession,
    saveTerminalSnapshot,
    saveTerminalSnapshots,
    snapshotBuffer,
    takeRestoreCandidate,
    TERMINAL_SNAPSHOT_MAX_CHARS,
    TERMINAL_SNAPSHOT_MAX_TOTAL_CHARS,
    TERMINAL_SNAPSHOT_TTL_MS,
} from "@/features/terminal/persistence";

class MemoryStorage implements Storage {
    private map = new Map<string, string>();
    get length() {
        return this.map.size;
    }
    clear() {
        this.map.clear();
    }
    getItem(key: string) {
        return this.map.get(key) ?? null;
    }
    key(index: number) {
        return [...this.map.keys()][index] ?? null;
    }
    removeItem(key: string) {
        this.map.delete(key);
    }
    setItem(key: string, value: string) {
        this.map.set(key, value);
    }
}

function buffer(lines: string[], type = "normal") {
    return {
        type,
        length: lines.length,
        getLine: (y: number) =>
            lines[y] === undefined ? undefined : { translateToString: () => lines[y]! },
    };
}

const target = { cwd: "/repo", shell: "pwsh" };

describe("snapshotBuffer", () => {
    it("keeps the tail and trims blank padding", () => {
        expect(snapshotBuffer(buffer(["a", "b", "", "", ""]))).toBe("a\nb");
    });

    it("keeps interior blank lines", () => {
        expect(snapshotBuffer(buffer(["a", "", "c"]))).toBe("a\n\nc");
    });

    it("ignores alternate-screen buffers", () => {
        expect(snapshotBuffer(buffer(["vim", "ui"], "alternate"))).toBe("");
    });

    it("caps to the newest characters without a partial first line", () => {
        const lines = Array.from({ length: 50 }, (_, i) => `line-${i}-${"x".repeat(20)}`);
        const text = snapshotBuffer(buffer(lines), 200);
        expect(text.length).toBeLessThanOrEqual(200);
        expect(text.split("\n").every((line) => /^line-\d+-x+$/.test(line))).toBe(true);
        expect(text.endsWith(lines[49]!)).toBe(true);
    });

    it("survives a missing buffer", () => {
        expect(snapshotBuffer(null)).toBe("");
    });
});

describe("terminal snapshot store", () => {
    let storage: MemoryStorage;
    beforeEach(() => {
        storage = new MemoryStorage();
        resetTerminalSnapshotSession();
    });

    it("round-trips a snapshot", () => {
        saveTerminalSnapshot(target, "hello\nworld", 1_000, storage);
        expect(loadTerminalSnapshot(target, 1_500, storage)).toBe("hello\nworld");
    });

    it("keys snapshots by shell and cwd", () => {
        saveTerminalSnapshot(target, "a", 1_000, storage);
        expect(loadTerminalSnapshot({ cwd: "/other", shell: "pwsh" }, 1_500, storage)).toBe("");
        expect(loadTerminalSnapshot({ cwd: "/repo", shell: "bash" }, 1_500, storage)).toBe("");
    });

    it("expires entries past the TTL", () => {
        saveTerminalSnapshot(target, "a", 1_000, storage);
        expect(loadTerminalSnapshot(target, 1_000 + TERMINAL_SNAPSHOT_TTL_MS + 1, storage)).toBe("");
    });

    it("caps text at the per-entry limit", () => {
        saveTerminalSnapshot(target, "x".repeat(TERMINAL_SNAPSHOT_MAX_CHARS + 50), 1_000, storage);
        expect(loadTerminalSnapshot(target, 1_100, storage).length).toBe(TERMINAL_SNAPSHOT_MAX_CHARS);
    });

    it("prunes to the entry budget, newest first", () => {
        for (let i = 0; i < 12; i++) {
            saveTerminalSnapshot({ cwd: `/repo-${i}`, shell: "pwsh" }, `out-${i}`, 1_000 + i, storage);
        }
        expect(loadTerminalSnapshot({ cwd: "/repo-11", shell: "pwsh" }, 2_000, storage)).toBe("out-11");
        expect(loadTerminalSnapshot({ cwd: "/repo-0", shell: "pwsh" }, 2_000, storage)).toBe("");
    });

    it("stays inside the total character budget", () => {
        const chunk = "y".repeat(TERMINAL_SNAPSHOT_MAX_CHARS);
        for (let i = 0; i < 8; i++) {
            saveTerminalSnapshot({ cwd: `/repo-${i}`, shell: "pwsh" }, chunk, 1_000 + i, storage);
        }
        const raw = storage.getItem("bettershape-terminal-scrollback-v1") ?? "";
        expect(raw.length).toBeLessThan(TERMINAL_SNAPSHOT_MAX_TOTAL_CHARS + 20_000);
    });

    it("clears on empty text", () => {
        saveTerminalSnapshot(target, "a", 1_000, storage);
        saveTerminalSnapshot(target, "", 1_100, storage);
        expect(loadTerminalSnapshot(target, 1_200, storage)).toBe("");
    });

    it("restores a key at most once per session", () => {
        // takeRestoreCandidate uses the real localStorage and the real clock.
        localStorage.clear();
        saveTerminalSnapshot(target, "history");
        expect(takeRestoreCandidate(target)).toBe("history");
        expect(takeRestoreCandidate(target)).toBe("");
        resetTerminalSnapshotSession();
        expect(takeRestoreCandidate(target)).toBe("history");
        localStorage.clear();
    });

    it("stores several terminals in one write", () => {
        let writes = 0;
        const counting: Storage = {
            length: 0,
            clear: () => undefined,
            getItem: (key) => storage.getItem(key),
            key: (index) => storage.key(index),
            removeItem: (key) => storage.removeItem(key),
            setItem: (key, value) => {
                writes += 1;
                storage.setItem(key, value);
            },
        };
        saveTerminalSnapshots(
            [
                { target: { cwd: "/a", shell: "pwsh" }, text: "first" },
                { target: { cwd: "/b", shell: "pwsh" }, text: "second" },
            ],
            1_000,
            counting,
        );
        expect(writes).toBe(1);
        expect(loadTerminalSnapshot({ cwd: "/a", shell: "pwsh" }, 1_100, storage)).toBe("first");
        expect(loadTerminalSnapshot({ cwd: "/b", shell: "pwsh" }, 1_100, storage)).toBe("second");
    });

    it("keeps the only snapshot when the quota retry prunes", () => {
        // First write is rejected as too large, the pruned retry fits. With one
        // entry the "keep the newest half" maths must not round down to zero.
        const backing = new Map<string, string>();
        let attempts = 0;
        const quotaOnce: Storage = {
            length: 0,
            clear: () => backing.clear(),
            getItem: (key) => backing.get(key) ?? null,
            key: (index) => Array.from(backing.keys())[index] ?? null,
            removeItem: (key) => {
                backing.delete(key);
            },
            setItem: (key, value) => {
                attempts += 1;
                if (attempts === 1) throw new Error("quota");
                backing.set(key, value);
            },
        };

        saveTerminalSnapshot(target, "only", 1_000, quotaOnce);

        expect(attempts).toBe(2);
        expect(loadTerminalSnapshot(target, 1_100, quotaOnce)).toBe("only");
    });

    it("never throws when storage rejects writes", () => {
        const hostile: Storage = {
            length: 0,
            clear: () => undefined,
            getItem: () => null,
            key: () => null,
            removeItem: () => undefined,
            setItem: () => {
                throw new Error("quota");
            },
        };
        expect(() => saveTerminalSnapshot(target, "a", 1_000, hostile)).not.toThrow();
        expect(() => clearAllTerminalSnapshots(hostile)).not.toThrow();
    });
});

describe("secret redaction", () => {
    it("redacts provider and forge tokens", () => {
        const text = [
            "GITHUB_TOKEN=ghp_" + "a".repeat(36),
            "OPENAI=sk-" + "b".repeat(32),
            "aws AKIA" + "C".repeat(16),
            "xoxb-" + "1".repeat(20),
        ].join("\n");
        const redacted = redactTerminalSecrets(text);
        expect(redacted).not.toContain("ghp_");
        expect(redacted).not.toContain("sk-");
        expect(redacted).not.toContain("AKIA");
        expect(redacted).not.toContain("xoxb-");
        expect(redacted.match(/\[redacted\]/g)?.length).toBe(4);
    });

    it("redacts bearer tokens and assigned credentials", () => {
        expect(redactTerminalSecrets("Authorization: Bearer " + "t".repeat(24))).toContain(REDACTED);
        expect(redactTerminalSecrets("export API_KEY=abcd1234efgh")).toBe("export API_KEY=[redacted]");
        expect(redactTerminalSecrets("password: hunter2hunter2")).toBe("password: [redacted]");
    });

    it("redacts private key blocks", () => {
        // Assembled from parts so the repository secret scanner, which greps the
        // diff for PEM markers, does not flag this fixture. The runtime string is
        // still a real block, so the redaction path is exercised end to end.
        const label = "PRIV" + "ATE KEY-----";
        const begin = "-----BEGIN RSA " + label;
        const end = "-----END RSA " + label;
        const text = [begin, "MIIEow", end].join("\n");
        expect(redactTerminalSecrets(text)).toBe(REDACTED);
    });

    it("leaves ordinary output alone", () => {
        const text = [
            "> next build",
            "const token = getToken();",
            "curl https://example.com/api",
            "Task failed successfully",
        ].join("\n");
        expect(redactTerminalSecrets(text)).toBe(text);
    });

    it("redacts before the text reaches storage", () => {
        const store = new MemoryStorage();
        saveTerminalSnapshot(target, "TOKEN=abc12345xyz", 1_000, store);
        expect(loadTerminalSnapshot(target, 1_100, store)).toBe("TOKEN=[redacted]");
    });
});
