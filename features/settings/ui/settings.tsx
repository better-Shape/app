"use client";

import React, { useMemo, useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import {
    useSettings,
    updateSettingSection,
    updateSettings,
    DEFAULT_SETTINGS,
    type BetterShapeSettings,
} from "@/lib/settings";
import { commands, useProjectState } from "@/lib/backend";
import { listen } from "@/lib/tauri/client-api";
import { Textarea } from "@/components/ui/textarea";
import { SearchInput } from "@/components/ui/search";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
    SettingRow,
    SettingSection,
    SettingCard,
    SettingSelect,
    SettingSwitch,
    SettingNumberSelect,
    FontFamilySelect,
    ExcludePatternsSelect,
    TERMINAL_FONT_PRESETS,
    FONT_SIZE_PRESETS,
    SCROLLBACK_PRESETS,
    AUTO_FETCH_INTERVAL_PRESETS,
} from "./shared/controls";
import { AiSettingsPanel } from "./sections/ai";
import { ProvidersSettingsView } from "./sections/providers";
import { clearRepoHistory } from "@/lib/workspace/repo-history";
import { HELP_LINKS } from "@/lib/errors/help-links";
import { isWorkspaceTrusted, listTrustedWorkspaces, trustWorkspace, untrustWorkspace } from "@/lib/workspace/trust";
import {
    checkForAppUpdates,
    describeUpdateStatus,
    downloadAndInstallUpdate,
    getUpdateStatus,
    relaunchToApplyUpdate,
    subscribeUpdateStatus,
} from "@/lib/window/updater";
import { HostedSidebarBack } from "@/features/agent/sidebar/hosted-nav";
import { Icon } from "@/components/ui/icon";
import { SETTINGS_NAV, allSettingsLeaves, type SettingsNavLeaf } from "./shared/nav";
import { KeyboardShortcutsView } from "./sections/shortcuts";
import { PluginsSettingsView } from "./sections/plugins";
import { McpSettingsView } from "./sections/mcp";
import { SkillsSettings } from "./sections/skills";
import { useRouter } from "next/navigation";
import { useRuntimeFlag } from "@/lib/runtime/store";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogBody,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    REPORT_CATEGORIES,
    chatsInCurrentProject,
    submitProblemReport,
    type ReportCategory,
} from "@/lib/feedback/report";

