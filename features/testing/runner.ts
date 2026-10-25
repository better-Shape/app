import { listen } from "@tauri-apps/api/event";
import { commands } from "@/lib/backend";
import {
    applyTestResultEvent,
    isActiveTestProject,
    resetTestStore,
    setTestDiscovery,
    setTestError,
    setTestRunning,
} from "./store";
import type { TestDiscovery, TestFramework, TestResultEvent } from "./types";

let listenerInitialized = false;
let unlisten: (() => void) | null = null;

/** Init test runner events. */
export const initTestRunnerEvents = async () => {
    if (listenerInitialized) return;
    listenerInitialized = true;
    try {
        unlisten = await listen<TestResultEvent>("test-result", (event) => {
            applyTestResultEvent(event.payload);
        });
    } catch (err) {
        listenerInitialized = false;
        throw err;
    }
};

export function disposeTestRunnerEvents() {
    unlisten?.();
    unlisten = null;
    listenerInitialized = false;
}

/** Discovers project test suites and updates the store if `projectPath` is still active. */
export const discoverProjectTests = async (
    projectPath: string,
    shouldApply: () => boolean = () => true,
): Promise<TestDiscovery> => {
    const discovery = await commands.discoverTests(projectPath);
    const normalized: TestDiscovery = {
        framework: normalizeFramework(discovery.framework),
        test_files: discovery.test_files,
    };
    if (shouldApply()) {
        setTestDiscovery(normalized, projectPath);
    }
    return normalized;
};

function normalizeFramework(value: string): TestFramework {
    const lower = value.toLowerCase();
    if (lower === "vitest") return "vitest";
    if (lower === "jest") return "jest";
    if (lower === "playwright") return "playwright";
    if (lower === "cargo") return "cargo";
    if (lower === "pytest") return "pytest";
    if (lower === "go") return "go";
    return "none";
}

/** Run all tests. */
export const runAllTests = async (projectPath: string, framework: TestFramework) => {
    if (framework === "none") {
        setTestError("No test framework detected in this project.");
        return;
    }
    setTestRunning(true, null, projectPath);
    try {
        await commands.runTests(projectPath, framework, null);
    } catch (e) {
        if (isActiveTestProject(projectPath)) {
            setTestError(e instanceof Error ? e.message : String(e));
        }
    }
};

/** Run failed tests. */
export const runFailedTests = async (projectPath: string, framework: TestFramework, pattern: string) => {
    if (framework === "none") {
        setTestError("No test framework detected in this project.");
        return;
    }
    setTestRunning(true, pattern, projectPath);
    try {
        await commands.runTests(projectPath, framework, pattern);
    } catch (e) {
        if (isActiveTestProject(projectPath)) {
            setTestError(e instanceof Error ? e.message : String(e));
        }
    }
};

export function clearTestResults() {
    resetTestStore();
}
