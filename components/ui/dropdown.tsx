"use client";

import { Checkmark20Regular } from "@fluentui/react-icons/headless/svg/checkmark";
import { ChevronRight20Regular } from "@fluentui/react-icons/headless/svg/chevron-right";
import { Circle20Regular } from "@fluentui/react-icons/headless/svg/circle";


import * as React from "react";
import { Icon } from "./icon";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import * as MenubarPrimitive from "@radix-ui/react-menubar";


import { cn } from "@/lib/utils";
import { useOverlayRoot } from "@/lib/ui/overlay-root";

/**
 * Shared Styles & Helpers
 */

const itemClasses =
    "group relative flex cursor-default select-none items-center gap-2 squircle-2xl px-4! py-1.5 text-sm outline-none transition-[background-color,color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] focus:bg-[var(--row-hover)] focus:text-text-primary data-disabled:pointer-events-none data-disabled:opacity-50";
const containerClasses =
    "bettershape-popover-content bettershape-menu-content z-dropdown overflow-hidden squircle-2xl border border-border-secondary bg-sidebar text-text-primary shadow-md";
const shortcutClasses =
    "ml-auto shrink-0 pr-1 text-sm text-text-muted group-focus:text-text-primary";
/** Inset so rows and the panel sit off the edges. */
const menuInsetClasses = "p-1.5";
const menuCollisionPadding = 8;

/** Overflow scrim, GitLab-style fade when the panel can scroll. */
const DropdownScrollScrim = ({ side, visible }: { side: "up" | "down"; visible: boolean }) => {
    return (
        <div
            className={cn(
                "pointer-events-none absolute inset-x-0 z-20 h-6 transition-opacity duration-[var(--transition-fast)] ease-[var(--ease-out)]",
                side === "up" ? "top-0 bg-linear-to-b from-sidebar to-transparent" : "bottom-0 bg-linear-to-t from-sidebar to-transparent",
                visible ? "opacity-100" : "opacity-0",
            )}
            aria-hidden
        />
    );
};

/**
 * The scrolling list inside a menu.
 *
 * The max height is on this element and not on the content, so the sticky group headings
 * have a scroll container to stick to and the menu's own shadow is not clipped by it.
 */
function DropdownScrollArea({
    className,
    children,
}: {
    className?: string;
    children: React.ReactNode;
}) {
    const ref = React.useRef<HTMLDivElement>(null);
    const [canUp, setCanUp] = React.useState(false);
    const [canDown, setCanDown] = React.useState(false);

    const [hasStickySearch, setHasStickySearch] = React.useState(false);

    const update = React.useCallback(() => {
        const el = ref.current;
        if (!el) return;
        const { scrollTop, scrollHeight, clientHeight } = el;
        const overflow = scrollHeight > clientHeight + 1;
        setCanUp(overflow && scrollTop > 2);
        setCanDown(overflow && scrollTop + clientHeight < scrollHeight - 2);
        setHasStickySearch(!!el.querySelector("[data-dropdown-search]"));
    }, []);

    React.useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        update();
        const ro = new ResizeObserver(() => update());
        ro.observe(el);
        const mo = new MutationObserver(() => update());
        mo.observe(el, { childList: true, subtree: true });
        return () => {
            ro.disconnect();
            mo.disconnect();
        };
    }, [update, children]);

    return (
        <div className="relative min-h-0">
            <DropdownScrollScrim side="up" visible={canUp && !hasStickySearch} />
            <div
                ref={ref}
                onScroll={update}
                className={cn(
                    "overflow-y-auto no-scrollbar",
                    className,
                    menuInsetClasses,
                )}
            >
                {children}
            </div>
            <DropdownScrollScrim side="down" visible={canDown} />
        </div>
    );
}

/**
 * Dropdown Menu Components
 */

const DropdownMenu = DropdownMenuPrimitive.Root;

const DropdownMenuTrigger = React.forwardRef<
    React.ElementRef<typeof DropdownMenuPrimitive.Trigger>,
    React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger>