function EditorSettings({ settings }: { settings: BetterShapeSettings }) {
    const e = settings.editor;
    const f = settings.files;
    return (
        <>
        <SettingSection id="settings-editor-font" title="Tabs">
            <SettingRow title="Compact tab bar" description="Shorter tabs in the editor.">
                <SettingSwitch
                    checked={e.compactTabs}
                    onChange={(v) => updateSettingSection("editor", { compactTabs: v })}
                />
            </SettingRow>
        </SettingSection>
        <SettingSection title="Text">
            <SettingCard>
            <SettingRow title="Font size">
                <SettingNumberSelect
                    value={e.fontSize}
                    options={FONT_SIZE_PRESETS}
                    onChange={(v) => updateSettingSection("editor", { fontSize: v })}
                />
            </SettingRow>
            <SettingRow title="Font ligatures">
                <SettingSwitch
                    checked={e.fontLigatures}
                    onChange={(v) => updateSettingSection("editor", { fontLigatures: v })}
                />
            </SettingRow>
            <SettingRow title="Word wrap">
                <SettingSelect
                    value={e.wordWrap}
                    options={[
                        { value: "off", label: "Off" },
                        { value: "on", label: "On" },
                        { value: "bounded", label: "Bounded" },
                    ]}
                    onChange={(v) =>
                        updateSettingSection("editor", { wordWrap: v as BetterShapeSettings["editor"]["wordWrap"] })
                    }
                />
            </SettingRow>
            <SettingRow title="Line numbers">
                <SettingSelect
                    value={e.lineNumbers}
                    options={[
                        { value: "on", label: "On" },
                        { value: "off", label: "Off" },
                        { value: "relative", label: "Relative" },
                    ]}
                    onChange={(v) =>
                        updateSettingSection("editor", {
                            lineNumbers: v as BetterShapeSettings["editor"]["lineNumbers"],
                        })
                    }
                />
            </SettingRow>
            <SettingRow title="Minimap">
                <SettingSwitch
                    checked={e.minimap}
                    onChange={(v) => updateSettingSection("editor", { minimap: v })}
                />
            </SettingRow>
            </SettingCard>
        </SettingSection>
        <SettingSection title="Indentation">
            <SettingCard>
            <SettingRow title="Tab size">
                <SettingNumberSelect
                    value={e.tabSize}
                    options={[2, 4, 8]}
                    onChange={(v) => updateSettingSection("editor", { tabSize: v })}
                />
            </SettingRow>
            <SettingRow title="Insert spaces" description="Use spaces instead of tab characters.">
                <SettingSwitch
                    checked={e.insertSpaces}
                    onChange={(v) => updateSettingSection("editor", { insertSpaces: v })}
                />
            </SettingRow>
            <SettingRow title="Detect indentation" description="Match the indent already used in the file.">
                <SettingSwitch
                    checked={e.detectIndentation}
                    onChange={(v) => updateSettingSection("editor", { detectIndentation: v })}
                />
            </SettingRow>
            </SettingCard>
        </SettingSection>
        <SettingSection title="Saving">
            <SettingCard>
            <SettingRow title="Format on save">
                <SettingSwitch
                    checked={e.formatOnSave}
                    onChange={(v) => updateSettingSection("editor", { formatOnSave: v })}
                />
            </SettingRow>
            <SettingRow title="Auto save">
                <SettingSelect
                    value={e.autoSave}
                    options={[
                        { value: "off", label: "Off" },
                        { value: "afterDelay", label: "After delay" },
                        { value: "onFocusChange", label: "On focus change" },
                    ]}
                    onChange={(v) =>
                        updateSettingSection("editor", { autoSave: v as BetterShapeSettings["editor"]["autoSave"] })
                    }
                />
            </SettingRow>
            <SettingRow title="Trim trailing whitespace">
                <SettingSwitch
                    checked={e.trimTrailingWhitespace}
                    onChange={(v) => updateSettingSection("editor", { trimTrailingWhitespace: v })}
                />
            </SettingRow>
            <SettingRow title="Insert final newline">
                <SettingSwitch
                    checked={e.insertFinalNewline}
                    onChange={(v) => updateSettingSection("editor", { insertFinalNewline: v })}
                />
            </SettingRow>
            </SettingCard>
        </SettingSection>
        <SettingSection title="Caret">
            <SettingCard>
            <SettingRow title="Cursor style">
                <SettingSelect
                    value={e.cursorStyle}
                    options={[
                        { value: "line", label: "Line" },
                        { value: "block", label: "Block" },
                        { value: "underline", label: "Underline" },
                    ]}
                    onChange={(v) =>
                        updateSettingSection("editor", { cursorStyle: v as BetterShapeSettings["editor"]["cursorStyle"] })
                    }
                />
            </SettingRow>
            <SettingRow title="Smooth scrolling">
                <SettingSwitch
                    checked={e.smoothScrolling}
                    onChange={(v) => updateSettingSection("editor", { smoothScrolling: v })}
                />
            </SettingRow>
            <SettingRow title="Bracket colors">
                <SettingSwitch
                    checked={e.bracketPairColorization}
                    onChange={(v) => updateSettingSection("editor", { bracketPairColorization: v })}
                />
            </SettingRow>
            <SettingRow title="Indent guides">
                <SettingSwitch
                    checked={e.showIndentGuides}
                    onChange={(v) => updateSettingSection("editor", { showIndentGuides: v })}
                />
            </SettingRow>
            </SettingCard>
        </SettingSection>
        <SettingSection id="settings-files" title="Files">
            <SettingCard>
            <SettingRow title="Image preview">
                <SettingSwitch
                    checked={e.imagePreview}
                    onChange={(v) => updateSettingSection("editor", { imagePreview: v })}
                />
            </SettingRow>
            <SettingRow title="Line endings">
                <SettingSelect
                    value={f.defaultEol}
                    options={[
                        { value: "LF", label: "LF" },
                        { value: "CRLF", label: "CRLF" },
                    ]}
                    onChange={(v) =>
                        updateSettingSection("files", { defaultEol: v as BetterShapeSettings["files"]["defaultEol"] })
                    }
                />
            </SettingRow>
            <SettingRow title="Exclude" description="Folders left out of search.">
                <ExcludePatternsSelect
                    value={f.exclude}
                    onChange={(v) => updateSettingSection("files", { exclude: v })}
                />
            </SettingRow>
            </SettingCard>
        </SettingSection>
        </>
    );
}

