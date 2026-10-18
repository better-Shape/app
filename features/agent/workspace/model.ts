import type { IconGlyph } from "@/components/ui/icon";
import { Box20Regular } from "@fluentui/react-icons/headless/svg/box";
import { Branch20Regular } from "@fluentui/react-icons/headless/svg/branch";
import { BranchRequest20Regular } from "@fluentui/react-icons/headless/svg/branch-request";
import { DocumentText20Regular } from "@fluentui/react-icons/headless/svg/document-text";
import { DocumentSearch20Regular } from "@fluentui/react-icons/headless/svg/document-search";
import { Folder20Filled } from "@fluentui/react-icons/headless/svg/folder";
import { Globe20Regular } from "@fluentui/react-icons/headless/svg/globe";
import { PersonAccounts20Regular } from "@fluentui/react-icons/headless/svg/person-accounts";
import { PersonAdd20Regular } from "@fluentui/react-icons/headless/svg/person-add";
import { TaskListSquareLtr20Regular } from "@fluentui/react-icons/headless/svg/task-list-square-ltr";
import { Warning20Regular } from "@fluentui/react-icons/headless/svg/warning";
import { randomSuffix } from "@/lib/utils";

export type TabKind = "graph" | "agents" | "plan" | "file" | "diff" | "files" | "prs" | "browser" | "problems" | "search" | "packages" | "blame";

export type WorkspaceTab = {
    id: string;
    kind: TabKind;
    title: string;
    /** Absolute path for plan / file tabs. */
    path?: string;
    url?: string;
    favicon?: string;
    markdown?: string;
    diff?: {
        id: string;
        path: string;
        status: string;
        staged: boolean;
        repo: string;
        commit?: string;
        parent?: string;
    };
};

export function uid(prefix: string) {
    return `${prefix}-${randomSuffix(7)}`;
}

export const DEFAULT_TABS: WorkspaceTab[] = [
    { id: "graph", kind: "graph", title: "Graph" },
    { id: "files", kind: "files", title: "Files" },
];

export function iconFor(kind: TabKind): IconGlyph {
    switch (kind) {
        case "graph":
            return Branch20Regular;
        case "agents":
            return PersonAdd20Regular;
        case "plan":
            return TaskListSquareLtr20Regular;
        case "diff":
            return BranchRequest20Regular;
        case "files":
            return Folder20Filled;
        case "prs":
            return BranchRequest20Regular;
        case "browser":
            return Globe20Regular;
        case "problems":
            return Warning20Regular;
        case "search":
            return DocumentSearch20Regular;
        case "packages":
            return Box20Regular;
        case "blame":
            return PersonAccounts20Regular;
        default:
            return DocumentText20Regular;
    }
}