>(({ onPointerDown, ...props }, ref) => (
    <DropdownMenuPrimitive.Trigger
        ref={ref}
        onPointerDown={(e) => {
            e.stopPropagation();
            if (onPointerDown) onPointerDown(e);
        }}
        {...props}
    />
));
DropdownMenuTrigger.displayName = DropdownMenuPrimitive.Trigger.displayName;
const DropdownMenuGroup = DropdownMenuPrimitive.Group;
const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
const DropdownMenuSub = DropdownMenuPrimitive.Sub;
const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

const DropdownMenuSubTrigger = React.forwardRef<
    React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
    React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
        inset?: boolean;
    }
>(({ className, inset, children, ...props }, ref) => (
    <DropdownMenuPrimitive.SubTrigger
        ref={ref}
        className={cn(
            itemClasses,
            "data-[state=open]:bg-[var(--row-selected)] data-[state=open]:hover:bg-[var(--row-selected-hover)] data-[state=open]:focus:bg-[var(--row-selected-hover)]",
            inset && "pl-7",
            className
        )}
        {...props}
    >
        {children}
        <Icon icon={ChevronRight20Regular} className="ml-auto"  />
    </DropdownMenuPrimitive.SubTrigger>
));
DropdownMenuSubTrigger.displayName = DropdownMenuPrimitive.SubTrigger.displayName;

const DropdownMenuSubContent = React.forwardRef<
    React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
    React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, sideOffset = 4, collisionPadding = menuCollisionPadding, children, ...props }, ref) => {
    const overlayRoot = useOverlayRoot();
    return (
    <DropdownMenuPrimitive.Portal container={overlayRoot}>
        <DropdownMenuPrimitive.SubContent
            ref={ref}
            sideOffset={sideOffset}
            collisionPadding={collisionPadding}
            className={cn(
                containerClasses,
                "min-w-32 max-h-[var(--radix-dropdown-menu-sub-content-available-height,_80vh)] p-0",
            )}
            {...props}
        >
            <DropdownScrollArea
                className={cn(
                    "max-h-[var(--radix-dropdown-menu-sub-content-available-height,_80vh)]",
                    className,
                )}
            >
                {children}
            </DropdownScrollArea>
        </DropdownMenuPrimitive.SubContent>
    </DropdownMenuPrimitive.Portal>
    );
});
DropdownMenuSubContent.displayName = DropdownMenuPrimitive.SubContent.displayName;

const DropdownMenuContent = React.forwardRef<
    React.ElementRef<typeof DropdownMenuPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content> & {
        portalled?: boolean;
    }
>(({ className, sideOffset = 4, align = "start", collisionPadding = menuCollisionPadding, children, portalled = true, ...props }, ref) => {
    const overlayRoot = useOverlayRoot();
    const content = (
        <DropdownMenuPrimitive.Content
            ref={ref}
            sideOffset={sideOffset}
            align={align}
            collisionPadding={collisionPadding}
            className={cn(
                containerClasses,
                "min-w-32 max-h-[var(--radix-dropdown-menu-content-available-height,_80vh)] p-0",
            )}
            {...props}
        >
            <DropdownScrollArea
                className={cn(
                    "max-h-[var(--radix-dropdown-menu-content-available-height,_80vh)]",
                    className,
                )}
            >
                {children}
            </DropdownScrollArea>
        </DropdownMenuPrimitive.Content>
    );
    if (!portalled) return content;
    return (
        <DropdownMenuPrimitive.Portal container={overlayRoot}>
            {content}
        </DropdownMenuPrimitive.Portal>
    );
});
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

const DropdownMenuItem = React.forwardRef<
    React.ElementRef<typeof DropdownMenuPrimitive.Item>,
    React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
        inset?: boolean;
        variant?: "destructive";
    }
