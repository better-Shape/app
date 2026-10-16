"use client";

import { GithubMark } from "@/components/ui/github-mark";
import { ChevronDown20Regular } from "@fluentui/react-icons/headless/svg/chevron-down";
import { Compose20Regular } from "@fluentui/react-icons/headless/svg/compose";
import { Search20Regular } from "@fluentui/react-icons/headless/svg/search";
import { Settings20Regular } from "@fluentui/react-icons/headless/svg/settings";

import { type IconGlyph, Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { loginGitHub, useGitHubAuth } from "@/lib/github/store";
import { openSettingsWindow } from "@/lib/window/open-settings";
import { ChatList } from "./chats";
import { AccountMenu, ProfileAvatar } from "./menu";
import { ChatUsageButton } from "@/features/chat/ui/composer/usage";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { SidebarToggleBtn, AGENT_SIDEBAR_BACK_SLOT } from "../chrome";
import type { AgentOverlay } from "../overlay";

export const AGENT_SIDEBAR_NAV_SLOT = "bettershape-agent-sidebar-nav";

/**
 * The fill of a nav row: the committed fill while it is the current page, the hover
 * midpoint otherwise.
 *
 * Stated once here because the collapsed icon and the expanded row now share one rung, and
 * a row that lost its hover state in either position was the bug this replaces. The
 * transition travels with the fill: a fill applied without one arrives as a hard cut.
 */
const navRowFill = (active?: boolean) =>
    cn(
        "transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]",
        active
            ? "bg-[var(--row-selected)] hover:bg-[var(--row-selected-hover)]"
            : "hover:bg-[var(--row-hover)]",
    );

/**
 * The name the account row shows.
 *
 * Signed out, or signed in without a login name, reads as `Personal`: the row is a menu
 * trigger, and an empty label there would show as a blank header.
 */
const accountName = (github: { loggedIn: boolean; username?: string | null }) =>
    github.loggedIn ? github.username || "Personal" : "Personal";

/**
 * The avatar the account row shows, or nothing when signed out.
 *
 * Read here rather than at the JSX so the signed-in branch is answered in one place, the
 * same place the name is.
 */
const accountAvatar = (github: { loggedIn: boolean; avatarUrl?: string | null }) =>
    github.loggedIn ? github.avatarUrl ?? null : null;

/**
 * Opens Settings in the shell. Fire-and-forget: a window that refuses to open is already
 * reported by the route itself, and a floating rejection here would only reach the console.
 */
const openSettings = () => {
    openSettingsWindow().catch(() => undefined);
};

/** Connects GitHub. The account menu shows the outcome, so the rejection stops here. */
const connectGitHub = () => {
    loginGitHub().catch(() => undefined);
};

/**
 * Both events a new chat needs: the one the shell listens for to create it, and the one the
 * composer listens for to take focus, so the caret is already in the box.
 */
const startNewChat = () => {
    window.dispatchEvent(new Event("bettershape-chat-new"));
    window.dispatchEvent(new Event("bettershape-chat-focus-input"));
};

/**
 * Toggles the sidebar through the host's handler when it passed one, and through the layout
 * event otherwise.
 *
 * The event is the window-mode path: the shell owns the width there, so a component that
 * toggled its own state would only disagree with it.
 */
const toggleSidebar = (onToggleSidebar?: () => void) => {
    if (onToggleSidebar) {
        onToggleSidebar();
        return;
    }
    window.dispatchEvent(
        new CustomEvent("bettershape-layout-toggle", {
            detail: { id: "primary-sidebar" },
        }),
    );
};

/** The aside's own width and border. Closed is a hairline, not a hole in the layout. */
const sidebarShellClass = (open: boolean, expanded: boolean) =>
    cn(
        "relative z-20 flex h-full shrink-0 flex-col overflow-hidden bg-sidebar text-text-primary",
        "transition-[width,border-color] duration-[var(--spring-quick-dur)] ease-[var(--spring-quick)]",
        !open ? "w-0 border-r-transparent" : expanded ? "w-80" : "w-12",
    );

/**
 * The column inside the aside.
 *
 * It keeps its committed width and travels out on the same spring as the aside, so the
 * contents slide rather than getting squeezed, and a closed sidebar leaves nothing to click.
 */
const sidebarColumnClass = (open: boolean, expanded: boolean) =>
    cn(
        "flex h-full min-h-0 shrink-0 flex-col",
        expanded ? "w-80" : "w-12",
        "transition-[opacity,transform] duration-[var(--spring-quick-dur)] ease-[var(--spring-quick)]",
        !open && "pointer-events-none -translate-x-full opacity-0",
    );

/** The footer's spacing, which differs by width: a column pads, the rail centers. */
const sidebarFooterClass = (expanded: boolean) =>
    cn("mt-auto shrink-0", expanded ? "px-1 pb-1" : "flex flex-col items-center gap-1 px-1 pb-2");

/**
 * The header a hosted app gets: its toggle, plus the two slots the host fills.
 *
 * `AGENT_SIDEBAR_BACK_SLOT` only exists while expanded, because the host mounts its own
 * back control into it and a collapsed rail has no room for one.
 */
const HostedSidebarHeader = ({
    expanded,
    onToggle,
}: {
    expanded: boolean;
    onToggle: () => void;
}) => (
    <>
        <div
            className={cn(
                "relative z-20 flex h-titlebar shrink-0 items-center",
                expanded ? "justify-between pl-3 pr-2" : "justify-center px-1.5",
            )}
        >
            <SidebarToggleBtn open={expanded} collapsed={!expanded} onToggle={onToggle} />
            {expanded ? (
                <div id={AGENT_SIDEBAR_BACK_SLOT} className="flex items-center" />
            ) : null}
        </div>
        <div
            id={AGENT_SIDEBAR_NAV_SLOT}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
            data-collapsed={expanded ? "false" : "true"}
        />
    </>
);

/**
 * The header of the standalone app: the account menu on the left, the toggle on the right.
 *
 * The account row is a menu trigger rather than a link, so it carries the button ladder
 * instead of a row fill, and the avatar always shows something to identify the account.
 */
const SidebarHeader = ({
    expanded,
    onToggle,
    avatarUrl,
    name,
}: {
    expanded: boolean;
    onToggle: () => void;
    avatarUrl: string | null;
    name: string;
}) => (
    <div
        className={cn(
            "relative z-20 flex h-titlebar shrink-0 items-center gap-1",
            expanded ? "justify-between pl-3 pr-2" : "justify-center px-1.5",
        )}
    >
        {expanded ? (
            <AccountMenu>
                <button
                    type="button"
                    aria-label="Account"
                    className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)]"
                >
                    <ProfileAvatar gitAvatarUrl={avatarUrl} name={name} size={20} />
                    <Icon
                        icon={ChevronDown20Regular}
                        className="shrink-0 text-text-muted!"
                        style={{ ["--icon-size" as string]: "14px" }}
                    />
                </button>
            </AccountMenu>
        ) : null}
        <SidebarToggleBtn open={expanded} collapsed={!expanded} onToggle={onToggle} />
    </div>
);