function TerminalSettings({ settings }: { settings: BetterShapeSettings }) {
    const t = settings.terminal;
    return (
        <SettingSection id="settings-terminal" title="Integrated Terminal">
            <SettingRow title="Default Shell">
                <SettingSelect
                    value={t.defaultShell}
                    options={[
                        { value: "auto", label: "Auto Detect" },
                        { value: "powershell", label: "PowerShell" },
                        { value: "cmd", label: "Command Prompt" },
                        { value: "git-bash", label: "Git Bash" },
                    ]}
                    onChange={(v) => updateSettingSection("terminal", { defaultShell: v })}
                />
            </SettingRow>
            <SettingRow title="Font Family">
                <FontFamilySelect
                    value={t.fontFamily}
                    presets={TERMINAL_FONT_PRESETS}
                    onChange={(v) => updateSettingSection("terminal", { fontFamily: v })}
                />
            </SettingRow>
            <SettingRow title="Font Size">
                <SettingNumberSelect
                    value={t.fontSize}
                    options={FONT_SIZE_PRESETS}
                    onChange={(v) => updateSettingSection("terminal", { fontSize: v })}
                />
            </SettingRow>
            <SettingRow title="Scrollback Lines">
                <SettingNumberSelect
                    value={t.scrollback}
                    options={SCROLLBACK_PRESETS}
                    formatLabel={(n) => n.toLocaleString()}
                    onChange={(v) => updateSettingSection("terminal", { scrollback: v })}
                />
            </SettingRow>
            <SettingRow title="Copy On Select">
                <SettingSwitch checked={t.copyOnSelect} onChange={(v) => updateSettingSection("terminal", { copyOnSelect: v })} />
            </SettingRow>
        </SettingSection>
    );
}

function GitSettings({ settings }: { settings: BetterShapeSettings }) {
    const g = settings.git;
    return (
        <SettingSection id="settings-git" title="Source Control">
            <SettingRow title="Auto Fetch">
                <SettingSwitch checked={g.autoFetch} onChange={(v) => updateSettingSection("git", { autoFetch: v })} />
            </SettingRow>
            {g.autoFetch && (
                <SettingRow title="Auto Fetch Interval">
                    <SettingNumberSelect
                        value={g.autoFetchInterval}
                        options={AUTO_FETCH_INTERVAL_PRESETS}
                        formatLabel={(n) => (n >= 60 ? `${n / 60} min` : `${n}s`)}
                        onChange={(v) => updateSettingSection("git", { autoFetchInterval: v })}
                    />
                </SettingRow>
            )}
            <SettingRow title="Confirm Before Commit">
                <SettingSwitch checked={g.confirmBeforeCommit} onChange={(v) => updateSettingSection("git", { confirmBeforeCommit: v })} />
            </SettingRow>
            <SettingRow title="Graph Branch Avatars">
                <SettingSwitch checked={g.graphAvatars} onChange={(v) => updateSettingSection("git", { graphAvatars: v })} />
            </SettingRow>
            <SettingRow title="Graph Show All Branches">
                <SettingSwitch checked={g.graphShowAllBranches} onChange={(v) => updateSettingSection("git", { graphShowAllBranches: v })} />
            </SettingRow>
            <SettingRow title="Inline Git Blame">
                <SettingSwitch checked={g.blame.enabled} onChange={(v) => updateSettingSection("git", { blame: { enabled: v } })} />
            </SettingRow>
        </SettingSection>
    );
}

function AiSettings({
    settings,
    page,
}: {
    settings: BetterShapeSettings;
    page: "models" | "rules" | "workflows" | "context" | "subagents";
}) {
    return <AiSettingsPanel settings={settings} page={page} />;
}

function DeveloperSettings({ settings }: { settings: BetterShapeSettings }) {
    const dev = settings.developer;

    return (
        <>
            <SettingSection id="settings-developer" title="Developer">
                <SettingRow title="Developer Tools in context menu" description="Inspect BetterShape itself from the right-click menu.">
                    <SettingSwitch
                        checked={dev.enableDevTools}
                        onChange={(v) => updateSettingSection("developer", { enableDevTools: v })}
                    />
                </SettingRow>
            </SettingSection>
        </>
    );
}

