"use client";

import { ArrowLeft20Regular } from "@fluentui/react-icons/headless/svg/arrow-left";
import { ArrowRight20Regular } from "@fluentui/react-icons/headless/svg/arrow-right";
import { ArrowSync20Regular } from "@fluentui/react-icons/headless/svg/arrow-sync";
import { Camera20Filled } from "@fluentui/react-icons/headless/svg/camera";
import { Code20Regular } from "@fluentui/react-icons/headless/svg/code";
import { Database20Regular } from "@fluentui/react-icons/headless/svg/database";
import { History20Regular } from "@fluentui/react-icons/headless/svg/history";
import { Link20Regular } from "@fluentui/react-icons/headless/svg/link";
import { Open20Regular } from "@fluentui/react-icons/headless/svg/open";
import { Shield20Regular } from "@fluentui/react-icons/headless/svg/shield";
import { Star20Regular } from "@fluentui/react-icons/headless/svg/star";
import { Target20Regular } from "@fluentui/react-icons/headless/svg/target";
import { WeatherMoon20Regular } from "@fluentui/react-icons/headless/svg/weather-moon";
import { WeatherSunny20Regular } from "@fluentui/react-icons/headless/svg/weather-sunny";

import { Favicon } from "@/components/ui/favicon";
import { Icon } from "@/components/ui/icon";
import { Tooltip } from "@/components/ui/tooltip";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { hostnameOf } from "@/lib/ui/favicon";
import { cn } from "@/lib/utils";
import type { Bookmark, ColorScheme } from "./browser-storage";
import { UrlBar } from "./browser-url-bar";
import { ToolBtn } from "./tool";

/** Everything the toolbar's controls can be asked to do. */
export type BrowserActions = {
    back: () => void;
    forward: () => void;
    reload: () => void;
    toggleBookmark: () => void;
    submitUrl: (raw: string) => void;
    togglePicking: () => void;
    openTools: () => void;
    closeTools: () => void;
    chooseScheme: (scheme: ColorScheme) => void;
    showBookmarkBar: (show: boolean) => void;
    openExternally: () => void;
    copyUrl: () => void;
    clear: (what: "history" | "cookies" | "cache") => void;
};

/** What the toolbar's controls need to know about the page to render their own state. */
export type BrowserState = {
    url: string;
    canBack: boolean;
    canForward: boolean;
    reloadable: boolean;
    bookmarkable: boolean;
    bookmarked: boolean;
    picking: boolean;
    agentDriving: boolean;
    toolsOpen: boolean;
    toolsError: boolean;
    scheme: ColorScheme;
    bookmarkBar: boolean;
};

/** The star, which is the one control whose own state is visible in its glyph. */
const BookmarkButton = ({ state, actions }: { state: BrowserState; actions: BrowserActions }) => (
    <ToolBtn
        label={state.bookmarked ? "Remove bookmark" : "Bookmark"}
        disabled={!state.bookmarkable}
        onClick={actions.toggleBookmark}
        active={state.bookmarked}
    >
        <Icon icon={Star20Regular} className={state.bookmarked ? "text-accent" : undefined} />
    </ToolBtn>
);

/** The element picker, which stays pressed while it is on and says so on hover. */
const PickerButton = ({ state, actions }: { state: BrowserState; actions: BrowserActions }) => (
    <Tooltip
        content={state.picking ? "Stop selecting" : "Select an element to mention it in chat"}
        side="bottom"
        delayDuration={80}
    >
        <button
            type="button"
            aria-label="Select element"
            aria-pressed={state.picking}
            disabled={state.agentDriving || !state.reloadable}
            onClick={actions.togglePicking}
            className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded text-text-muted",
                "hover:bg-[var(--btn-hover)] hover:text-text-primary disabled:pointer-events-none disabled:opacity-30",
                state.picking && "bg-[var(--btn-open)] hover:bg-[var(--btn-open-hover)] text-accent",
            )}
        >
            <Icon icon={Target20Regular} />
        </button>
    </Tooltip>
);

/** The scheme rows, which are three mutually exclusive choices in one menu. */
const SchemeItems = ({ state, actions }: { state: BrowserState; actions: BrowserActions }) => (
    <>
        <DropdownMenuCheckboxItem
            checked={state.scheme === "system"}
            onCheckedChange={() => actions.chooseScheme("system")}
        >
            System theme
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
            checked={state.scheme === "light"}
            onCheckedChange={() => actions.chooseScheme("light")}
        >
            <Icon icon={WeatherSunny20Regular} />
            Light
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
            checked={state.scheme === "dark"}
            onCheckedChange={() => actions.chooseScheme("dark")}
        >
            <Icon icon={WeatherMoon20Regular} />
            Dark
        </DropdownMenuCheckboxItem>
    </>
);

/** The three clears, which are the only items here that destroy something. */
const ClearItems = ({ actions }: { actions: BrowserActions }) => (
    <>
        <DropdownMenuItem onClick={() => actions.clear("history")}>
            <Icon icon={History20Regular} />
            Clear Browsing History
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => actions.clear("cookies")}>
            <Icon icon={Shield20Regular} />
            Clear Cookies
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => actions.clear("cache")}>
            <Icon icon={Database20Regular} />
            Clear Cache
        </DropdownMenuItem>
    </>
);

