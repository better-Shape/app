"use client";

import { Add20Regular } from "@fluentui/react-icons/headless/svg/add";
import { ArrowDown20Regular } from "@fluentui/react-icons/headless/svg/arrow-down";
import { ArrowUp20Regular } from "@fluentui/react-icons/headless/svg/arrow-up";
import { Chat20Regular } from "@fluentui/react-icons/headless/svg/chat";
import { ChevronDown20Regular } from "@fluentui/react-icons/headless/svg/chevron-down";
import { ChevronUp20Regular } from "@fluentui/react-icons/headless/svg/chevron-up";
import { Delete20Filled } from "@fluentui/react-icons/headless/svg/delete";
import { Dismiss20Regular } from "@fluentui/react-icons/headless/svg/dismiss";
import { LayoutColumnTwo20Regular } from "@fluentui/react-icons/headless/svg/layout-column-two";
import { Search20Regular } from "@fluentui/react-icons/headless/svg/search";


import React, { useCallback, useEffect, useRef, useState } from "react";
import { commands, useProjectState } from "@/lib/backend";
import type { TerminalShellProfile } from "@/lib/backend/types";
import { cn, randomInt, randomSuffix } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

import type { Terminal as XTermType } from "@xterm/xterm";
import type { FitAddon as FitAddonType } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuShortcut,
    ContextMenuTrigger,
} from "@/components/ui/context";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { Tooltip } from "@/components/ui/tooltip";
import TestPanel from "@/features/testing/ui/test-panel";
import { Button } from "@/components/ui/button";
import { getSettings, resolveDefaultTerminalShell } from "@/lib/settings";
import { setLastDevUrl } from "@/features/preview/store";
import {
    WORKBENCH_TAB_ACTION_BUTTON_CLASS,
    WORKBENCH_TAB_BAR_CLASS,
    WORKBENCH_TAB_CLOSE_BUTTON_CLASS,
    workbenchTabItemClass,
} from "@/features/editor/ui/tabs/workbench-tab-styles";
import { terminalSessionStore, type TerminalTab as SessionTab } from "@/features/terminal/session";
import { attachTerminalCommandHost } from "@/features/terminal/commands";
import { usePerfRenderCount } from "@/lib/dev/perf-hud-hooks";
import {
    clearTerminalSnapshot,
    saveTerminalSnapshots,
    snapshotBuffer,
    takeRestoreCandidate,
    type TerminalSnapshotEntry,
} from "@/features/terminal/persistence";
import {
    rememberBetterShapeClip,
    terminalAttachmentFile,
} from "@/features/chat/lib/bettershape-clip";
import { findTerminalMatches, nextMatchIndex, type TerminalMatch } from "./search";
type TerminalShell = SessionTab["shell"];
type TerminalGroupId = SessionTab["group"];
type TerminalTab = SessionTab;

/** One module promise per session — `pty-output` used to start a dynamic import per chunk. */
let runStatusModule: Promise<typeof import("@/features/preview/run-status")> | null = null;
const loadRunStatus = () =>
    (runStatusModule ??= import("@/features/preview/run-status"));


const SHELL_DISPLAY_NAMES: Record<TerminalShell, string> = {
    powershell: "PowerShell",
    pwsh: "PowerShell 7",
    cmd: "CMD",
    gitbash: "Git Bash",
    wsl: "WSL",
    ai: "Agent Terminal",
};

const createTabId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : randomSuffix(9);
const createPtyId = () => randomInt(100000, 2_000_099_999);

const getNextTerminalName = (tabs: TerminalTab[], shell: TerminalShell, cwd: string): string => {
    const prefix = SHELL_DISPLAY_NAMES[shell];
    const projectTabs = tabs.filter(t => t.cwd === cwd && t.shell === shell);
    let num = 1;
    while (projectTabs.some(t => t.title === `${prefix} ${num}`)) num++;
    return `${prefix} ${num}`;
};

const createTerminalTab = (
    shell: TerminalShell,
    title: string,
    cwd: string,
    id: string = createTabId(),
    boundPtyId?: number,
    group: TerminalGroupId = "left",
): TerminalTab => ({ id, title, shell, cwd, boundPtyId, group });

function isLayoutResizing() {
    return document.body.classList.contains("resizing-vertical") || document.body.hasAttribute("data-resizing");
}

const lastPtySize = new Map<number, { cols: number; rows: number }>();

const globalTerminalStore = terminalSessionStore;