function UpdatesSettings({ settings }: { settings: BetterShapeSettings }) {
    const u = settings.updates;
    const [version, setVersion] = useState("0.0.1");
    const [busy, setBusy] = useState(false);
    const status = React.useSyncExternalStore(subscribeUpdateStatus, getUpdateStatus, getUpdateStatus);

    useEffect(() => {
        void import("@tauri-apps/api/app")
            .then(({ getVersion }) => getVersion())
            .then(setVersion)
            .catch(() => {});
        void (async () => {
            const next = await checkForAppUpdates({ force: true, silent: true });
            if (next.kind === "available" && u.autoUpdate) {
                await downloadAndInstallUpdate();
            }
        })();
    }, [u.autoUpdate]);

    const statusLine = describeUpdateStatus(status);

    const runAction = async (kind: "check" | "install" | "restart") => {
        setBusy(true);
        try {
            if (kind === "check") {
                await checkForAppUpdates({ force: true, silent: false });
            } else if (kind === "install") {
                await downloadAndInstallUpdate();
            } else {
                await relaunchToApplyUpdate();
            }
        } catch {
            /* status is already set on the updater */
        } finally {
            setBusy(false);
        }
    };

    const downloading = status.kind === "downloading" || status.kind === "checking";

    return (
        <SettingSection id="settings-updates" title="About BetterShape">
            <SettingCard>
                <div className="flex items-center gap-3 px-3.5 py-3">
                    <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-text-primary">App</div>
                        <div className="text-xs text-text-muted">
                            Current version is v{version}. {statusLine}
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        {status.kind === "available" ? (
                            <Button
                                size="sm"
                                disabled={busy || downloading}
                                onClick={() => void runAction("install")}
                            >
                                Install {status.version}
                            </Button>
                        ) : null}
                        {status.kind === "ready" ? (
                            <Button
                                size="sm"
                                disabled={busy}
                                onClick={() => void runAction("restart")}
                            >
                                Restart now
                            </Button>
                        ) : null}
                        <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy || downloading}
                            onClick={() => void runAction("check")}
                        >
                            {status.kind === "checking" ? "Checking…" : "Check for updates"}
                        </Button>
                    </div>
                </div>
                <div className="flex items-center gap-3 px-3.5 py-3">
                    <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-text-primary">Updater</div>
                        <div className="text-xs text-text-muted">
                            {u.autoUpdate
                                ? "Downloads in the background. Restart to finish."
                                : "Manual checks only."}{" "}
                            Channel: {u.channel === "nightly" ? "Nightly" : "Stable"}.
                        </div>
                    </div>
                </div>
            </SettingCard>
            <SettingRow title="Automatic updates" description="Download new versions when they ship. Restart to apply them.">
                <SettingSwitch
                    checked={u.autoUpdate}
                    onChange={(v) => {
                        updateSettingSection("updates", { autoUpdate: v });
                        if (v) {
                            void (async () => {
                                const next = await checkForAppUpdates({ force: true, silent: true });
                                if (next.kind === "available") await downloadAndInstallUpdate();
                            })();
                        }
                    }}
                />
            </SettingRow>
            <SettingRow title="Update channel">
                <SettingSelect
                    value={u.channel}
                    options={[
                        { value: "stable", label: "Stable" },
                        { value: "nightly", label: "Nightly" },
                    ]}
                    onChange={(v) => {
                        const channel = v as BetterShapeSettings["updates"]["channel"];
                        updateSettingSection("updates", { channel });
                        void (async () => {
                            const next = await checkForAppUpdates({ force: true, silent: true, channel });
                            if (next.kind === "available" && u.autoUpdate) await downloadAndInstallUpdate();
                        })();
                    }}
                />
            </SettingRow>
        </SettingSection>
    );
}

