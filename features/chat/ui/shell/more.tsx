"use client";

import { ArrowDownload20Regular } from "@fluentui/react-icons/headless/svg/arrow-download";
import { Copy20Regular } from "@fluentui/react-icons/headless/svg/copy";
import { DocumentSearch20Regular } from "@fluentui/react-icons/headless/svg/document-search";
import { MoreHorizontal20Regular } from "@fluentui/react-icons/headless/svg/more-horizontal";
import { Search20Regular } from "@fluentui/react-icons/headless/svg/search";


import { Icon } from "@/components/ui/icon";

import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { openSettingsWindow } from "@/lib/window/open-settings";
import { getPlatform } from "@/lib/platform";
import { notify } from "@/features/notifications";
import {
    CHAT_COPY_MARKDOWN_EVENT,
    CHAT_EXPORT_MARKDOWN_EVENT,
    openChatFindBar,
} from "./find-bar";

async function downloadDiagnostics() {
    const payload = {
        exportedAt: new Date().toISOString(),
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        platform: getPlatform(),
        url: typeof window !== "undefined" ? window.location.href : "",
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `bettershape-diagnostics-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    notify.success("Diagnostics", "Diagnostic bundle downloaded.");
}

export function ChatMoreMenu() {
    const modLabel = getPlatform() === "macos" ? "⌘F" : "Ctrl+F";

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    aria-label="More chat actions"
                    className="size-[24px] text-text-muted hover:text-text-primary"
                >
                    <Icon icon={MoreHorizontal20Regular} />
                </Button>
            </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem
                    className="gap-2.5"
                    onClick={() => openChatFindBar()}
                >
                    <Icon icon={DocumentSearch20Regular} className="text-text-secondary" />
                    Find in chat...
                    <DropdownMenuShortcut>{modLabel}</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem
                    className="gap-2.5"
                    onClick={() => {
                        window.dispatchEvent(
                            new CustomEvent("bettershape-command-palette", {
                                detail: {
                                    filter: "agents",
                                    placeholder: "Search agents, files, actions...",
                                },
                            }),
                        );
                    }}
                >
                    <Icon icon={Search20Regular} className="text-text-secondary" />
                    Search history...
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    className="gap-2.5"
                    onClick={() => window.dispatchEvent(new Event(CHAT_COPY_MARKDOWN_EVENT))}
                >
                    <Icon icon={Copy20Regular} className="text-text-secondary" />
                    Copy chat as Markdown
                </DropdownMenuItem>
                <DropdownMenuItem
                    className="gap-2.5"
                    onClick={() => window.dispatchEvent(new Event(CHAT_EXPORT_MARKDOWN_EVENT))}
                >
                    <Icon icon={ArrowDownload20Regular} className="text-text-secondary" />
                    Export chat (.md)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onClick={() => void openSettingsWindow({ category: "general" })}
                >
                    Usage
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void downloadDiagnostics()}>
                    Download Diagnostics
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onClick={() => void openSettingsWindow({ category: "ai", section: "rules" })}
                >
                    Configure Rules
                </DropdownMenuItem>
                <DropdownMenuItem
                    onClick={() => void openSettingsWindow({ category: "ai", section: "workflows" })}
                >
                    Configure Workflows
                </DropdownMenuItem>
                <DropdownMenuItem
                    onClick={() => void openSettingsWindow({ category: "agents", section: "mcp" })}
                >
                    Configure MCP
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