>(({ className, inset, variant, ...props }, ref) => (
    <DropdownMenuPrimitive.Item
        ref={ref}
        className={cn(
            "group",
            itemClasses,
            inset && "pl-7",
            variant === "destructive" && "text-error focus:text-error",
            className,
        )}
        {...props}
    />
));
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

const DropdownMenuCheckboxItem = React.forwardRef<
    React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
    React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked, onSelect, ...props }, ref) => (
    <DropdownMenuPrimitive.CheckboxItem
        ref={ref}
        className={cn(itemClasses, "pr-1", className)}
        checked={checked}
        onSelect={(e) => {
            onSelect?.(e);
            e.preventDefault();
        }}
        {...props}
    >
        <span className="flex w-4 shrink-0 items-center justify-center">
            <DropdownMenuPrimitive.ItemIndicator>
                <Icon icon={Checkmark20Regular}   />
            </DropdownMenuPrimitive.ItemIndicator>
        </span>
        {children}
    </DropdownMenuPrimitive.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = DropdownMenuPrimitive.CheckboxItem.displayName;

const DropdownMenuRadioItem = React.forwardRef<
    React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
    React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, onSelect, ...props }, ref) => (
    <DropdownMenuPrimitive.RadioItem
        ref={ref}
        className={cn(itemClasses, "pr-1", className)}
        onSelect={(e) => {
            onSelect?.(e);
            e.preventDefault();
        }}
        {...props}
    >
        <span className="flex w-4 shrink-0 items-center justify-center">
            <DropdownMenuPrimitive.ItemIndicator>
                <Icon icon={Circle20Regular}  className="size-[8px]"  />
            </DropdownMenuPrimitive.ItemIndicator>
        </span>
        {children}
    </DropdownMenuPrimitive.RadioItem>
));
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName;

const DropdownMenuLabel = React.forwardRef<
    React.ElementRef<typeof DropdownMenuPrimitive.Label>,
    React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
        inset?: boolean;
    }
>(({ className, inset, ...props }, ref) => (
    <DropdownMenuPrimitive.Label
        ref={ref}
        className={cn(
            "mx-0.5 px-2 py-1.5 text-xs font-medium text-text-muted",
            inset && "pl-7",
            className,
        )}
        {...props}
    />
));
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName;

const DropdownMenuSeparator = React.forwardRef<
    React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
    React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
    <DropdownMenuPrimitive.Separator
        ref={ref}
        className={cn("my-1 h-px bg-border-subtle", className)}
        {...props}
    />
));
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

/**
 * The keystroke hint at the end of a menu item, in the app's one hint style.
 *
 * Both menus read `shortcutClasses`, so a hint lands in the same place at the same size
 * whether the row belongs to a dropdown or a menubar.
 */
const DropdownMenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
    <span className={cn(shortcutClasses, className)} {...props} />
);
DropdownMenuShortcut.displayName = "DropdownMenuShortcut";

/**
 * A nested row that holds its own open state, so it works with no props at all.
 *
 * Passing `open` hands the state to the caller; either way the children receive it, which
 * is what keeps the trigger and the panel from disagreeing about whether it is open.
 */
const DropdownMenuNested = ({ children, open, onOpenChange }: { children: React.ReactNode, open?: boolean, onOpenChange?: (open: boolean) => void }) => {
    const [internalOpen, setInternalOpen] = React.useState(false);
    const isOpened = open !== undefined ? open : internalOpen;
    const setIsOpened = onOpenChange !== undefined ? onOpenChange : setInternalOpen;

    return (
        <div className="flex flex-col">
            {React.Children.map(children, (child) => {
                if (React.isValidElement(child)) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return React.cloneElement(child as any, { isOpened, setIsOpened });
                }
                return child;
            })}
        </div>
    );
};

type NestedMenuTriggerState = {
    isOpened?: boolean;
    setIsOpened?: (open: boolean) => void;
};

/**
 * The panel a nested row reveals.
 *
 * The collapse animates the grid template row rather than a height, so the panel's own
 * content keeps its layout while the row goes to zero.
 */