export async function refitAllTerminals() {
    if (isLayoutResizing()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    for (const [, inst] of globalTerminalStore.instances) {
        try {
            inst.fitAddon.fit();
            const cols = inst.term.cols as number;
            const rows = inst.term.rows as number;
            if (inst.ptyId <= 0 || cols < 20 || rows < 4) continue;
            const prev = lastPtySize.get(inst.ptyId);
            if (prev && prev.cols === cols && prev.rows === rows) continue;
            lastPtySize.set(inst.ptyId, { cols, rows });
            await invoke("pty_resize", { id: inst.ptyId, rows, cols });
        } catch {
            // ignore fit/resize failures during layout transitions
        }
    }
}

/** Unlisten stale PTY listeners after a webview reload (HMR). */
export function reapOrphanedTerminalSessions() {
    for (const [, inst] of globalTerminalStore.instances) {
        try {
            inst.unlistenOutput();
        } catch {
            // ignore
        }
    }
}



/**
 * Set while search selects a match, so moving between matches does not spam the
 * clipboard-history list with terminal excerpts.
 */
let suppressSelectionClip = false;

/** Renders the TerminalInstance UI component. */
const TerminalInstance = ({ tab, isActive }: { tab: TerminalTab, isActive: boolean }) => {
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<XTermType | null>(null);
    const fitAddonRef = useRef<FitAddonType | null>(null);

    const waitForVisibleSize = useCallback(async () => {
        const node = terminalRef.current;
        if (!node) return false;
        for (let i = 0; i < 40; i++) {
            const rect = node.getBoundingClientRect();
            if (isActive && rect.width >= 120 && rect.height >= 80) return true;
            await new Promise((res) => setTimeout(res, 50));
        }
        // Don't give up forever, wait for a real resize if the panel was still settling.
        return await new Promise<boolean>((resolve) => {
            let done = false;
            let ro: ResizeObserver | null = null;
            // Settles the wait once: the observer and the timeout both reach here, and
            // the observer has to be disconnected by whichever arrives first.
            const finish = (ok: boolean) => {
                if (done) return;
                done = true;
                ro?.disconnect();
                resolve(ok);
            };
            ro = new ResizeObserver(() => {
                const rect = node.getBoundingClientRect();
                if (isActive && rect.width >= 120 && rect.height >= 80) finish(true);
            });
            ro.observe(node);
            window.setTimeout(() => finish(false), 5000);
        });
    }, [isActive]);

    useEffect(() => {
        if (!terminalRef.current) return undefined;
        let isMounted = true;
        let term: XTermType | undefined;
        let fitAddon: FitAddonType | undefined;
        let ptyId: number | undefined;
        let unlistenOutput: (() => void) | undefined;
        let detachCopy: (() => void) | undefined;
        let pendingPasteTimer: ReturnType<typeof setTimeout> | undefined;

        // Batch pty bytes into one xterm write per tick: a chatty build emits hundreds
        // of small chunks a second and every `write` re-enters the parser. Capped so a
        // hidden tab cannot buffer without bound, and flushed before the exit banner
        // and on unmount so byte order is preserved.
        let pendingOutput = "";
        let flushTimer: ReturnType<typeof setTimeout> | undefined;
        const flushOutput = () => {
            if (flushTimer !== undefined) {
                clearTimeout(flushTimer);
                flushTimer = undefined;
            }
            if (!pendingOutput) return;
            const chunk = pendingOutput;
            pendingOutput = "";
            try {
                term?.write(chunk);
            } catch {
                // The xterm may already be disposed (tab closed); losing the last
                // few bytes of a dead session is better than throwing mid-unmount.
            }
        };
        const queueOutput = (data: string) => {
            pendingOutput += data;
            if (pendingOutput.length >= 65_536) {
                flushOutput();
                return;
            }
            if (flushTimer === undefined) {
                flushTimer = setTimeout(flushOutput, 16);
            }
        };

        // Reserves the pty outside render, and re-checks `isMounted` after every await
        // because a panel that unmounts mid-reservation would otherwise leak it.
        const init = async () => {
            if (!isMounted) return;
            const existing = globalTerminalStore.instances.get(tab.id);
            if (existing) {
                if (!isActive) return;
                term = existing.term;
                fitAddon = existing.fitAddon;
                ptyId = existing.ptyId;
                unlistenOutput = existing.unlistenOutput;
                if (!term) return;
                if (terminalRef.current) {
                    if (term.element?.parentNode) term.element.parentNode.removeChild(term.element);
                    if (term.element) terminalRef.current.appendChild(term.element);
                    else term.open(terminalRef.current);

                    setTimeout(() => {
                        if (fitAddon) fitAddon.fit();
                        if (term) term.scrollToBottom();
                    }, 50);
                }
                xtermRef.current = term;
                fitAddonRef.current = fitAddon ?? null;
                return;
            }

            if (!isActive) return;
            const hasVisibleSize = await waitForVisibleSize();
            if (!isMounted || !hasVisibleSize || !terminalRef.current) return;

            const { Terminal: XTerm } = await import("@xterm/xterm");
            const { FitAddon } = await import("@xterm/addon-fit");
            const { WebglAddon } = await import("@xterm/addon-webgl");
            const { invoke } = await import("@tauri-apps/api/core");
            const { listen } = await import("@tauri-apps/api/event");
            if (!isMounted) return;

            const style = getComputedStyle(document.documentElement);
            const termSettings = getSettings().terminal;
            const fg = style.getPropertyValue("--text-secondary").trim() || "#a1a1aa";
            const bg = style.getPropertyValue("--panel").trim() || "#1e1e20";
            const muted = style.getPropertyValue("--text-muted").trim() || "#71717a";
            const warn = style.getPropertyValue("--warning").trim() || "#f59e0b";
            const err = style.getPropertyValue("--error").trim() || "#ef4444";
            const acc = style.getPropertyValue("--accent").trim() || "#3b82f6";
            term = new XTerm({
                cursorBlink: true,
                fontFamily: termSettings.fontFamily || style.getPropertyValue('--font-mono').trim() || "monospace",
                fontSize: termSettings.fontSize,
                scrollback: termSettings.scrollback,
                convertEol: true,
                theme: {
                    background: bg,
                    foreground: fg,
                    cursor: fg,
                    selectionBackground: "rgba(255,255,255,0.12)",
                    black: "#27272a",
                    red: err,
                    green: acc,
                    yellow: warn,
                    blue: acc,
                    magenta: "#a78bfa",
                    cyan: "#67e8f9",
                    white: fg,
                    brightBlack: muted,
                    brightRed: err,
                    brightYellow: warn,
                    brightWhite: style.getPropertyValue("--text-primary").trim() || "#fafafa",
                },
            });

// History only, no clipboard write: this runs on every selection change, and a
            // drag across the terminal selects continuously.
            const publishSelection = () => {
                if (suppressSelectionClip) return;
                const selected = term?.getSelection();
                if (!selected) return;
                rememberBetterShapeClip({ kind: "terminal", text: selected, label: tab.title || "Terminal" });
            };
            term.onSelectionChange(() => {
                if (!term?.hasSelection()) return;
                publishSelection();
            });
// The hidden textarea is the path that still works when the async clipboard is
            // denied, and it comes out of the body whether or not the copy lands.
            const copySelected = (selected: string) => {
                rememberBetterShapeClip({ kind: "terminal", text: selected, label: tab.title || "Terminal" });
                const area = document.createElement("textarea");
                area.value = selected;
                area.setAttribute("readonly", "");
                area.style.position = "fixed";
                area.style.left = "-9999px";
                document.body.appendChild(area);
                area.select();
                document.execCommand("copy");
                area.remove();
            };
            const host = terminalRef.current;
// Takes the event only when the terminal holds a selection, so the browser keeps
            // its own copy behaviour for every other copy on the page.
            const onCopy = (event: ClipboardEvent) => {
                const selected = term?.getSelection();
                if (!selected) return;
                event.preventDefault();
                event.clipboardData?.setData("text/plain", selected);
                rememberBetterShapeClip({ kind: "terminal", text: selected, label: tab.title || "Terminal" });
            };
// Capture phase with `stopPropagation`: without both, the key reaches the shell
            // and Ctrl+C interrupts the running process instead of copying.
            const onCopyKey = (event: KeyboardEvent) => {
                if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "l") {
                    const rawSelected = term?.hasSelection() ? term.getSelection() : "";
                    if (!rawSelected.trim()) return;
                    let trimEnd = rawSelected.length;
                    while (
                        trimEnd > 0 &&
                        (rawSelected.charCodeAt(trimEnd - 1) === 10 ||
                            rawSelected.charCodeAt(trimEnd - 1) === 13)
                    ) {
                        trimEnd -= 1;
                    }
                    const selected = rawSelected.slice(0, trimEnd);
                    event.preventDefault();
                    event.stopPropagation();
                    const file = terminalAttachmentFile(selected, tab.title || "Terminal");
                    window.dispatchEvent(
                        new CustomEvent("bettershape-layout-toggle", {
                            detail: { id: "secondary-sidebar", value: true },
                        }),
                    );
                    window.dispatchEvent(
                        new CustomEvent("bettershape-chat-attach-files", {
                            detail: { files: [file] },
                        }),
                    );
                    window.dispatchEvent(new CustomEvent("bettershape-chat-focus-input"));
                    return;
                }
                if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "c" || event.shiftKey) return;
                const selected = term?.hasSelection() ? term.getSelection() : "";
                if (!selected) return;
                event.preventDefault();
                event.stopPropagation();
                copySelected(selected);
            };
            host?.addEventListener("copy", onCopy);
            host?.addEventListener("keydown", onCopyKey, true);
            detachCopy = () => {
                host?.removeEventListener("copy", onCopy);
                host?.removeEventListener("keydown", onCopyKey, true);
            };

            // Enabling windowsMode specifically for ConPTY buffer handling
            // @ts-expect-error - internal property
            term._core.options.windowsMode = true;

            fitAddon = new FitAddon();
            term.loadAddon(fitAddon);
            // The effect resolved the host element into `host` above, after the ref check.
            if (host) term.open(host);
            try { term.loadAddon(new WebglAddon()); } catch { }

            fitAddon.fit();

            // Replay last session's history before the new pty paints anything,
            // so the restored text sits above the fresh prompt. Once per
            // shell+cwd per session (see takeRestoreCandidate).
            if (tab.boundPtyId === undefined && tab.shell !== "ai") {
                const restored = takeRestoreCandidate({ cwd: tab.cwd, shell: tab.shell });
                if (restored) {
                    term.write(restored.replace(/\n/g, "\r\n") + "\r\n");
                    term.write(
                        "\x1b[38;2;113;113;122m\u2500\u2500 restored from previous session \u2500\u2500\x1b[0m\r\n",
                    );
                }
            }

            if (tab.shell === "ai" && tab.boundPtyId === undefined) {
                term.write(`Agent Terminal\r\n\r\n`);
                unlistenOutput = await listen<{ type: string; command?: string; data?: string; exitCode?: number }>("bettershape-terminal-ai-action", (e) => {
                    const pay = e.payload;
                    const ts = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
                    if (pay.type === "start") {
                        term?.write(`\x1b[38;2;113;113;122m${ts}\x1b[0m  \x1b[38;2;120;120;120m$ ${pay.command}\x1b[0m\r\n`);
                    } else if (pay.type === "data" && pay.data) {
                        const warn = /\[warn\]|warn(ing)?:/i.test(pay.data);
                        const err = /\[error\]|error:/i.test(pay.data);
                        if (warn) {
                            term?.write(`\x1b[48;2;180;83;9m\x1b[38;2;255;255;255m${ts}\x1b[0m  ${pay.data}`);
                        } else if (err) {
                            term?.write(`\x1b[38;2;239;68;68m${ts}\x1b[0m  ${pay.data}`);
                        } else {
                            term?.write(`\x1b[38;2;113;113;122m${ts}\x1b[0m  ${pay.data}`);
                        }
                    } else if (pay.type === "finish") {
                        term?.write(`\r\n\x1b[38;2;120;120;120m[Process exited with code ${pay.exitCode}]\x1b[0m\r\n\r\n`);
                        term?.scrollToBottom();
                    }
                });

                globalTerminalStore.instances.set(tab.id, { term, fitAddon, ptyId: -1, unlistenOutput });
                xtermRef.current = term;
                fitAddonRef.current = fitAddon;
                if (isActive) {
                    term.focus();
                    term.scrollToBottom();
                }
                return;
            }

            try {
                ptyId = tab.boundPtyId ?? createPtyId();
                unlistenOutput = await listen<{ id: number; data: string }>("pty-output", (e) => {
                    if (e.payload.id === ptyId && term) {
                        queueOutput(e.payload.data);
                        // Tells the tab strip this tab has output the user has not
                        // looked at yet. A no-op past the first chunk.
                        globalTerminalStore.noteOutput(ptyId);

                        // Detect development server URLs for the Preview panel
                        const devMatch = e.payload.data.match(/https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d+/);
                        if (devMatch) {
                            setLastDevUrl(devMatch[0]);
                        }
                        void loadRunStatus().then(({ noteDevRunOutput }) => {
                            noteDevRunOutput(e.payload.data);
                        }).catch(() => undefined);
                    }
                });
                const unlistenExit = await listen<{ id: number; exit_code: number | null }>("pty-exit", (e) => {
                    if (e.payload.id === ptyId && term) {
                        flushOutput();
                        const code = e.payload.exit_code ?? 0;
                        term.write(`\r\n\x1b[38;2;120;120;120m[Process exited with code ${code}]\x1b[0m\r\n`);
                        term.scrollToBottom();
                        void loadRunStatus().then(({ noteDevRunExit }) => {
                            noteDevRunExit(code);
                        }).catch(() => undefined);
                    }
                });
                const originalUnlistenOutput = unlistenOutput;
// Chains onto the output listener the reuse path already installed, so teardown
                // has to release that one first and the exit one after it.
                const combinedUnlisten = () => {
                    originalUnlistenOutput?.();
                    unlistenExit();
                };
                unlistenOutput = combinedUnlisten;

                if (tab.boundPtyId === undefined) {
                    const spawnedId = await invoke<number>("pty_spawn", {
                        cwd: tab.cwd !== "global" ? tab.cwd : null,
                        shell: tab.shell,
                        clientId: ptyId,
                        rows: Math.max(4, term.rows || 24),
                        cols: Math.max(20, term.cols || 80)
                    });
                    ptyId = spawnedId;
                    lastPtySize.set(ptyId, { cols: Math.max(20, term.cols || 80), rows: Math.max(4, term.rows || 24) });
                } else {
                    // Replay Rust-buffered output (source of truth while Terminal was closed),
                    // then any JS scrollback that arrived after the last Rust read.
                    try {
                        const snap = await invoke<{ output?: string }>("pty_read_output", {
                            id: ptyId,
                            tailChars: 200_000,
                        });
                        if (snap?.output) term.write(snap.output);
                    } catch { /* ignore */ }
                    try {
                        const { terminalSessionStore } = await import("@/features/terminal/session");
                        const buffered = terminalSessionStore.takePtyScrollback(ptyId);
                        if (buffered) term.write(buffered);
                    } catch { /* ignore */ }
                    // Agent-spawned sessions start at a fixed size; sync to the visible xterm.
                    try {
                        fitAddon.fit();
                        const cols = Math.max(20, term.cols || 80);
                        const rows = Math.max(4, term.rows || 24);
                        await invoke("pty_resize", { id: ptyId, rows, cols });
                        lastPtySize.set(ptyId, { cols, rows });
                    } catch { /* ignore */ }
                    if (tab.shell === "ai") {
                        term.write(`\r\n\x1b[38;2;120;120;120m$ Agent command (session ${ptyId})\x1b[0m\r\n`);
                    }
                }

                term.onData(data => { if (ptyId !== undefined) invoke("pty_write", { id: ptyId, data }).catch(() => undefined); });
                term.onResize(size => {
                    // ConPTY reprints the viewport on pty_resize. Doing that while the
                    // pane is still being dragged wraps/duplicates the buffer.
                    if (isLayoutResizing()) return;
                    if (ptyId === undefined || size.cols < 20 || size.rows < 4) return;
                    const prev = lastPtySize.get(ptyId);
                    if (prev && prev.cols === size.cols && prev.rows === size.rows) return;
                    lastPtySize.set(ptyId, { cols: size.cols, rows: size.rows });
                    invoke("pty_resize", { id: ptyId, rows: size.rows, cols: size.cols }).catch(() => undefined);
                });

// Reads the palette from the document on each call; the theme changes under
                // `.dark` without React re-rendering this panel.
                const updateTheme = () => {
                    if (!term) return;
                    const comp = getComputedStyle(document.documentElement);
                    term.options.theme = {
                        background: comp.getPropertyValue('--panel').trim(),
                        foreground: comp.getPropertyValue('--foreground').trim(),
                        cursor: comp.getPropertyValue('--foreground').trim(),
                        selectionBackground: comp.getPropertyValue('--panel-active').trim() + "80",
                    };
                };
                updateTheme();
                const obs = new MutationObserver(updateTheme);
                obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
                (term as unknown as { _themeObserver?: MutationObserver })._themeObserver = obs;

                globalTerminalStore.instances.set(tab.id, { term, fitAddon, ptyId, unlistenOutput });
                xtermRef.current = term;
                fitAddonRef.current = fitAddon;
                if (tab.shell !== "ai" && globalTerminalStore.peekPendingCommandInsert(tab.id)) {
                    const attachedTerm = term;
                    pendingPasteTimer = setTimeout(() => {
                        const pendingCmd = globalTerminalStore.takePendingCommandInsert(tab.id);
                        if (!pendingCmd) return;
                        try {
                            attachedTerm.paste(pendingCmd);
                            attachedTerm.focus();
                            attachedTerm.scrollToBottom();
                        } catch {
                            /* ignore */
                        }
                    }, 60);
                }
                if (isActive) {
                    term.focus();
                    term.scrollToBottom();
                }
            } catch (e) {
                if (tab.shell !== "ai") {
                    globalTerminalStore.clearPendingCommandInsertForTab(tab.id);
                }
                unlistenOutput?.();
                if (term) term.write(`\r\n\x1b[31mError spawning terminal: ${e}\x1b[0m\r\n`);
                import("@/features/notifications").then(({ notify }) => {
                    notify.error("Terminal", `Error spawning terminal: ${e}`, { code: 4400 });
                }).catch(() => undefined);
            }
        };

        init().catch((e) => {
            console.error("Failed to initialize terminal:", e);
        });
        let fitTimer: ReturnType<typeof setTimeout> | undefined;
// Two modes on purpose: the immediate fit runs now, the delayed one collapses a
        // splitter drag's resize burst into one fit.
        const scheduleFit = (immediate = false) => {
            if (isLayoutResizing()) return;
// Re-checks the resize state here, because a delayed fit can land after the
            // user has started dragging the splitter again.
            const run = () => {
                if (isLayoutResizing()) return;
                try {
                    fitAddonRef.current?.fit();
                } catch { /* ignore */ }
            };
            if (immediate) {
                run();
                return;
            }
            if (fitTimer) clearTimeout(fitTimer);
            fitTimer = setTimeout(run, 200);
        };
        const resObs = new ResizeObserver(() => {
            if (isLayoutResizing()) return;
            scheduleFit(false);
        });
        resObs.observe(terminalRef.current);
// The window event forces the fit through, since the observer cannot see a
        // reflow caused by a layout class change.
        const onRefit = () => scheduleFit(true);
        window.addEventListener("bettershape-terminal-refit", onRefit);

        return () => {
            isMounted = false;
            detachCopy?.();
            flushOutput();
            if (fitTimer) clearTimeout(fitTimer);
            if (pendingPasteTimer) clearTimeout(pendingPasteTimer);
            resObs.disconnect();
            window.removeEventListener("bettershape-terminal-refit", onRefit);
            if (term?.element?.parentNode) term.element.parentNode.removeChild(term.element);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab.shell, tab.cwd, tab.id, isActive, waitForVisibleSize]);

    useEffect(() => {
// Applies font and scrollback in place: the pty keeps its size, so the terminal
        // reflows rather than restarting.
        const applyTerminalSettings = () => {
            const term = xtermRef.current;
            if (!term) return;
            const ts = getSettings().terminal;
            const mono = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim();
            term.options.fontFamily = ts.fontFamily || mono || "monospace";
            term.options.fontSize = ts.fontSize;
            term.options.scrollback = ts.scrollback;
        };
        window.addEventListener("bettershape-settings-changed", applyTerminalSettings);
        return () => window.removeEventListener("bettershape-settings-changed", applyTerminalSettings);
    }, []);

    useEffect(() => {
        if (isActive && fitAddonRef.current && xtermRef.current) {
            const raf = requestAnimationFrame(() => {
                if (isLayoutResizing()) return;
                if (fitAddonRef.current && xtermRef.current) {
                    fitAddonRef.current.fit();
                    xtermRef.current.focus();
                    xtermRef.current.scrollToBottom();
                }
            });
            return () => cancelAnimationFrame(raf);
        }
    }, [isActive]);

// Button path for the same copy as the key handler; the clipboard promise is
    // settled either way because the history entry is already written.
    const copySelection = () => {
        const term = xtermRef.current;
        const selected = term?.getSelection();
        if (!term || !selected) return;
        rememberBetterShapeClip({ kind: "terminal", text: selected, label: tab.title || "Terminal" });
        const area = document.createElement("textarea");
        area.value = selected;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.left = "-9999px";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
        navigator.clipboard.writeText(selected).catch(() => undefined);
    };

// A denied or empty clipboard is not an error: pasting nothing beats throwing
    // inside a keybinding, so the read is guarded and an empty read is dropped.
    const pasteClipboard = async () => {
        const term = xtermRef.current;
        if (!term) return;
        let text = "";
        try {
            text = await navigator.clipboard.readText();
        } catch {
            text = "";
        }
        if (text) term.paste(text);
    };

    const sendSelectionToChat = () => {
        const term = xtermRef.current;
        const selected = term?.getSelection()?.trim();
        if (!term || !selected) return;
        const file = terminalAttachmentFile(selected, tab.title || "Terminal");
        window.dispatchEvent(
            new CustomEvent("bettershape-layout-toggle", {
                detail: { id: "secondary-sidebar", value: true },
            }),
        );
        window.dispatchEvent(
            new CustomEvent("bettershape-chat-attach-files", {
                detail: { files: [file] },
            }),
        );
        window.dispatchEvent(new CustomEvent("bettershape-chat-focus-input"));
    };

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <div className="h-full w-full overflow-hidden bg-panel p-3" ref={terminalRef} />
            </ContextMenuTrigger>
            <ContextMenuContent>
                <ContextMenuItem onClick={copySelection}>
                    Copy
                    <ContextMenuShortcut>Ctrl+Shift+C</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem onClick={() => { pasteClipboard().catch(() => undefined); }}>
                    Paste
                    <ContextMenuShortcut>Ctrl+Shift+V</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem onClick={sendSelectionToChat}>
                    <Icon icon={Chat20Regular} />
                    Add Selection to Chat
                    <ContextMenuShortcut>Ctrl+Shift+L</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => xtermRef.current?.selectAll()}>
                    Select All
                </ContextMenuItem>
                <ContextMenuItem onClick={() => xtermRef.current?.clearSelection()}>
                    Clear Selection
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                    onClick={() =>
                        window.dispatchEvent(
                            new CustomEvent("bettershape-terminal-shortcut", {
                                detail: { action: "find" },
                            }),
                        )
                    }
                >
                    Find…
                    <ContextMenuShortcut>Ctrl+F</ContextMenuShortcut>
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
};

