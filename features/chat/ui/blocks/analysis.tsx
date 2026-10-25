"use client";

import { DocumentSearch20Regular } from "@fluentui/react-icons/headless/svg/document-search";
import { Folder20Regular } from "@fluentui/react-icons/headless/svg/folder";
import { useState } from "react";
import { FileIcon } from "@/components/ui/file-icon";
import { Icon } from "@/components/ui/icon";
import { openProjectFile } from "@/lib/window/open-project-file";
import { ActionLine } from "./action-line";

type AnalysisItem = {
    type: "file" | "folder" | "search";
    label: string;
};

export function CodebaseAnalysis({ items, isActive }: { items: AnalysisItem[]; isActive?: boolean }) {
    const [isOpen, setIsOpen] = useState(false);

    const fileCount = items.filter((i) => i.type === "file").length;
    const folderCount = items.filter((i) => i.type === "folder").length;
    const searchCount = items.filter((i) => i.type === "search").length;

    const summary = [
        fileCount > 0 ? `${fileCount} files` : "",
        folderCount > 0 ? `${folderCount} folders` : "",
        searchCount > 0 ? `${searchCount} searches` : "",
    ]
        .filter(Boolean)
        .join(", ");

    return (
        <div className="my-1">
            <ActionLine
                action={isActive ? "Analyzing" : "Analyzed"}
                detail={isActive ? "codebase" : summary || "codebase"}
                icon={<Icon icon={DocumentSearch20Regular} className="size-3.5 text-text-muted/80" />}
                busy={Boolean(isActive)}
                open={items.length > 0 ? isOpen : undefined}
                onOpenChange={items.length > 0 ? setIsOpen : undefined}
            >
                {items.length > 0 ? (
                    <div className="mt-0.5 mb-1 flex w-full min-w-0 flex-col gap-0.5 pl-3.5">
                        {items.map((item, i) => {
                            if (item.type === "file") {
                                const name = item.label.split(/[\\/]/).pop() || item.label;
                                return (
                                    <button
                                        key={`${item.label}-${i}`}
                                        type="button"
                                        onClick={() => void openProjectFile(item.label)}
                                        className="flex min-h-[24px] w-fit max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-xs text-text-muted transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--row-hover)] hover:text-text-primary"
                                    >
                                        <FileIcon name={name} className="size-3.5 shrink-0 opacity-85" />
                                        <span className="truncate text-text-secondary">{item.label}</span>
                                    </button>
                                );
                            }
                            return (
                                <div
                                    key={`${item.label}-${i}`}
                                    className="flex min-h-[24px] items-center gap-1.5 px-1 py-0.5 text-xs text-text-muted"
                                >
                                    <Icon
                                        icon={item.type === "folder" ? Folder20Regular : DocumentSearch20Regular}
                                        className="size-3.5 shrink-0 text-text-muted/75"
                                    />
                                    <span className="truncate text-text-secondary">{item.label}</span>
                                </div>
                            );
                        })}
                    </div>
                ) : null}
            </ActionLine>
        </div>
    );
}