type NestedMenuContentProps = {
    children: React.ReactNode;
    isOpened?: boolean;
};

function renderNestedMenuTrigger<
    TElement extends HTMLElement,
    TProps extends NestedMenuTriggerState & { className?: string; children?: React.ReactNode },
>(
    Item: React.ElementType,
    props: TProps,
    ref: React.ForwardedRef<TElement>,
): React.ReactElement {
    const { className, children, isOpened, setIsOpened, ...itemProps } = props;
    return (
        <Item
            ref={ref}
            className={cn(className)}
            onClick={(event: React.MouseEvent) => {
                event.preventDefault();
                event.stopPropagation();
                setIsOpened?.(!isOpened);
            }}
            {...itemProps}
            aria-expanded={isOpened ?? false}
        >
            {children}
            <Icon
                icon={ChevronRight20Regular}
                className={cn(
                    "ml-auto transition-transform duration-[var(--transition-fast)] ease-[var(--ease-out)]",
                    isOpened && "rotate-90",
                )}
            />
        </Item>
    );
}

function NestedMenuContent({ children, isOpened }: NestedMenuContentProps) {
    return (
        <div
            aria-hidden={!isOpened}
            inert={!isOpened}
            className={cn(
                "grid transition-[grid-template-rows,opacity] duration-[var(--transition-base)] ease-[var(--ease-out)]",
                isOpened ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
            )}
        >
            <div className="overflow-hidden flex flex-col pl-1">{children}</div>
        </div>
    );
}

const DropdownMenuNestedTrigger = React.forwardRef<
    React.ElementRef<typeof DropdownMenuItem>,
    React.ComponentPropsWithoutRef<typeof DropdownMenuItem> & NestedMenuTriggerState
>((props, ref) => renderNestedMenuTrigger(DropdownMenuItem, props, ref));
DropdownMenuNestedTrigger.displayName = "DropdownMenuNestedTrigger";

/** Keeps the controlled submenu branch mounted while making its closed content inert. */
const DropdownMenuNestedContent = NestedMenuContent;

/**
 * Menubar Components (for Navigation/Titlebar)
 */

const MenubarTrigger = React.forwardRef<
    React.ElementRef<typeof MenubarPrimitive.Trigger>,
    React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Trigger>
>(({ className, onPointerDown, ...props }, ref) => (
    <MenubarPrimitive.Trigger
        ref={ref}
        onPointerDown={(e) => {
            e.stopPropagation();
            if (onPointerDown) onPointerDown(e);
        }}
        className={cn(
            "flex cursor-default select-none items-center rounded-md px-sm py-xs text-sm font-normal leading-none outline-none focus:bg-[var(--btn-hover)] focus:text-text-primary data-[state=open]:bg-[var(--btn-open)] data-[state=open]:hover:bg-[var(--btn-open-hover)] data-[state=open]:focus:bg-[var(--btn-open-hover)] data-[state=open]:text-text-primary transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]",
            className
        )}
        {...props}
    />
));
MenubarTrigger.displayName = MenubarPrimitive.Trigger.displayName;

/**
 * The display name a wrapper component re-exports the menubar trigger under.
 *
 * `ForwardRef` and friends hand back a component whose identity differs from ours, so the
 * name is the only thing left to match on when the trigger arrives wrapped.
 */
const triggerDisplayName = (child: React.ReactElement): string | undefined => {
    const type = child.type as { displayName?: string };
    return typeof type === "object" && type !== null ? type.displayName : undefined;
};

/** Whether a menu child is the menubar trigger, or a wrapper that re-exports it. */
const isMenubarTrigger = (child: React.ReactElement): boolean =>
    child.type === MenubarTrigger || triggerDisplayName(child) === MenubarTrigger.displayName;

/**
 * Our ref composed with whatever ref the caller already put on the child.
 *
 * React 19 passes `ref` as a prop, so the child's own ref has to be kept rather than
 * overwritten: a consumer that reads the trigger element still receives it.
 */