/** Renders the Terminal UI component. */
const Terminal = ({
    onClose,
    isOpen,
    terminalOnly = false,
}: {
    onClose?: () => void;
    isOpen?: boolean;
    /** Hide Problems/Output/Tests chrome, terminal tabs only. */
    terminalOnly?: boolean;
}) => {
    usePerfRenderCount("terminal");
    const { project_path } = useProjectState();
    const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>(globalTerminalStore.tabs);
    const [projectActiveTabs, setProjectActiveTabs] = useState<Record<string, string | null>>(globalTerminalStore.activeProjectTabs);
    const [secondaryActiveTabs, setSecondaryActiveTabs] = useState<Record<string, string | null>>(globalTerminalStore.activeSecondaryTabs);
    const [focusedGroups, setFocusedGroups] = useState<Record<string, TerminalGroupId>>(globalTerminalStore.focusedGroup);
    const [unreadTabs, setUnreadTabs] = useState<Set<string>>(new Set(globalTerminalStore.unreadTabs));
    const safeCwd = project_path || "global";
    const currentTabs = terminalTabs.filter(t => t.cwd === safeCwd);
    const leftTabs = currentTabs.filter((t) => (t.group ?? "left") === "left");
    const rightTabs = currentTabs.filter((t) => t.group === "right");
    const splitEnabled = rightTabs.length > 0;
    const activeTerminalId = projectActiveTabs[safeCwd] || null;
    const secondaryTerminalId = secondaryActiveTabs[safeCwd] || null;
    const focusedGroup = focusedGroups[safeCwd] || "left";
    const [activeView, setActiveView] = useState<"terminal" | "tests">("terminal");
    const [availableShells, setAvailableShells] = useState<TerminalShellProfile[]>([]);
    const tabScrollRef = useRef<HTMLDivElement>(null);
    const [splitRatio, setSplitRatio] = useState(0.5);
    const splitDragging = useRef(false);

    // In-buffer search over the focused pane's terminal.
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchMatches, setSearchMatches] = useState<TerminalMatch[]>([]);
    const [searchActive, setSearchActive] = useState(-1);
    const searchInputRef = useRef<HTMLInputElement>(null);

    // What counts as seen depends on this panel being on screen and on which project it
    // is showing, and only this component knows either. A docked-but-closed panel keeps
    // its tabs mounted, so without this its active tab would swallow every dot.
    useEffect(() => {
        globalTerminalStore.setPanel({ visible: Boolean(isOpen), cwd: project_path || null });
    }, [isOpen, project_path]);

    useEffect(() => {
        if (!project_path) return;
        globalTerminalStore.setTabs((tabs) => {
            let changed = false;
            const next = tabs.map((tab) => {
                if (tab.cwd === "global") {
                    changed = true;
                    return { ...tab, cwd: project_path };
                }
                return tab;
            });
            return changed ? next : tabs;
        });
        const legacyActive = globalTerminalStore.activeProjectTabs["global"];
        if (legacyActive) {
            globalTerminalStore.setActive(project_path, legacyActive);
            globalTerminalStore.setActive("global", null);
        }
    }, [project_path]);

    const ensurePanelOpen = useCallback(() => {
        window.dispatchEvent(new CustomEvent("bettershape-layout-toggle", { detail: { id: "panel", value: true } }));
    }, []);

    useEffect(() => {
// Pulls the browser tab module in on demand; the event fires once and the
        // terminal does not need that module to render.
        const handleOpenBrowser = () => {
            import("@/lib/window/browser-tab").then(({ openBrowserTab }) => openBrowserTab()).catch(() => undefined);
        };
        const handleOpenWorkspaceTerminal = () => {
            setActiveView("terminal");
        };
        window.addEventListener("bettershape-open-preview", handleOpenBrowser);
        window.addEventListener("bettershape-open-workspace-terminal", handleOpenWorkspaceTerminal);
        return () => {
            window.removeEventListener("bettershape-open-preview", handleOpenBrowser);
            window.removeEventListener(
                "bettershape-open-workspace-terminal",
                handleOpenWorkspaceTerminal,
            );
        };
    }, []);

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined;
// Debounced to a single fit because one monitor change fires resize and focus
        // together, and the outer guard is re-checked inside the timer.
        const refit = () => {
            if (isLayoutResizing()) return;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                if (!isLayoutResizing()) refitAllTerminals().catch(() => undefined);
            }, 200);
        };