/**
 * The New Chat row in the expanded column.
 *
 * Row ladder, stated here as `NavItem` states it. This row used to inherit whatever hover
 * `variant="ghost"` happened to carry, which meant it silently followed the button rung the
 * moment the two were separated.
 */
const NewChatRow = ({ onClick }: { onClick: () => void }) => (
    <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClick}
        className="flex h-9 w-full items-center justify-start gap-2 px-1.5! text-left transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--row-hover)]"
    >
        <Icon icon={Compose20Regular} className="shrink-0 text-text-muted" />
        <span className="min-w-0 flex-1 truncate">New Chat</span>
    </Button>
);

/**
 * The two icons a collapsed rail keeps: composing, and the palette.
 *
 * Without them the rail would hold only Settings, and the two things a sidebar is for would
 * need the sidebar to be open before they could be reached.
 */
const CollapsedNavRows = ({
    onNewChat,
    onSearch,
}: {
    onNewChat: () => void;
    onSearch: () => void;
}) => (
    <>
        <NavItem label="New Chat" icon={Compose20Regular} onClick={onNewChat} collapsed />
        <NavItem label="Command Palette" icon={Search20Regular} onClick={onSearch} collapsed />
    </>
);

/**
 * The app's own column: the account header, the nav rows and the chat shelves.
 *
 * It exists as one component because the hosted shape replaces exactly this much of the
 * sidebar and nothing else: the aside, the column and the footer are shared.
 */
const StandaloneSidebar = ({
    expanded,
    onToggle,
    avatarUrl,
    name,
    onSearch,
}: {
    expanded: boolean;
    onToggle: () => void;
    avatarUrl: string | null;
    name: string;
    onSearch: () => void;
}) => (
    <>
        <SidebarHeader
            expanded={expanded}
            onToggle={onToggle}
            avatarUrl={avatarUrl}
            name={name}
        />
        <SidebarNav
            expanded={expanded}
            onNewChat={startNewChat}
            onSearch={onSearch}
            onOpenSettings={openSettings}
        />
        {/* The shelves, or the empty room they would take: collapsed, a list of avatars
            with no titles is not a list. */}
        {expanded ? <ChatList onNewChat={startNewChat} /> : <div className="min-h-0 flex-1" />}
    </>
);

/**
 * The nav column: the compose row, then the Settings row.
 *
 * The column's padding is part of the row ladder: a row that reaches the sidebar's edge has
 * no gutter to show its fill against, so the padding moves with the rows and not with the
 * section.
 */
const SidebarNav = ({
    expanded,
    onNewChat,
    onSearch,
    onOpenSettings,
}: {
    expanded: boolean;
    onNewChat: () => void;
    onSearch: () => void;
    onOpenSettings: () => void;
}) => (
    <nav
        className={cn(
            "flex shrink-0 gap-0.5",
            expanded ? "flex-col px-2" : "flex-col items-center px-1.5",
        )}
    >
        {expanded ? (
            <NewChatRow onClick={onNewChat} />
        ) : (
            <CollapsedNavRows onNewChat={onNewChat} onSearch={onSearch} />
        )}
        <NavItem
            label="Settings"
            icon={Settings20Regular}
            onClick={onOpenSettings}
            collapsed={!expanded}
        />
    </nav>
);

