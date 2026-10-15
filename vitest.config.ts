import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "jsdom",
        globals: true,
        setupFiles: ["./tests/setup.ts"],
        include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
        passWithNoTests: false,
    },
    resolve: {
        alias: [
            { find: "@", replacement: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".") },
        ],
    },
});
