"use client";

import { ArrowSync20Regular } from "@fluentui/react-icons/headless/svg/arrow-sync";
import { Code20Regular } from "@fluentui/react-icons/headless/svg/code";


import { useMemo } from "react";
import { Icon } from "@/components/ui/icon";

import { Tooltip } from "@/components/ui/tooltip";
import { SwapText } from "@/components/ui/swap";
import { FileIcon } from "@/components/ui/file-icon";
import { useProjectState, commands } from "@/lib/backend";
import { useAllProgressMessages } from "@/lib/ui/status-progress";
import { getLanguageLabel } from "@/features/editor/lib/language-options";
import { openLanguageModePicker } from "@/features/editor/ui/main/ui/language-picker";
import { useEditorSplitOptional, useSplitFocusedFile } from "@/core/providers/editor";
import {
    dispatchEditorAction,
    openStatusPalette,
    useEditorStatus,
} from "../hooks/use-editor-status";
import { GitStatusButton } from "./git-status";
import { StatusItem } from "./status-item";
import { PythonInterpreterStatus } from "./python-interpreter";

type SplitState = ReturnType<typeof useEditorSplitOptional>;

/** File the status bar describes: the focused split group wins when split. */
const pickStatusFile = (split: SplitState, activeFile: string | null | undefined): string | null => {
    if (split?.splitEnabled && split.focusedGroup === "right") {
        return split.getGroupActiveFile("right");
    }
    return activeFile ?? null;
};

/** Normalize a possibly-null path to forward slashes for comparison. */
const toSlashes = (path: string | null | undefined): string => (path ?? "").replace(/\\/g, "/");

/** True when `file` (normalised) lives directly under `base`. */
const isUnderBase = (file: string, base: string): boolean =>
    file.toLowerCase().startsWith(`${base.toLowerCase()}/`);

/** Project-relative display path for the status bar (basename fallback). */
const relativeStatusPath = (statusFile: string | null, projectPath: string | null | undefined): string => {
    if (!statusFile) return "";
    const base = toSlashes(projectPath).replace(/\/$/, "");
    if (!base) return statusFile;
    const normFile = toSlashes(statusFile);
    return isUnderBase(normFile, base)
        ? normFile.slice(base.length + 1)
        : statusFile.split(/[\\/]/).pop() || statusFile;
};

/** Spinning indicator for background progress messages (count badge if >1). */
const ProgressIndicator = ({ messages, latest }: { messages: string[]; latest: string }) => (
    <Tooltip content={messages.join("\n")}>
        <div className="hidden md:flex items-center gap-1.5 px-2 text-text-secondary max-w-[300px] min-w-0 whitespace-nowrap">
            <Icon icon={ArrowSync20Regular} className="animate-spin shrink-0" />
            <span className="truncate text-sm font-light">{latest}</span>
            {messages.length > 1 && (
                <span className="text-2xs text-text-muted shrink-0">+{messages.length - 1}</span>
            )}
        </div>
    </Tooltip>
);

/** Center breadcrumb button: reveals the current file in the OS file manager. */
const StatusFileCrumb = ({ statusFile, relativePath }: { statusFile: string; relativePath: string }) => (
    <button
        type="button"
        onClick={() => commands.revealPath(statusFile)}
        className="pointer-events-auto flex h-full max-w-[60%] cursor-pointer items-center gap-1.5 truncate px-3 font-light text-text-secondary transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:text-text-primary"
        title={statusFile}
    >
        <FileIcon name={relativePath.split(/[\\/]/).pop() || relativePath} className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{relativePath}</span>
    </button>
);