/** The rail's footer: the usage chip keeps its own row, so the settings icon stays reachable. */
const CollapsedSidebarFooter = () => (
    <div className="flex flex-col items-center gap-1">
        <ChatUsageButton compact />
        <Tooltip content="Settings" side="right" delayDuration={80}>
            <button
                type="button"
                onClick={openSettings}
                className="flex size-9 items-center justify-center rounded-md text-text-muted transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary"
                aria-label="Settings"
            >
                <Icon icon={Settings20Regular} />
            </button>
        </Tooltip>
    </div>
);

/**
 * The expanded footer: the connect prompt while signed out, and the usage chip always.
 *
 * `showConnect` is decided by the caller because a hosted app signs in through its own shell
 * and must not be offered a second, competing path here.
 */
const ExpandedSidebarFooter = ({ showConnect }: { showConnect: boolean }) => (
    <>
        {showConnect ? (
            <Button
                type="button"
                onClick={connectGitHub}
                className="mb-1 w-full justify-start rounded-md px-3"
                variant="ghost"
                size="md"
            >
                <Icon icon={GithubMark} />
                Connect GitHub
            </Button>
        ) : null}
        <div className="flex items-center gap-0.5 px-1 pb-0.5">
            <ChatUsageButton />
        </div>
    </>
);

/** The footer that holds the usage chip, in whichever of its two shapes the width allows. */
const SidebarFooter = ({
    expanded,
    showConnect,
}: {
    expanded: boolean;
    showConnect: boolean;
}) => (
    <div className={sidebarFooterClass(expanded)}>
        {expanded ? <ExpandedSidebarFooter showConnect={showConnect} /> : <CollapsedSidebarFooter />}
    </div>
);

/**
 * One nav row, in the two shapes the sidebar has.
 *
 * Collapsed it is a 36px icon button under a tooltip; expanded it is a full-width row. Both
 * carry the same ladder (`--btn-hover` for the icon, `--row-hover` for the row), the
 * committed fill marks the current page, and a committed row still steps up on hover so a
 * current page never reads as disabled.
 */
const NavItem = ({
    label,
    icon,
    onClick,
    collapsed,
    active,
}: {
    label: string;
    icon: IconGlyph;
    onClick: () => void;
    collapsed?: boolean;
    active?: boolean;
}) => {
    const current = active ? ("page" as const) : undefined;

    if (collapsed) {
        return (
            <Tooltip content={label} side="right" delayDuration={80}>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={onClick}
                    aria-label={label}
                    aria-current={current}
                    className={cn(
                        "size-9 shrink-0 text-text-secondary transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary",
                        active &&
                            "bg-[var(--btn-open)] text-text-primary hover:bg-[var(--btn-open-hover)]",
                    )}
                >
                    <Icon icon={icon} />
                </Button>
            </Tooltip>
        );
    }

    return (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClick}
            aria-current={current}
            className={cn(
                "flex h-9 w-full items-center justify-start gap-2 px-1.5! text-left transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]",
                navRowFill(active),
            )}
        >
            <Icon icon={icon} className="shrink-0 text-text-muted" />
            <span className="min-w-0 flex-1 truncate">{label}</span>
        </Button>
    );
};

/**
 * The primary sidebar: header, nav column and footer, in the app's own shape or the hosted
 * one.
 *
 * The component reads the account store directly because the header, the connect prompt and
 * the chat shelves all answer to the same signed-in state, and threading it through three
 * components would only move the read.
 */
export const AgentSidebar = ({
    onSearch,
    expanded,
    open = true,
    overlay,
    onToggleSidebar,
}: {
    onSearch: () => void;
    expanded: boolean;
    open?: boolean;
    overlay: AgentOverlay;
    onBrowser?: () => void;
    showBrowser?: boolean;
    onToggleSidebar?: () => void;
}) => {
    const github = useGitHubAuth();
    const showHostedNav = Boolean(overlay);
    /** One toggle for both headers, so a hosted and a standalone shell behave the same. */
    const toggle = () => toggleSidebar(onToggleSidebar);
    const showConnect = !showHostedNav && !github.loggedIn;

    return (
        <aside aria-hidden={!open} className={sidebarShellClass(open, expanded)}>
            <div className={sidebarColumnClass(open, expanded)}>
                {showHostedNav ? (
                    <HostedSidebarHeader expanded={expanded} onToggle={toggle} />
                ) : (
                    <StandaloneSidebar
                        expanded={expanded}
                        onToggle={toggle}
                        avatarUrl={accountAvatar(github)}
                        name={accountName(github)}
                        onSearch={onSearch}
                    />
                )}

                <SidebarFooter expanded={expanded} showConnect={showConnect} />
            </div>
        </aside>
    );
};