/** The overflow menu: the page's own actions, the theme, the bar, and the clears. */
const BrowserMenuContent = ({ state, actions }: { state: BrowserState; actions: BrowserActions }) => (
    <DropdownMenuContent align="end" side="bottom" className="w-56">
        <DropdownMenuCheckboxItem
            checked={state.toolsOpen || state.toolsError}
            disabled={!state.reloadable || state.agentDriving}
            onCheckedChange={(checked) => {
                if (!checked) actions.closeTools();
                else if (!state.toolsOpen) actions.openTools();
            }}
        >
            <Icon icon={Code20Regular} />
            Developer tools
        </DropdownMenuCheckboxItem>
        <DropdownMenuItem disabled>
            <Icon icon={Camera20Filled} />
            Take Screenshot
        </DropdownMenuItem>
        <DropdownMenuItem disabled={state.agentDriving || !state.url} onClick={actions.reload}>
            <Icon icon={ArrowSync20Regular} />
            Hard Reload
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!state.url} onClick={actions.copyUrl}>
            <Icon icon={Link20Regular} />
            Copy Current URL
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!state.url} onClick={actions.openExternally}>
            <Icon icon={Open20Regular} />
            Open Externally
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <SchemeItems state={state} actions={actions} />
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
            checked={state.bookmarkBar}
            onCheckedChange={(checked) => actions.showBookmarkBar(checked)}
        >
            Show Bookmark Bar
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <ClearItems actions={actions} />
    </DropdownMenuContent>
);

/** The overflow menu's own button, which stays lit while the menu is open. */
const MenuButton = () => (
    <DropdownMenuTrigger asChild>
        <button
            type="button"
            className="flex size-7 shrink-0 items-center justify-center rounded text-text-muted hover:bg-[var(--btn-hover)] hover:text-text-primary data-[state=open]:bg-[var(--btn-open)] data-[state=open]:focus:bg-[var(--btn-open-hover)] data-[state=open]:hover:bg-[var(--btn-open-hover)] data-[state=open]:text-text-primary"
            aria-label="Developer tools"
        >
            <Icon icon={Code20Regular} />
        </button>
    </DropdownMenuTrigger>
);

/** The browser's control row: history, reload, the address field, the picker and the menu. */
export const BrowserToolbar = ({
    state,
    actions,
    onUrlDraft,
}: {
    state: BrowserState;
    actions: BrowserActions;
    onUrlDraft: (next: string) => void;
}) => (
    <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-border-subtle px-1">
        <ToolBtn label="Back" disabled={!state.canBack} onClick={actions.back}>
            <Icon icon={ArrowLeft20Regular} />
        </ToolBtn>
        <ToolBtn label="Forward" disabled={!state.canForward} onClick={actions.forward}>
            <Icon icon={ArrowRight20Regular} />
        </ToolBtn>
        <ToolBtn label="Reload" disabled={!state.reloadable} onClick={actions.reload}>
            <Icon icon={ArrowSync20Regular} />
        </ToolBtn>
        <BookmarkButton state={state} actions={actions} />
        <UrlBar value={state.url} onChange={onUrlDraft} onSubmit={actions.submitUrl} />
        <PickerButton state={state} actions={actions} />
        <DropdownMenu>
            <MenuButton />
            <BrowserMenuContent state={state} actions={actions} />
        </DropdownMenu>
    </div>
);

/** The starred pages, one press each, in the order they were starred. */
export const BookmarkBar = ({
    show,
    bookmarks,
    onOpen,
}: {
    show: boolean;
    bookmarks: readonly Bookmark[];
    onOpen: (url: string) => void;
}) => {
    if (!show) return null;
    return (
    <div className="flex h-7 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border-subtle px-1">
        {bookmarks.length === 0 ? (
            <span className="px-2 text-xs text-text-muted">Star a page to keep it here.</span>
        ) : (
            bookmarks.map((bookmark) => (
                <button
                    key={bookmark.url}
                    type="button"
                    onClick={() => onOpen(bookmark.url)}
                    className="flex h-6 max-w-40 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-text-secondary hover:bg-[var(--btn-hover)] hover:text-text-primary"
                >
                    <Favicon url={bookmark.url} size={12} />
                    <span className="truncate">{bookmark.title || hostnameOf(bookmark.url)}</span>
                </button>
            ))
        )}
    </div>
    );
};

/**
 * The menu the framed page asked for, anchored where the page said the pointer was.
 *
 * The trigger is a single invisible pixel at that point rather than the frame itself: the
 * page is cross-origin, so its own context menu event cannot be taken over, and the host
 * script reports the position instead.
 */
export const PageContextMenu = ({
    point,
    state,
    actions,
    onClose,
}: {
    point: { x: number; y: number } | null;
    state: BrowserState;
    actions: BrowserActions;
    onClose: () => void;
}) => {
    if (!point) return null;
    return (
    <DropdownMenu open onOpenChange={(open) => { if (!open) onClose(); }}>
        <DropdownMenuTrigger asChild>
            <span className="fixed z-20 size-px" style={{ left: point.x, top: point.y }} />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
            <DropdownMenuItem disabled={!state.canBack} onClick={actions.back}>
                <Icon icon={ArrowLeft20Regular} />
                Back
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!state.canForward} onClick={actions.forward}>
                <Icon icon={ArrowRight20Regular} />
                Forward
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!state.url} onClick={actions.reload}>
                <Icon icon={ArrowSync20Regular} />
                Reload
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!state.url} onClick={actions.togglePicking}>
                <Icon icon={Target20Regular} />
                Select Element
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!state.url} onClick={actions.copyUrl}>
                <Icon icon={Link20Regular} />
                Copy Current URL
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!state.url} onClick={actions.openExternally}>
                <Icon icon={Open20Regular} />
                Open Externally
            </DropdownMenuItem>
        </DropdownMenuContent>
    </DropdownMenu>
    );
};