/** Right-hand editor status cluster (line/col, indentation, EOL, language). */
const EditorStatusItems = ({
    statusFile,
    projectPath,
    languageLabel,
    typescriptVersion,
    onIndentation,
    onEol,
}: {
    statusFile: string;
    projectPath: string | null;
    languageLabel: string;
    typescriptVersion: string | null;
    onIndentation: () => void;
    onEol: () => void;
}) => {
    const { editorStatus } = useEditorStatus();
    /** Open the language mode picker for the status file. */
    const openLanguagePicker = () => openLanguageModePicker(statusFile, editorStatus.language);
    /** Open the go-to-line palette. */
    const openLinePicker = () =>
        window.dispatchEvent(
            new CustomEvent("bettershape-command-palette", {
                detail: { mode: "goto_line", placeholder: "Line : Column" },
            }),
        );
    return (
        <>
            <StatusItem label="Go to Line/Column" onClick={openLinePicker}>
                {/* The one status value that changes while the user watches it, so it
                    crosses rather than blinking between two readings. Tabular digits
                    keep the digits themselves from shifting. */}
                <SwapText
                    value={`Ln ${editorStatus.line}, Col ${editorStatus.column}`}
                    durationMs={90}
                    className="tabular-nums"
                />
            </StatusItem>

            <StatusItem label="Select Indentation" onClick={onIndentation}>
                <span className="hidden sm:inline">
                    <SwapText
                        value={editorStatus.insertSpaces
                            ? `Spaces: ${editorStatus.spaces}`
                            : `Tab Size: ${editorStatus.spaces}`}
                    />
                </span>
                <span className="sm:hidden">{editorStatus.spaces}</span>
            </StatusItem>

            <StatusItem label="Select Encoding">
                <span className="hidden md:inline">UTF-8</span>
            </StatusItem>

            <StatusItem label="Select End of Line Sequence" onClick={onEol}>
                <span className="hidden md:inline">
                    <SwapText value={editorStatus.eol} />
                </span>
            </StatusItem>

            <Tooltip content="Format Document">
                <button
                    type="button"
                    className="hidden lg:flex h-full px-1.5 items-center text-text-primary hover:bg-[var(--row-hover)] transition-colors"
                    onClick={() => dispatchEditorAction("format")}
                >
                    <Icon icon={Code20Regular} />
                </button>
            </Tooltip>

            <StatusItem label="Select Language Mode" onClick={openLanguagePicker}>
                <span className="hidden sm:inline">
                    <SwapText value={languageLabel} />
                    {typescriptVersion && editorStatus.language.includes("typescript") && (
                        <span className="text-text-muted ml-1">TS {typescriptVersion}</span>
                    )}
                </span>
                <span className="sm:hidden">
                    <SwapText value={languageLabel.slice(0, 3).toUpperCase()} durationMs={90} />
                </span>
            </StatusItem>

            <PythonInterpreterStatus language={editorStatus.language} projectPath={projectPath} />
        </>
    );
};
/** Workbench status bar for the active project, editor, and background work. */
const Status = () => {
    // Status renders whenever a project is open. EditorSplitProvider mounts
    // only inside a file tab, so the split context is absent here and
    // pickStatusFile falls back to the backend active file.
    const split = useEditorSplitOptional();
    const splitFocusedFile = useSplitFocusedFile();
    const { active_file, project_path } = useProjectState();
    // Inside the provider the context is authoritative. Outside it, the backend's
    // active file can be the LEFT group's tab while the right group has focus, so
    // the published focused path wins whenever the provider has reported one.
    const statusFile = split
        ? pickStatusFile(split, active_file)
        : (splitFocusedFile ?? active_file ?? null);
    const progressMessages = useAllProgressMessages();
    const { editorStatus, typescriptVersion } = useEditorStatus();
    const latestProgressMessage = progressMessages[progressMessages.length - 1] ?? null;
    const hasEditor = Boolean(statusFile);

    const relativePath = useMemo(
        () => relativeStatusPath(statusFile, project_path),
        [statusFile, project_path],
    );

    const languageLabel = useMemo(
        () => getLanguageLabel(editorStatus.language || "plaintext"),
        [editorStatus.language],
    );

    /** Open the indentation picker (spaces, tabs, tab width). */
    const openIndentationPicker = () => {
        openStatusPalette("Select Indentation", [
            {
                id: "indent-spaces",
                label: "Indent Using Spaces",
                run: () => dispatchEditorAction("setInsertSpaces", { value: true }),
            },
            {
                id: "indent-tabs",
                label: "Indent Using Tabs",
                run: () => dispatchEditorAction("setInsertSpaces", { value: false }),
            },
            {
                id: "tab-2",
                label: "Tab Size: 2",
                run: () => dispatchEditorAction("setTabSize", { value: 2 }),
            },
            {
                id: "tab-4",
                label: "Tab Size: 4",
                run: () => dispatchEditorAction("setTabSize", { value: 4 }),
            },
            {
                id: "tab-8",
                label: "Tab Size: 8",
                run: () => dispatchEditorAction("setTabSize", { value: 8 }),
            },
        ]);
    };

    /** Open the LF/CRLF picker. */
    const openEolPicker = () => {
        openStatusPalette("Select End of Line Sequence", [
            { id: "eol-lf", label: "LF", run: () => dispatchEditorAction("setEol", { value: "LF" }) },
            {
                id: "eol-crlf",
                label: "CRLF",
                run: () => dispatchEditorAction("setEol", { value: "CRLF" }),
            },
        ]);
    };

    return (
        <div className="status-bar relative flex h-statusbar w-full select-none items-center bg-background text-text-muted text-xs font-light font-sans px-1 shrink-0">
            <div className="relative z-30 flex items-center h-full min-w-0 space-x-0.5">
                <GitStatusButton />

                {latestProgressMessage && (
                    <ProgressIndicator messages={progressMessages} latest={latestProgressMessage} />
                )}
            </div>

            <div className="pointer-events-none absolute inset-0 z-10 hidden items-center justify-center px-2 lg:flex">
                {statusFile && <StatusFileCrumb statusFile={statusFile} relativePath={relativePath} />}
            </div>

            <div className="relative z-30 ml-auto flex items-center h-full shrink-0 min-w-0">
                {hasEditor ? (
                    <EditorStatusItems
                        statusFile={statusFile as string}
                        projectPath={project_path}
                        languageLabel={languageLabel}
                        typescriptVersion={typescriptVersion}
                        onIndentation={openIndentationPicker}
                        onEol={openEolPicker}
                    />
                ) : null}
            </div>
        </div>
    );
};

export default Status;