// Refits on the visible transition only: a hidden document measures zero, so a
        // refit there would store an empty size for the pty.
        const onVisibility = () => {
            if (document.visibilityState === "visible") refit();
        };
        document.addEventListener("visibilitychange", onVisibility);
        window.addEventListener("focus", refit);
        let unlistenResize: (() => void) | undefined;
        if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
            import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
                getCurrentWindow().onResized(() => refit()).then((fn) => {
                    unlistenResize = fn;
                }).catch(() => undefined);
            }).catch(() => undefined);
        }
        return () => {
            if (timer) clearTimeout(timer);
            document.removeEventListener("visibilitychange", onVisibility);
            window.removeEventListener("focus", refit);
            unlistenResize?.();
        };
    }, []);

    useEffect(() => {
        const unsub = globalTerminalStore.subscribe(() => {
            setTerminalTabs([...globalTerminalStore.tabs]);
            setProjectActiveTabs({ ...globalTerminalStore.activeProjectTabs });
            setSecondaryActiveTabs({ ...globalTerminalStore.activeSecondaryTabs });
            setFocusedGroups({ ...globalTerminalStore.focusedGroup });
            setUnreadTabs(new Set(globalTerminalStore.unreadTabs));
        });
        return () => {
            unsub();
        };
    }, []);

    const setActiveTerminalId = useCallback((id: string | null) => {
        globalTerminalStore.setActive(safeCwd, id);
        if (id) {
            const tab = globalTerminalStore.tabs.find((t) => t.id === id);
            if (tab?.group === "right") globalTerminalStore.setFocusedGroup(safeCwd, "right");
            else globalTerminalStore.setFocusedGroup(safeCwd, "left");
        }
    }, [safeCwd]);
    const setSecondaryTerminalId = useCallback(
        (id: string | null) => globalTerminalStore.setSecondaryActive(safeCwd, id),
        [safeCwd],
    );
    const closingRef = useRef(false);

    useEffect(() => {
        let cancelled = false;
        commands.ptyAvailableShells()
            .then((shells) => {
                if (!cancelled) setAvailableShells(shells);
            })
            .catch(() => {
                if (!cancelled) setAvailableShells([]);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const resolveAvailableDefaultShell = useCallback((): TerminalShell => {
        const preferred = resolveDefaultTerminalShell();
        if (availableShells.some((shell) => shell.id === preferred)) {
            return preferred;
        }
        return availableShells[0]?.id ?? preferred;
    }, [availableShells]);

    const closeTab = useCallback((id: string) => {
        globalTerminalStore.setTabs(prev => {
            const closing = prev.find((t) => t.id === id);
            const next = prev.filter(t => t.id !== id);
            const projectTabs = next.filter(t => t.cwd === safeCwd);
            const left = projectTabs.filter((t) => (t.group ?? "left") === "left");
            const right = projectTabs.filter((t) => t.group === "right");
            const inst = globalTerminalStore.instances.get(id);
            const killId = inst && inst.ptyId >= 0 ? inst.ptyId : closing?.boundPtyId;
            if (typeof killId === "number" && killId >= 0) {
                import("@tauri-apps/api/core")
                    .then(({ invoke }) => invoke("pty_kill", { id: killId }).catch(() => undefined))
                    .catch(() => undefined);
            }
            if (inst) {
                inst.unlistenOutput();
                (inst.term as unknown as { _themeObserver?: MutationObserver })._themeObserver?.disconnect();
                inst.term.dispose();
                globalTerminalStore.instances.delete(id);
            }
            if (projectTabs.length === 0) {
                closingRef.current = true;
                setTimeout(() => {
                    setActiveTerminalId(null);
                    setSecondaryTerminalId(null);
                }, 0);
                onClose?.();
                setTimeout(() => closingRef.current = false, 500);
            } else {
                if (closing?.group === "right") {
                    if (right.length === 0) {
                        setTimeout(() => setSecondaryTerminalId(null), 0);
                    } else if (secondaryTerminalId === id) {
                        setTimeout(() => setSecondaryTerminalId(right[right.length - 1].id), 0);
                    }
                } else if (activeTerminalId === id || !left.some(t => t.id === activeTerminalId)) {
                    const fallback = left[left.length - 1] ?? projectTabs[projectTabs.length - 1];
                    setTimeout(() => setActiveTerminalId(fallback.id), 0);
                }
            }
            return next;
        });
        setTimeout(() => { refitAllTerminals().catch(() => undefined); }, 50);
    }, [activeTerminalId, secondaryTerminalId, onClose, safeCwd, setActiveTerminalId, setSecondaryTerminalId]);

    const addTab = useCallback((shell: TerminalShell, group: TerminalGroupId = "left") => {
        const id = createTabId();
        ensurePanelOpen();
        globalTerminalStore.setTabs(tabs => {
            const title = getNextTerminalName(tabs, shell, safeCwd);
            return [...tabs, createTerminalTab(shell, title, safeCwd, id, undefined, group)];
        });
        if (group === "right") {
            setSecondaryTerminalId(id);
            globalTerminalStore.setFocusedGroup(safeCwd, "right");
        } else {
            setActiveTerminalId(id);
            globalTerminalStore.setFocusedGroup(safeCwd, "left");
        }
        setActiveView("terminal");
        setTimeout(() => { refitAllTerminals().catch(() => undefined); }, 80);
    }, [safeCwd, setActiveTerminalId, setSecondaryTerminalId, ensurePanelOpen]);

    /** Split like the editor: open a new terminal in the right pane (reuse split if present). */
    const splitTerminal = useCallback((shell?: TerminalShell) => {
        const resolved = shell ?? resolveAvailableDefaultShell();
        ensurePanelOpen();
        setActiveView("terminal");
        addTab(resolved, "right");
    }, [addTab, ensurePanelOpen, resolveAvailableDefaultShell]);

    const clearActiveTerminal = useCallback(() => {
        const id = focusedGroup === "right" ? secondaryTerminalId : activeTerminalId;
        if (!id) return;
        const inst = globalTerminalStore.instances.get(id);
        if (inst) {
            try {
                inst.term.clear();
            } catch {
                /* ignore */
            }
        }
        // "Clear" should survive a reload too, not just blank the live buffer.
        const tab = globalTerminalStore.tabs.find((t) => t.id === id);
        if (tab) clearTerminalSnapshot({ cwd: tab.cwd, shell: tab.shell });
    }, [focusedGroup, activeTerminalId, secondaryTerminalId]);

    // Listen for titlebar menu terminal commands
    useEffect(() => {
// One listener for the whole menu. Actions arrive as an event detail, so an
        // action this panel does not know has to fall through untouched.
        const handleTerminalShortcut = (e: Event) => {
            const custom = e as CustomEvent<{ action: string }>;
            if (!custom.detail) return;
            switch (custom.detail.action) {
                case "new":
                    addTab(resolveAvailableDefaultShell());
                    break;
                case "split":
                    splitTerminal();
                    break;
                case "close_tab":
                    if (focusedGroup === "right" && secondaryTerminalId) closeTab(secondaryTerminalId);
                    else if (activeTerminalId) closeTab(activeTerminalId);
                    break;
                case "close_all_tabs":
                    currentTabs.forEach((tab) => closeTab(tab.id));
                    break;
                case "clear":
                    clearActiveTerminal();
                    break;
                case "find":
                    setActiveView("terminal");
                    setSearchOpen(true);
                    break;
                case "close":
                    onClose?.();
                    break;
                case "open": {
                    ensurePanelOpen();
                    setActiveView("terminal");
                    const existing = globalTerminalStore.tabs.filter(t => t.cwd === safeCwd);
                    if (existing.length === 0) {
                        addTab(resolveAvailableDefaultShell());
                    } else if (activeTerminalId) {
                        setActiveTerminalId(activeTerminalId);
                    } else {
                        setActiveTerminalId(existing[0].id);
                    }
                    break;
                }
            }
        };

        window.addEventListener("bettershape-terminal-shortcut", handleTerminalShortcut as EventListener);
        // Commands requested while the panel was closed replay from here.
        const detachCommandHost = attachTerminalCommandHost();

        // Accepts only the two views this panel renders; anything else leaves the
        // active view where it was.
        const handleTerminalView = (e: Event) => {
            const view = (e as CustomEvent<string>).detail;
            if (view === "tests" || view === "terminal") {
                setActiveView(view);
            }
        };
        window.addEventListener("bettershape-terminal-view", handleTerminalView as EventListener);
        return () => {
            detachCommandHost();
            window.removeEventListener("bettershape-terminal-shortcut", handleTerminalShortcut as EventListener);
            window.removeEventListener("bettershape-terminal-view", handleTerminalView as EventListener);
        };
    }, [addTab, closeTab, onClose, safeCwd, activeTerminalId, secondaryTerminalId, focusedGroup, setActiveTerminalId, currentTabs, ensurePanelOpen, resolveAvailableDefaultShell, splitTerminal, clearActiveTerminal]);

    useEffect(() => {
        if (!isOpen || activeView !== "terminal" || closingRef.current) return;

        const projectTabs = terminalTabs.filter(t => t.cwd === safeCwd);
        if (projectTabs.length === 0) {
            // Prefer a background Run tab registered under this cwd (or legacy "global").
            const bound = terminalTabs.find(
                (t) =>
                    typeof t.boundPtyId === "number" &&
                    (t.cwd === safeCwd || (safeCwd !== "global" && t.cwd === "global")),
            );
            if (bound) {
                if (bound.cwd !== safeCwd) {
                    globalTerminalStore.setTabs((tabs) =>
                        tabs.map((t) => (t.id === bound.id ? { ...t, cwd: safeCwd } : t)),
                    );
                }
                setActiveTerminalId(bound.id);
                return;
            }
            const shell = resolveAvailableDefaultShell();
            const id = createTabId();
            globalTerminalStore.setTabs(tabs => {
                if (tabs.filter(t => t.cwd === safeCwd).length !== 0) return tabs;
                const title = getNextTerminalName(tabs, shell, safeCwd);
                return [...tabs, createTerminalTab(shell, title, safeCwd, id)];
            });
            setActiveTerminalId(id);
            return;
        }

        const left = projectTabs.filter((t) => (t.group ?? "left") === "left");
        const right = projectTabs.filter((t) => t.group === "right");
        if (!activeTerminalId || !left.some(t => t.id === activeTerminalId)) {
            if (left.length > 0) setActiveTerminalId(left[left.length - 1].id);
        }
        if (right.length > 0 && (!secondaryTerminalId || !right.some((t) => t.id === secondaryTerminalId))) {
            setSecondaryTerminalId(right[right.length - 1].id);
        }
    }, [activeTerminalId, secondaryTerminalId, activeView, isOpen, safeCwd, terminalTabs, resolveAvailableDefaultShell, setActiveTerminalId, setSecondaryTerminalId]);

    useEffect(() => {
        const pt = terminalTabs.filter(t => t.cwd === safeCwd && (t.group ?? "left") === "left");
        if (pt.length > 0 && (!activeTerminalId || !pt.some(t => t.id === activeTerminalId))) {
            setTimeout(() => setActiveTerminalId(pt[pt.length - 1].id), 0);
        }
    }, [activeTerminalId, safeCwd, terminalTabs, setActiveTerminalId]);

    const handleWheel = useCallback((e: React.WheelEvent) => {
        if (tabScrollRef.current) {
            tabScrollRef.current.scrollLeft += e.deltaY;
        }
    }, []);

    // ---- In-buffer search -------------------------------------------------
    // Targets the focused pane's active tab; the buffer is read on demand so a
    // closed or remounted terminal simply yields no matches.
    const searchTargetId =
        (focusedGroup === "right" ? secondaryTerminalId : null) ?? activeTerminalId;

    const searchTerm = useCallback((): XTermType | null => {
        if (!searchTargetId) return null;
        const inst = globalTerminalStore.instances.get(searchTargetId);
        return (inst?.term as XTermType | undefined) ?? null;
    }, [searchTargetId]);

    const focusMatch = useCallback((matches: TerminalMatch[], index: number) => {
        const term = searchTerm();
        if (!term || index < 0 || index >= matches.length) return;
        const match = matches[index]!;
        const rows = term.rows || 24;
        term.scrollToLine(Math.max(0, match.row - Math.floor(rows / 2)));
        suppressSelectionClip = true;
        term.select(match.col, match.row, match.length);
        window.setTimeout(() => {
            suppressSelectionClip = false;
        }, 50);
    }, [searchTerm]);

    const stepSearch = useCallback((delta: number) => {
        if (searchMatches.length === 0) return;
        const next = nextMatchIndex(searchActive, delta, searchMatches.length);
        setSearchActive(next);
        focusMatch(searchMatches, next);
    }, [searchActive, searchMatches, focusMatch]);

    const closeSearch = useCallback(() => {
        setSearchOpen(false);
        setSearchQuery("");
        setSearchMatches([]);
        setSearchActive(-1);
        try {
            searchTerm()?.clearSelection();
        } catch {
            /* terminal disposed */
        }
    }, [searchTerm]);

    useEffect(() => {
        if (!searchOpen) return;
        let cancelled = false;
        let timer: number | undefined;
        let attempts = 0;

        // Re-scan on query change (debounced) and when the focused pane moves.
        // The xterm instance is created asynchronously after the panel opens, so
        // retry briefly instead of showing "0/0" until the next keystroke.
        const run = () => {
            if (cancelled) return;
            const term = searchTerm();
            if (!term) {
                if (attempts++ < 12) timer = window.setTimeout(run, 200);
                return;
            }
            const buffer = term.buffer.active;
            const lines: string[] = [];
            for (let i = 0; i < buffer.length; i++) {
                lines.push(buffer.getLine(i)?.translateToString(true) ?? "");
            }
            if (cancelled) return;
            const matches = findTerminalMatches(lines, searchQuery);
            setSearchMatches(matches);
            const first = matches.length ? 0 : -1;
            setSearchActive(first);
            focusMatch(matches, first);
        };

        timer = window.setTimeout(run, 60);
        return () => {
            cancelled = true;
            if (timer !== undefined) window.clearTimeout(timer);
        };
    }, [searchOpen, searchQuery, searchTargetId, searchTerm, focusMatch]);

    useEffect(() => {
        if (!searchOpen) return;
        const id = window.setTimeout(() => {
            searchInputRef.current?.focus();
            searchInputRef.current?.select();
        }, 0);
        return () => window.clearTimeout(id);
    }, [searchOpen]);

    // Ctrl/Cmd+F inside the terminal opens the strip instead of browser find.
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
            if (event.code !== "KeyF" && event.key.toLowerCase() !== "f") return;
            const target = event.target as HTMLElement | null;
            if (!target?.closest?.('[data-terminal-root="true"]')) return;
            event.preventDefault();
            event.stopPropagation();
            setSearchOpen(true);
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, []);

    // Snapshot scrollback periodically and when the webview goes away, so a
    // reload keeps the visible history. Reads only the normal screen buffer.
    useEffect(() => {
        // Buffer position doubles as a dirty flag: snapshotting every tab every
        // tick means thousands of line renders on an idle session.
        const lastSnapshot = new Map<string, string>();
        const persist = (force = false) => {
            const entries: TerminalSnapshotEntry[] = [];
            for (const tab of globalTerminalStore.tabs) {
                const inst = globalTerminalStore.instances.get(tab.id);
                const term = inst?.term as XTermType | undefined;
                if (!term || (inst?.ptyId ?? 0) < 0) continue;
                try {
                    const buffer = term.buffer.active;
                    const marker = `${buffer.length}:${buffer.cursorX}:${buffer.cursorY}`;
                    if (!force && lastSnapshot.get(tab.id) === marker) continue;
                    lastSnapshot.set(tab.id, marker);
                    const text = snapshotBuffer(buffer);
                    if (text) entries.push({ target: { cwd: tab.cwd, shell: tab.shell }, text });
                } catch {
                    /* buffer disposed mid-write */
                }
            }
            // One JSON read/write for the whole tick, not one per dirty tab.
            saveTerminalSnapshots(entries);
        };
        const timer = window.setInterval(() => persist(), 10_000);
        const onVisibility = () => {
            if (document.visibilityState === "hidden") persist(true);
        };
        const onPageHide = () => persist(true);
        window.addEventListener("pagehide", onPageHide);
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener("pagehide", onPageHide);
            document.removeEventListener("visibilitychange", onVisibility);
            // Tab switches/unmounts are a free opportunity to flush.
            persist(true);
        };
    }, []);

    const view = terminalOnly ? "terminal" : activeView;

    useEffect(() => {
// The ratio is the only state this drag writes, and it is clamped at both ends so
        // neither pane can be dragged to zero width.
        const onMove = (e: MouseEvent) => {
            if (!splitDragging.current) return;
            const root = document.getElementById("terminal-split-root");
            if (!root) return;
            const rect = root.getBoundingClientRect();
            const next = Math.min(0.75, Math.max(0.25, (e.clientX - rect.left) / rect.width));
            setSplitRatio(next);
        };
// Clears the cursor and selection flags the drag set on the body, which has to
        // happen even when the pointer is released outside the window.
        const onUp = () => {
            if (!splitDragging.current) return;
            splitDragging.current = false;
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            document.body.removeAttribute("data-resizing");
            refitAllTerminals().catch(() => undefined);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
    }, []);

    const shellMenu = (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className={cn(WORKBENCH_TAB_ACTION_BUTTON_CLASS, "h-7 w-7")}
                    title="Terminal profiles"
                >
                    <Icon icon={ChevronDown20Regular} />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[220px]">
                {availableShells.length === 0 ? (
                    <DropdownMenuItem disabled>No terminals found</DropdownMenuItem>
                ) : (
                    availableShells.map((shell) => (
                        <DropdownMenuItem key={shell.id} onClick={() => addTab(shell.id)}>
                            {shell.label}
                        </DropdownMenuItem>
                    ))
                )}
                <DropdownMenuItem onClick={() => addTab("ai")}>Agent Terminal</DropdownMenuItem>
                <DropdownMenuSub>
                    <DropdownMenuSubTrigger>Split Terminal</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent >
                        {availableShells.map((shell) => (
                            <DropdownMenuItem key={`split-${shell.id}`} onClick={() => splitTerminal(shell.id)}>
                                {shell.label}
                            </DropdownMenuItem>
                        ))}
                        <DropdownMenuItem onClick={() => splitTerminal()}>Default Profile</DropdownMenuItem>
                    </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onClick={() =>
                        window.dispatchEvent(new Event("bettershape-open-settings"))
                    }
                >
                    Configure Terminal Settings
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );

    const renderTerminalTabs = (
        tabs: TerminalTab[],
        activeId: string | null,
        onActivate: (id: string) => void,
        scrollRef?: React.RefObject<HTMLDivElement | null>,
    ) => (
        <div
            ref={scrollRef}
            onWheel={handleWheel}
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto no-scrollbar"
        >
            {tabs.map((tab) => {
                const isActive = activeId === tab.id;
                const unread = !isActive && unreadTabs.has(tab.id);
                return (
                    <div
                        key={tab.id}
                        role="tab"
                        aria-selected={isActive}
                        tabIndex={0}
                        onClick={() => onActivate(tab.id)}
                        onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            onActivate(tab.id);
                        }}
                        className={workbenchTabItemClass(isActive)}
                    >
                        <span className="max-w-[160px] truncate text-sm">{tab.title}</span>
                        {unread ? <span className="sr-only">New output</span> : null}
                        {/* One 16px slot, two occupants: the unread dot hands it to
                            the close button under the pointer, at the same beat the
                            file tabs use, so no state change shifts the title. */}
                        <div className="relative flex h-4 w-4 shrink-0 items-center justify-center">
                            <span className="t-tab-dot absolute" data-on={unread ? "true" : "false"} aria-hidden />
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    closeTab(tab.id);
                                }}
                                className={cn(
                                    WORKBENCH_TAB_CLOSE_BUTTON_CLASS,
                                    "absolute transition-opacity duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]",
                                    isActive
                                        ? "opacity-100"
                                        // An inactive tab keeps its close button in the
                                        // tab order, so it has to become visible when the
                                        // keyboard reaches it; pointer users get it on hover.
                                        : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                                )}
                                aria-label={`Close ${tab.title}`}
                            >
                                <Icon icon={Dismiss20Regular} />
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>
    );

    const renderGroupChrome = (
        tabs: TerminalTab[],
        activeId: string | null,
        group: TerminalGroupId,
        onActivate: (id: string) => void,
        showShellMenu: boolean,
    ) => (
        <div className={cn(WORKBENCH_TAB_BAR_CLASS, "border-b border-border-subtle bg-panel px-2")}>
            {renderTerminalTabs(
                tabs,
                activeId,
                onActivate,
                group === "left" ? tabScrollRef : undefined,
            )}
            <div className="flex shrink-0 items-center gap-0.5">
                <Tooltip content="New Terminal">
                    <Button
                        variant="ghost"
                        size="icon"
                        className={cn(WORKBENCH_TAB_ACTION_BUTTON_CLASS, "h-7 w-7")}
                        onClick={() => addTab(resolveAvailableDefaultShell(), group)}
                    >
                        <Icon icon={Add20Regular} />
                    </Button>
                </Tooltip>
                {showShellMenu ? shellMenu : null}
                {terminalOnly && onClose && group === "left" ? (
                    <Tooltip content="Close terminal">
                        <Button
                            variant="ghost"
                            size="icon"
                            className={cn(WORKBENCH_TAB_ACTION_BUTTON_CLASS, "h-7 w-7")}
                            onClick={() => onClose()}
                            aria-label="Close terminal"
                        >
                            <Icon icon={Dismiss20Regular} />
                        </Button>
                    </Tooltip>
                ) : null}
            </div>
        </div>
    );

    const renderTerminalPane = (
        tabs: TerminalTab[],
        activeId: string | null,
        group: TerminalGroupId,
        onActivate: (id: string) => void,
        showShellMenu: boolean,
    ) => (
        <div
            role="presentation"
            className={cn(
                "flex h-full min-h-0 min-w-0 flex-col overflow-hidden",
                splitEnabled && focusedGroup === group && "ring-1 ring-inset ring-accent/20",
            )}
            onMouseDown={() => globalTerminalStore.setFocusedGroup(safeCwd, group)}
        >
            {renderGroupChrome(tabs, activeId, group, onActivate, showShellMenu)}
            <div className="relative min-h-0 flex-1 overflow-hidden">
                {tabs.map((tab) => (
                    <div
                        key={tab.id}
                        className={cn(
                            "absolute inset-0 overflow-hidden bg-transparent",
                            tab.id === activeId ? "z-10" : "pointer-events-none z-0 invisible",
                        )}
                    >
                        <TerminalInstance
                            tab={tab}
                            isActive={view === "terminal" && tab.id === activeId}
                        />
                    </div>
                ))}
            </div>
        </div>
    );

    return (
        <div className="flex h-full w-full flex-col overflow-hidden bg-panel select-none font-sans" data-terminal-root="true">
            {!terminalOnly ? (
                <div className="relative z-20 flex h-12 min-w-0 shrink-0 items-center gap-1 px-2">
                    <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
                        {(["terminal", "tests"] as const).map((viewId) => {
                            const labels: Record<string, string> = {
                                tests: "Tests",
                                terminal: "Terminal",
                            };
                            const active = activeView === viewId;
                            return (
                                <Button
                                    key={viewId}
                                    type="button"
                                    variant="ghost"
                                    size="xs"
                                    className={cn(
                                        "",
                                        active
                                            ? "bg-surface-3 text-text-primary"
                                            : "text-text-muted hover:bg-[var(--btn-hover)] hover:text-text-secondary",
                                    )}
                                    onClick={() => setActiveView(viewId)}
                                >
                                    {labels[viewId]}
                                </Button>
                            );
                        })}
                    </div>

                    <div className="flex shrink-0 items-center gap-0.5">
                        {activeView === "terminal" ? (
                            <>
                                <Tooltip content="Find in Terminal">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className={cn(WORKBENCH_TAB_ACTION_BUTTON_CLASS, "h-7 w-7")}
                                        onClick={() => setSearchOpen((open) => !open)}
                                        aria-pressed={searchOpen}
                                        aria-label="Find in terminal"
                                    >
                                        <Icon icon={Search20Regular} />
                                    </Button>
                                </Tooltip>
                                <Tooltip content="Clear Terminal">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className={cn(WORKBENCH_TAB_ACTION_BUTTON_CLASS, "h-7 w-7")}
                                        onClick={clearActiveTerminal}
                                    >
                                        <Icon icon={Delete20Filled} />
                                    </Button>
                                </Tooltip>
                                <Tooltip content="Split Terminal">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className={cn(WORKBENCH_TAB_ACTION_BUTTON_CLASS, "h-7 w-7")}
                                        onClick={() => splitTerminal()}
                                    >
                                        <Icon icon={LayoutColumnTwo20Regular} />
                                    </Button>
                                </Tooltip>
                            </>
                        ) : null}
                        <Tooltip content="Hide Panel">
                            <Button
                                onClick={() => onClose?.()}
                                variant="ghost"
                                size="icon"
                                className={cn(WORKBENCH_TAB_ACTION_BUTTON_CLASS, "h-7 w-7")}
                            >
                                <Icon icon={ChevronUp20Regular} />
                            </Button>
                        </Tooltip>
                        <Button
                            onClick={() => onClose?.()}
                            variant="ghost"
                            size="icon"
                            className={cn(WORKBENCH_TAB_ACTION_BUTTON_CLASS, "h-7 w-7")}
                        >
                            <Icon icon={Dismiss20Regular} />
                        </Button>
                    </div>
                </div>
            ) : null}

            {searchOpen && view === "terminal" ? (
                <div
                    role="search"
                    aria-label="Find in terminal"
                    className="relative z-30 flex shrink-0 items-center gap-1 border-b border-border-subtle bg-panel px-2 py-1 transition-colors focus-within:border-accent/40"
                >
                    <Icon icon={Search20Regular} className="size-3.5 shrink-0 text-text-muted" />
                    <input
                        ref={searchInputRef}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                stepSearch(e.shiftKey ? -1 : 1);
                            } else if (e.key === "Escape") {
                                e.preventDefault();
                                e.stopPropagation();
                                closeSearch();
                            }
                        }}
                        placeholder="Find in terminal"
                        aria-label="Find in terminal"
                        spellCheck={false}
                        autoComplete="off"
                        className="h-6 min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted focus-visible:outline-none"
                    />
                    <span className="shrink-0 tabular-nums text-[11px] text-text-muted">
                        {searchQuery.trim()
                            ? searchMatches.length
                                ? `${searchActive + 1}/${searchMatches.length}`
                                : "0/0"
                            : ""}
                    </span>
                    <Tooltip content="Previous match (Shift+Enter)">
                        <Button
                            variant="ghost"
                            size="icon"
                            className={cn(WORKBENCH_TAB_ACTION_BUTTON_CLASS, "h-6 w-6")}
                            onClick={() => stepSearch(-1)}
                            disabled={searchMatches.length === 0}
                            aria-label="Previous match"
                        >
                            <Icon icon={ArrowUp20Regular} />
                        </Button>
                    </Tooltip>
                    <Tooltip content="Next match (Enter)">
                        <Button
                            variant="ghost"
                            size="icon"
                            className={cn(WORKBENCH_TAB_ACTION_BUTTON_CLASS, "h-6 w-6")}
                            onClick={() => stepSearch(1)}
                            disabled={searchMatches.length === 0}
                            aria-label="Next match"
                        >
                            <Icon icon={ArrowDown20Regular} />
                        </Button>
                    </Tooltip>
                    <Button
                        variant="ghost"
                        size="icon"
                        className={cn(WORKBENCH_TAB_ACTION_BUTTON_CLASS, "h-6 w-6")}
                        onClick={closeSearch}
                        aria-label="Close find"
                    >
                        <Icon icon={Dismiss20Regular} />
                    </Button>
                </div>
            ) : null}

            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                {view === "tests" ? (
                    <TestPanel />
                ) : null}
                <div
                    className={cn(
                        "absolute inset-0 overflow-hidden bg-transparent",
                        view !== "terminal" && "pointer-events-none invisible",
                    )}
                >
                    {splitEnabled ? (
                        <div id="terminal-split-root" className="flex h-full w-full min-w-0 overflow-hidden">
                            <div className="min-w-0 overflow-hidden" style={{ flex: splitRatio }}>
                                {renderTerminalPane(
                                    leftTabs,
                                    activeTerminalId,
                                    "left",
                                    (id) => {
                                        setActiveTerminalId(id);
                                        globalTerminalStore.setFocusedGroup(safeCwd, "left");
                                    },
                                    focusedGroup === "left",
                                )}
                            </div>
                            <div
                                role="presentation"
                                className="w-1 shrink-0 cursor-col-resize bg-border-subtle/40 hover:bg-accent/40 transition-colors"
                                onMouseDown={() => {
                                    splitDragging.current = true;
                                    document.body.setAttribute("data-resizing", "true");
                                    document.body.style.cursor = "col-resize";
                                    document.body.style.userSelect = "none";
                                }}
                            />
                            <div className="min-w-0 overflow-hidden" style={{ flex: 1 - splitRatio }}>
                                {renderTerminalPane(
                                    rightTabs,
                                    secondaryTerminalId,
                                    "right",
                                    (id) => {
                                        setSecondaryTerminalId(id);
                                        globalTerminalStore.setFocusedGroup(safeCwd, "right");
                                    },
                                    focusedGroup === "right",
                                )}
                            </div>
                        </div>
                    ) : (
                        renderTerminalPane(
                            leftTabs.length ? leftTabs : currentTabs,
                            activeTerminalId,
                            "left",
                            setActiveTerminalId,
                            true,
                        )
                    )}
                </div>
            </div>
        </div>
    );
};
export default Terminal;