function PrivacySettings({ settings, part }: { settings: BetterShapeSettings; part: "notifications" | "privacy" }) {
    const p = settings.privacy;
    if (part === "notifications") {
        const n = settings.notifications;
        return (
            <SettingSection id="settings-notifications" title="Notifications">
                <SettingRow title="Desktop notifications" description="Alerts while BetterShape is in the background.">
                    <SettingSwitch
                        checked={n.desktopEnabled}
                        onChange={(v) => {
                            updateSettingSection("notifications", { desktopEnabled: v });
                            if (v) {
                                void import("@/lib/notifications/desktop").then(({ ensureNotificationPermission }) =>
                                    ensureNotificationPermission(),
                                );
                            }
                        }}
                    />
                </SettingRow>
                <SettingCard>
                <SettingRow title="Generation finished" description="When a reply is ready.">
                    <SettingSwitch
                        checked={n.onGenerationComplete}
                        disabled={!n.desktopEnabled}
                        onChange={(v) => updateSettingSection("notifications", { onGenerationComplete: v })}
                    />
                </SettingRow>
                <SettingRow title="Approval required" description="When the agent is waiting on you.">
                    <SettingSwitch
                        checked={n.onApprovalRequired}
                        disabled={!n.desktopEnabled}
                        onChange={(v) => updateSettingSection("notifications", { onApprovalRequired: v })}
                    />
                </SettingRow>
                </SettingCard>
            </SettingSection>
        );
    }
    return (
        <>
            <SettingSection title="Startup">
                <SettingRow title="Show welcome page on startup">
                    <SettingSwitch
                        checked={p.showWelcomeOnStartup}
                        onChange={(v) => updateSettingSection("privacy", { showWelcomeOnStartup: v })}
                    />
                </SettingRow>
            </SettingSection>
            <SettingSection id="settings-privacy" title="Data Control">
                <SettingRow title="Clear recent folders">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            clearRepoHistory();
                            window.dispatchEvent(new Event("bettershape-repo-history-changed"));
                        }}
                    >
                        Clear
                    </Button>
                </SettingRow>
                <SettingRow title="Clear current chat">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            void commands.clearChatHistory().then(() => {
                                window.dispatchEvent(new CustomEvent("bettershape-chat-refresh"));
                            });
                        }}
                    >
                        Clear
                    </Button>
                </SettingRow>
                <SettingRow title="Skip checkpoint restore confirm" description="Restore a checkpoint without asking first.">
                    <SettingSwitch
                        checked={p.skipCheckpointRestoreConfirm}
                        onChange={(v) => updateSettingSection("privacy", { skipCheckpointRestoreConfirm: v })}
                    />
                </SettingRow>
            </SettingSection>
            <TrustedWorkspacesSection />
            <FeedbackSection />
            <SettingSection title="Legal">
                <SettingCard>
                <div className="px-3.5 py-2 text-sm">
                    <button
                        type="button"
                        className="block text-text-muted hover:text-text-primary transition-colors"
                        onClick={() => void commands.openUrlExternal(HELP_LINKS.license)}
                    >
                        Terms of Service
                    </button>
                    <button
                        type="button"
                        className="block text-text-muted hover:text-text-primary transition-colors"
                        onClick={() => void commands.openUrlExternal(HELP_LINKS.privacy)}
                    >
                        Privacy Policy
                    </button>
                </div>
                </SettingCard>
            </SettingSection>
        </>
    );
}

function TrustedWorkspacesSection() {
    const { project_path: p } = useProjectState();
    const [trusted, setTrusted] = useState<string[]>(() => listTrustedWorkspaces());
    const refresh = () => setTrusted(listTrustedWorkspaces());
    useEffect(() => {
        const evs = ["bettershape-workspace-trusted", "bettershape-workspace-untrusted", "bettershape-workspace-opened", "storage"];
        evs.forEach((e) => window.addEventListener(e, refresh));
        return () => evs.forEach((e) => window.removeEventListener(e, refresh));
    }, []);
    return (
        <SettingSection title="Workspace Trust">
            {p ? <SettingRow title="Current workspace" description={p}><SettingSwitch checked={isWorkspaceTrusted(p)} onChange={(v) => { (v ? trustWorkspace : untrustWorkspace)(p); refresh(); }} /></SettingRow> : null}
            <SettingCard>{trusted.length === 0 ? <div className="px-3.5 py-2.5 text-sm text-text-muted">No trusted workspaces.</div> : trusted.map((w) => <SettingRow key={w} title={w}><Button variant="outline" size="sm" onClick={() => { untrustWorkspace(w); refresh(); }}>Revoke</Button></SettingRow>)}</SettingCard>
        </SettingSection>
    );
}