const composeTriggerRef =
    (callerRef: React.Ref<HTMLElement> | undefined, setTriggerEl: (el: HTMLElement | null) => void) =>
    (el: HTMLElement | null) => {
        setTriggerEl(el);
        if (typeof callerRef === "function") callerRef(el);
        else if (callerRef) (callerRef as React.MutableRefObject<HTMLElement | null>).current = el;
    };

/**
 * Gives the trigger child the ref the open-state observer watches.
 *
 * Every other child is returned untouched, so a menu can hold items, separators and nested
 * rows beside its trigger.
 */
const withTriggerRef = (child: React.ReactNode, setTriggerEl: (el: HTMLElement | null) => void): React.ReactNode => {
    if (!React.isValidElement(child) || !isMenubarTrigger(child as React.ReactElement)) return child;
    const callerRef = (child.props as { ref?: React.Ref<HTMLElement> }).ref;
    return React.cloneElement(child as React.ReactElement<{ ref?: React.Ref<HTMLElement> }>, {
        ref: composeTriggerRef(callerRef, setTriggerEl),
    });
};

const MenubarMenu = ({
    onOpenChange,
    children,
    value,
}: {
    value?: string;
    children?: React.ReactNode;
    onOpenChange?: (open: boolean) => void;
}) => {
    // Radix Menubar.Menu does not type or safely accept onOpenChange (spreading it
    // onto Menu.Root would overwrite the internal close handler). We accept the
    // prop for API compatibility and notify via a trigger data-state observer.
    // The trigger node is kept in state (set from the trigger's ref callback), so the observer
    // effect re-runs when the trigger mounts or is replaced.
    const [triggerEl, setTriggerEl] = React.useState<HTMLElement | null>(null);
    const onOpenChangeRef = React.useRef(onOpenChange);
    React.useLayoutEffect(() => {
        onOpenChangeRef.current = onOpenChange;
    });
    const prevOpenRef = React.useRef(false);

    React.useEffect(() => {
        if (!onOpenChange) return undefined;
        const el = triggerEl;
        if (!el) return undefined;

        /**
         * Reads the open state, which only ever exists on the primitive's element.
         *
         * The observer reports changes rather than current state, so the same read runs
         * once before it starts: a menu that is already open would report closed.
         */
        const sync = () => {
            const open = el.getAttribute("data-state") === "open";
            if (open !== prevOpenRef.current) {
                prevOpenRef.current = open;
                onOpenChangeRef.current?.(open);
            }
        };

        sync();
        const observer = new MutationObserver(sync);
        observer.observe(el, { attributes: true, attributeFilter: ["data-state"] });
        return () => {
            observer.disconnect();
        };
    }, [onOpenChange, triggerEl]);

    return (
        <MenubarPrimitive.Menu value={value}>
            {React.Children.map(children, (child) => withTriggerRef(child, setTriggerEl))}
        </MenubarPrimitive.Menu>
    );
};
const MenubarGroup = MenubarPrimitive.Group;
const MenubarPortal = MenubarPrimitive.Portal;
const MenubarSub = MenubarPrimitive.Sub;
const MenubarRadioGroup = MenubarPrimitive.RadioGroup;

const Menubar = React.forwardRef<
    React.ElementRef<typeof MenubarPrimitive.Root>,
    React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Root>
>(({ className, ...props }, ref) => (
    <MenubarPrimitive.Root
        ref={ref}
        className={cn("flex h-[28px] items-center space-x-0.5 rounded-md bg-transparent p-xs", className)}
        {...props}
    />
));
Menubar.displayName = MenubarPrimitive.Root.displayName;

const MenubarSubTrigger = React.forwardRef<
    React.ElementRef<typeof MenubarPrimitive.SubTrigger>,
    React.ComponentPropsWithoutRef<typeof MenubarPrimitive.SubTrigger> & {
        inset?: boolean;
    }
