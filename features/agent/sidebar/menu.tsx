"use client";

import { ArrowExit20Regular } from "@fluentui/react-icons/headless/svg/arrow-exit";
import { Compose20Regular } from "@fluentui/react-icons/headless/svg/compose";
import { FolderOpen20Regular } from "@fluentui/react-icons/headless/svg/folder-open";
import { Open20Regular } from "@fluentui/react-icons/headless/svg/open";
import { Search20Regular } from "@fluentui/react-icons/headless/svg/search";
import { Settings20Regular } from "@fluentui/react-icons/headless/svg/settings";

import { useCallback, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { useGitHubAuth } from "@/lib/github/store";
import { openSettingsWindow } from "@/lib/window/open-settings";
import { commands, useProjectState } from "@/lib/backend";
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown";

export function ProfileAvatar({
    gitAvatarUrl,
    name,
    size = 28,
}: {
    /** Avatar from the connected GitHub account, when there is one. */
    gitAvatarUrl: string | null;
    name: string;
    size?: number;
}) {
    const [failed, setFailed] = useState(false);
    const imageSrc = gitAvatarUrl;

    if (!imageSrc || failed) return null;

    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={imageSrc}
            alt={name}
            width={size}
            height={size}
            className="shrink-0 rounded-full object-cover"
            style={{ width: size, height: size }}
            onError={() => setFailed(true)}
        />
    );
}

export function AccountMenu({
    children,
    side = "bottom",
}: {
    children: ReactNode;
    side?: "top" | "bottom";
}) {
    const githubAuth = useGitHubAuth();
    const { project_path } = useProjectState();

    const displayName =
        (githubAuth.loggedIn && githubAuth.username ? githubAuth.username : null) ?? "Personal";

    const newChat = useCallback(() => {
        window.dispatchEvent(new Event("bettershape-chat-new"));
        window.dispatchEvent(new Event("bettershape-chat-focus-input"));
    }, []);

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
            <DropdownMenuContent align="start" side={side} className="w-56">
                <div className="flex items-center gap-2.5 px-2 py-1.5">
                    <ProfileAvatar
                        size={22}
                        gitAvatarUrl={githubAuth.loggedIn ? githubAuth.avatarUrl : null}
                        name={displayName}
                    />
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-text-primary">
                            {displayName}
                        </div>
                    </div>
                </div>


                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void openSettingsWindow()}>
                    <Icon icon={Settings20Regular} />
                    Settings
                </DropdownMenuItem>
                <DropdownMenuItem
                    onClick={() => window.dispatchEvent(new Event("bettershape-open-project-pick"))}
                >
                    <Icon icon={FolderOpen20Regular} />
                    Open folder
                </DropdownMenuItem>
                {project_path ? (
                    <DropdownMenuItem onClick={() => void commands.revealPath(project_path)}>
                        <Icon icon={Open20Regular} />
                        Reveal in Explorer
                    </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                    onClick={() =>
                        window.dispatchEvent(
                            new CustomEvent("bettershape-command-palette", {
                                detail: { placeholder: "Search…" },
                            }),
                        )
                    }
                >
                    <Icon icon={Search20Regular} />
                    Search
                </DropdownMenuItem>
                <DropdownMenuItem onClick={newChat}>
                    <Icon icon={Compose20Regular} />
                    New chat
                </DropdownMenuItem>

            </DropdownMenuContent>
        </DropdownMenu>
    );
}