function FeedbackSection() {
    const { project_path } = useProjectState();
    const [open, setOpen] = useState(false);
    const [message, setMessage] = useState("");
    const [category, setCategory] = useState<ReportCategory>("Agent / AI");
    const [chats, setChats] = useState<{ id: string; title: string }[]>([]);
    const [linkedId, setLinkedId] = useState<string>("");
    const [sending, setSending] = useState(false);
    const [error, setError] = useState("");
    const [sent, setSent] = useState(false);

    const close = (nextOpen: boolean) => {
        if (sending) return;
        setOpen(nextOpen);
        if (!nextOpen) {
            setMessage("");
            setLinkedId("");
            setError("");
            setSent(false);
        }
    };

    useEffect(() => {
        if (!open) return;
        void chatsInCurrentProject(project_path).then((list) => {
            setChats(list.filter((c) => !c.archived).map((c) => ({ id: c.id, title: c.title || "Untitled" })));
        }).catch(() => setChats([]));
    }, [open, project_path]);

    async function send() {
        const text = message.trim();
        if (text.length < 5) {
            setError("Write a bit more about what happened.");
            return;
        }
        setSending(true);
        setError("");
        try {
            const list = await chatsInCurrentProject(project_path);
            const conversation = linkedId
                ? list.find((c) => c.id === linkedId) ?? null
                : null;
            await submitProblemReport({
                category,
                message: text,
                conversation,
            });
            setSent(true);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Send failed");
        } finally {
            setSending(false);
        }
    }

    return (
        <>
            <SettingSection title="Feedback">
                <SettingRow title="Report a problem" description="Copies a redacted report to your clipboard and opens a prefilled GitHub issue. Optionally include one chat from this project.">
                    <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
                        Report
                    </Button>
                </SettingRow>
            </SettingSection>
            <AlertDialog open={open} onOpenChange={close}>
                <AlertDialogContent sizeClassName="max-w-md" onOpenAutoFocus={(e) => e.preventDefault()}>
                    {sent ? (
                        <>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Report sent</AlertDialogTitle>
                                <AlertDialogDescription>
                                    Thanks, we&apos;ll look into it.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <Button type="button" size="sm" onClick={() => close(false)}>
                                    Close
                                </Button>
                            </AlertDialogFooter>
                        </>
                    ) : (
                        <>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Report a problem</AlertDialogTitle>
                                <AlertDialogDescription>
                                    Describe what went wrong. You can attach one chat from this project.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogBody>
                                <label className="mb-1 block text-sm text-text-muted">Category</label>
                                <select
                                    className="mb-3 w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm"
                                    value={category}
                                    onChange={(e) => setCategory(e.target.value as ReportCategory)}
                                >
                                    {REPORT_CATEGORIES.map((c) => (
                                        <option key={c} value={c}>{c}</option>
                                    ))}
                                </select>
                                <label className="mb-1 block text-sm text-text-muted">Link a chat (optional)</label>
                                <select
                                    className="mb-3 w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm"
                                    value={linkedId}
                                    onChange={(e) => setLinkedId(e.target.value)}
                                >
                                    <option value="">None — do not attach a chat</option>
                                    {chats.map((c) => (
                                        <option key={c.id} value={c.id}>{c.title}</option>
                                    ))}
                                </select>
                                <Textarea
                                    value={message}
                                    onChange={(e) => setMessage(e.target.value)}
                                    placeholder="What were you doing?"
                                    className="min-h-32"
                                    autoFocus
                                />
                                {error ? <p className="mt-2 text-sm text-error">{error}</p> : null}
                            </AlertDialogBody>
                            <AlertDialogFooter>
                                <AlertDialogCancel asChild>
                                    <Button type="button" variant="ghost" size="sm" disabled={sending}>
                                        Cancel
                                    </Button>
                                </AlertDialogCancel>
                                <Button
                                    type="button"
                                    size="sm"
                                    disabled={!message.trim() || sending}
                                    onClick={() => void send()}
                                >
                                    {sending ? "Sending…" : "Send report"}
                                </Button>
                            </AlertDialogFooter>
                        </>
                    )}
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

export function SettingsView({
    navPortalTarget,
    sidebarExpanded = true,
    onBack,
}: {
    /** When set, the settings nav is rendered into this element (agent sidebar). */
    navPortalTarget?: HTMLElement | null;
    /** Agent sidebar expanded. When false, only Back stays in the rail. */
    sidebarExpanded?: boolean;
    onBack?: () => void;
} = {}) {
    const settings = useSettings();
    const agentsOn = useRuntimeFlag("desktop_agents", true);
    const searchParams = useSearchParams();
    const router = useRouter();
    const [query, setQuery] = useState("");
    const [activeLeafId, setActiveLeafId] = useState("providers");
    const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

    const resolveTargetFromDeepLink = useCallback((category?: string | null, section?: string | null): string | null => {
        if (section === "plugins") return "settings-ai-plugins";
        if (section === "mcp" || section === "integrations") return "settings-mcp";
        if (section === "rules") return "settings-ai-rules";
        if (section === "workflows") return "settings-ai-workflows";
        if (section === "subagents" || section === "subagent") return "settings-ai-subagents";
        // Legacy deep link: "memories" (System Instructions) merged into Rules.
        if (section === "memories") return "settings-ai-rules";
        switch (category) {
            case "account":
            case "general":
            case "providers":
                return "settings-providers";
            case "ai":
            case "agents":
                return "settings-ai-models";
            case "editor":
                return "settings-editor-font";
            case "terminal":
                return "settings-terminal";
            case "git":
                return "settings-git";
            case "appearance":
                return "settings-editor-font";
            case "advanced":
            case "application":
                return "settings-updates";
            case "keyboard-shortcuts":
            case "keybindings":
            case "shortcuts":
                return "settings-keyboard-shortcuts";
            default:
                return null;
        }
    }, []);

    const applyNavigation = useCallback(
        (category?: string | null, section?: string | null) => {
            const target = resolveTargetFromDeepLink(category, section);
            if (!target) return;
            const leaf = allSettingsLeaves().find((l) => l.targetId === target);
            if (leaf) setActiveLeafId(leaf.id);
        },
        [resolveTargetFromDeepLink],
    );

    useEffect(() => {
        applyNavigation(searchParams.get("category"), searchParams.get("section"));
    }, [searchParams, applyNavigation]);

    useEffect(() => {
        const handler = (event: Event) => {
            const custom = event as CustomEvent<{ category?: string; section?: string; path?: string }>;
            if (custom.detail?.path) {
                router.push(custom.detail.path);
                return;
            }
            applyNavigation(custom.detail?.category, custom.detail?.section);
        };
        window.addEventListener("bettershape-settings-navigate", handler as EventListener);
        let unlisten: (() => void) | null = null;
        void listen<{ category?: string; section?: string; path?: string }>(
            "bettershape-settings-navigate",
            (event) => {
                if (event.payload?.path) {
                    router.push(event.payload.path);
                    return;
                }
                applyNavigation(event.payload.category, event.payload.section);
            },
        )
            .then((fn) => {
                unlisten = fn;
            })
            .catch(() => undefined);
        return () => {
            window.removeEventListener("bettershape-settings-navigate", handler as EventListener);
            unlisten?.();
        };
    }, [applyNavigation, router]);

    const filteredNav = useMemo(() => {
        const hide = new Set<string>();
        if (!agentsOn) {
            hide.add("ai-subagents");
        }
        const q = query.trim().toLowerCase();
        return SETTINGS_NAV.map((group) => ({
            ...group,
            children: group.children.filter((leaf) => {
                if (hide.has(leaf.id)) return false;
                if (!q) return true;
                return leaf.label.toLowerCase().includes(q) || group.label.toLowerCase().includes(q);
            }),
        })).filter((group) => group.children.length > 0);
    }, [agentsOn, query]);

    const onLeafClick = (leaf: SettingsNavLeaf) => {
        if (leaf.href) {
            router.push(leaf.href);
            return;
        }
        setActiveLeafId(leaf.id);
    };

    return (
        <div
            className={cn(
                "flex h-full min-h-0 w-full min-w-0 overflow-hidden",
                navPortalTarget ? "bg-panel" : "bg-background",
            )}
        >
            {(() => {
                const collapsed = Boolean(navPortalTarget) && !sidebarExpanded;
                const nav = (
                    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
                        {onBack ? (
                            <HostedSidebarBack
                                label="Chat"
                                onBack={onBack}
                                collapsed={collapsed}
                            />
                        ) : null}
                        {collapsed ? null : (
                            <>
                                <div className="shrink-0 px-2 pb-2 mt-1">
                                    <SearchInput
                                        placeholder="Search..."
                                        value={query}
                                        onChange={(e) => setQuery(e.target.value)}
                                        className="w-full bg-transparent!"
                                    />
                                </div>
                                <nav className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                                    {filteredNav.map((group) => (
                                        <div key={group.id}>
                                            <div className="px-1.5 pb-1 text-sm text-text-muted/50">{group.label}</div>
                                            <div className="space-y-0.5">
                                                {group.children.map((leaf) => {
                                                    const active = activeLeafId === leaf.id;
                                                    return (
                                                        <button
                                                            key={leaf.id}
                                                            type="button"
                                                            onClick={() => onLeafClick(leaf)}
                                                            className={cn(
                                                                "flex h-9 w-full items-center gap-1.5 rounded-lg px-2 text-left text-sm",
                                                                active
                                                                    ? "bg-panel-hover text-text-primary"
                                                                    : "text-text-secondary hover:bg-panel-hover/50 hover:text-text-primary",
                                                            )}
                                                        >
                                                            <Icon icon={leaf.icon} className="icon-md settings-nav-icon"/>
                                                            <span className="min-w-0 flex-1 truncate">{leaf.label}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </nav>
                                <div className="shrink-0 px-2 pb-2">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="mt-0.5 h-8 w-full justify-start px-1.5! text-sm"
                                        onClick={() => setResetConfirmOpen(true)}
                                    >
                                        Reset to Defaults
                                    </Button>
                                </div>
                            </>
                        )}
                    </div>
                );
                if (navPortalTarget) return createPortal(nav, navPortalTarget);
                return (
                    <aside className="flex w-64 shrink-0 flex-col overflow-hidden bg-background">
                        {nav}
                    </aside>
                );
            })()}
            <section className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-panel">
                {activeLeafId === "keyboard-shortcuts" ? (
                    <div className="absolute inset-0 min-h-0">
                        <KeyboardShortcutsView />
                    </div>
                ) : activeLeafId === "plugins" ? (
                    <div className="absolute inset-0 min-h-0">
                        <PluginsSettingsView />
                    </div>
                ) : activeLeafId === "mcp" ? (
                    <div className="absolute inset-0 min-h-0">
                        <McpSettingsView />
                    </div>
                ) : (
                    <div className="absolute inset-0 overflow-y-auto px-8 py-8">
                        <div className="mx-auto w-full max-w-4xl">
                            <h1 className="mb-6 text-2xl font-medium text-text-primary">
                                {allSettingsLeaves().find((leaf) => leaf.id === activeLeafId)?.label}
                            </h1>
                            {activeLeafId === "providers" ? <ProvidersSettingsView /> : null}
                            {activeLeafId === "ai-models" ? <AiSettings settings={settings} page="models" /> : null}
                            {activeLeafId === "ai-subagents" ? <AiSettings settings={settings} page="subagents" /> : null}
                            {activeLeafId === "ai-rules" ? <AiSettings settings={settings} page="rules" /> : null}
                            {activeLeafId === "ai-workflows" ? <AiSettings settings={settings} page="workflows" /> : null}
                            {activeLeafId === "ai-skills" ? <SkillsSettings /> : null}
                            {activeLeafId === "ai-context" ? <AiSettings settings={settings} page="context" /> : null}
                            {activeLeafId === "editor-font" ? <EditorSettings settings={settings} /> : null}
                            {activeLeafId === "terminal" ? <TerminalSettings settings={settings} /> : null}
                            {activeLeafId === "git" ? <GitSettings settings={settings} /> : null}
                            {activeLeafId === "updates" ? <UpdatesSettings settings={settings} /> : null}
                            {activeLeafId === "notifications" ? <PrivacySettings settings={settings} part="notifications" /> : null}
                            {activeLeafId === "privacy" ? <PrivacySettings settings={settings} part="privacy" /> : null}
                            {activeLeafId === "developer" ? <DeveloperSettings settings={settings} /> : null}
                        </div>
                    </div>
                )}
            </section>

            <AlertDialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Reset all settings?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Account and files stay.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                            <Button variant="ghost" size="sm">
                                Cancel
                            </Button>
                        </AlertDialogCancel>
                        <AlertDialogAction asChild>
                            <Button
                                size="sm"
                                onClick={() => {
                                    localStorage.removeItem("bettershape-settings-v1");
                                    updateSettings(DEFAULT_SETTINGS);
                                    setResetConfirmOpen(false);
                                }}
                            >
                                Reset
                            </Button>
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