>(({ className, inset, children, ...props }, ref) => (
    <MenubarPrimitive.SubTrigger
        ref={ref}
        className={cn(
            itemClasses,
            "focus:bg-[var(--row-hover)] focus:text-text-primary data-[state=open]:bg-[var(--row-selected)] data-[state=open]:hover:bg-[var(--row-selected-hover)] data-[state=open]:focus:bg-[var(--row-selected-hover)] data-[state=open]:text-text-primary",
            inset && "pl-7",
            className
        )}
        {...props}
    >
        {children}
        <Icon icon={ChevronRight20Regular} className="ml-auto"  />
    </MenubarPrimitive.SubTrigger>
));
MenubarSubTrigger.displayName = MenubarPrimitive.SubTrigger.displayName;

const MenubarSubContent = React.forwardRef<
    React.ElementRef<typeof MenubarPrimitive.SubContent>,
    React.ComponentPropsWithoutRef<typeof MenubarPrimitive.SubContent>
>(({ className, sideOffset = 4, collisionPadding = menuCollisionPadding, ...props }, ref) => (
    <MenubarPrimitive.Portal>
        <MenubarPrimitive.SubContent
            ref={ref}
            sideOffset={sideOffset}
            collisionPadding={collisionPadding}
            className={cn(
                containerClasses,
                "min-w-32",
                menuInsetClasses,
                className,
            )}
            {...props}
        />
    </MenubarPrimitive.Portal>
));
MenubarSubContent.displayName = MenubarPrimitive.SubContent.displayName;

const MenubarContent = React.forwardRef<
    React.ElementRef<typeof MenubarPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Content>
>(({ className, alignOffset = -4, sideOffset = 4, collisionPadding = menuCollisionPadding, ...props }, ref) => (
    <MenubarPrimitive.Portal>
        <MenubarPrimitive.Content
            ref={ref}
            align="start"
            alignOffset={alignOffset}
            sideOffset={sideOffset}
            collisionPadding={collisionPadding}
            className={cn(
                containerClasses,
                "min-w-32",
                menuInsetClasses,
                className,
            )}
            {...props}
        />
    </MenubarPrimitive.Portal>
));
MenubarContent.displayName = MenubarPrimitive.Content.displayName;

const MenubarItem = React.forwardRef<
    React.ElementRef<typeof MenubarPrimitive.Item>,
    React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Item> & {
        inset?: boolean;
    }
>(({ className, inset, ...props }, ref) => (
    <MenubarPrimitive.Item
        ref={ref}
        className={cn("group", itemClasses, inset && "pl-7", className)}
        {...props}
    />
));
MenubarItem.displayName = MenubarPrimitive.Item.displayName;

const MenubarCheckboxItem = React.forwardRef<
    React.ElementRef<typeof MenubarPrimitive.CheckboxItem>,
    React.ComponentPropsWithoutRef<typeof MenubarPrimitive.CheckboxItem>
>(({ className, children, checked, onSelect, ...props }, ref) => (
    <MenubarPrimitive.CheckboxItem
        ref={ref}
        className={cn(itemClasses, "pr-1", className)}
        checked={checked}
        onSelect={(e) => {
            onSelect?.(e);
            e.preventDefault();
        }}
        {...props}
    >
        <span className="flex w-4 shrink-0 items-center justify-center">
            <MenubarPrimitive.ItemIndicator>
                <Icon icon={Checkmark20Regular}   />
            </MenubarPrimitive.ItemIndicator>
        </span>
        {children}
    </MenubarPrimitive.CheckboxItem>
));
MenubarCheckboxItem.displayName = MenubarPrimitive.CheckboxItem.displayName;

const MenubarRadioItem = React.forwardRef<
    React.ElementRef<typeof MenubarPrimitive.RadioItem>,
    React.ComponentPropsWithoutRef<typeof MenubarPrimitive.RadioItem>
>(({ className, children, onSelect, ...props }, ref) => (
    <MenubarPrimitive.RadioItem
        ref={ref}
        className={cn(itemClasses, "pr-1", className)}
        onSelect={(e) => {
            onSelect?.(e);
            e.preventDefault();
        }}
        {...props}
    >
        <span className="flex w-4 shrink-0 items-center justify-center">
            <MenubarPrimitive.ItemIndicator>
                <Icon icon={Circle20Regular}  className="size-[8px]"  />
            </MenubarPrimitive.ItemIndicator>
        </span>
        {children}
    </MenubarPrimitive.RadioItem>
));
MenubarRadioItem.displayName = MenubarPrimitive.RadioItem.displayName;

const MenubarLabel = React.forwardRef<
    React.ElementRef<typeof MenubarPrimitive.Label>,
    React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Label> & {
        inset?: boolean;
    }
>(({ className, inset, ...props }, ref) => (
    <MenubarPrimitive.Label
        ref={ref}
        className={cn(
            "mx-0.5 px-2 py-1.5 text-xs font-medium text-text-muted",
            inset && "pl-7",
            className,
        )}
        {...props}
    />
));
MenubarLabel.displayName = MenubarPrimitive.Label.displayName;

const MenubarSeparator = React.forwardRef<
    React.ElementRef<typeof MenubarPrimitive.Separator>,
    React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Separator>
>(({ className, ...props }, ref) => (
    <MenubarPrimitive.Separator
        ref={ref}
        className={cn("my-1 h-px bg-border-subtle", className)}
        {...props}
    />
));
MenubarSeparator.displayName = MenubarPrimitive.Separator.displayName;

/**
 * The keystroke hint on a menubar row, drawn in the same style as the dropdown's.
 *
 * The two menus share one class list, so the same shortcut cannot drift between them.
 */
const MenubarShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
    <span className={cn(shortcutClasses, className)} {...props} />
);
MenubarShortcut.displayName = "MenubarShortcut";

/**
 * A nested menubar row that holds its own open state, so it works with no props at all.
 *
 * Passing `open` hands the state to the caller, and the children are told either way.
 */
const MenubarNested = ({ children, open, onOpenChange }: { children: React.ReactNode, open?: boolean, onOpenChange?: (open: boolean) => void }) => {
    const [internalOpen, setInternalOpen] = React.useState(false);
    const isOpened = open !== undefined ? open : internalOpen;
    const setIsOpened = onOpenChange !== undefined ? onOpenChange : setInternalOpen;

    return (
        <div className="flex flex-col">
            {React.Children.map(children, (child) => {
                if (React.isValidElement(child)) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return React.cloneElement(child as any, { isOpened, setIsOpened });
                }
                return child;
            })}
        </div>
    );
};

const MenubarNestedTrigger = React.forwardRef<
    React.ElementRef<typeof MenubarItem>,
    React.ComponentPropsWithoutRef<typeof MenubarItem> & NestedMenuTriggerState
>((props, ref) => renderNestedMenuTrigger(MenubarItem, props, ref));
MenubarNestedTrigger.displayName = "MenubarNestedTrigger";

/** The panel a nested menubar row reveals, collapsed through its grid row. */
const MenubarNestedContent = NestedMenuContent;

export {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuCheckboxItem,
    DropdownMenuRadioItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuGroup,
    DropdownMenuPortal,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuRadioGroup,
    DropdownMenuNested,
    DropdownMenuNestedTrigger,
    DropdownMenuNestedContent,
    // Menubar Exports
    Menubar,
    MenubarMenu,
    MenubarTrigger,
    MenubarContent,
    MenubarItem,
    MenubarSeparator,
    MenubarLabel,
    MenubarCheckboxItem,
    MenubarRadioItem,
    MenubarPortal,
    MenubarShortcut,
    MenubarGroup,
    MenubarSub,
    MenubarSubContent,
    MenubarSubTrigger,
    MenubarRadioGroup,
    MenubarNested,
    MenubarNestedTrigger,
    MenubarNestedContent,
};

