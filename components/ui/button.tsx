"use client";




import * as React from "react";
import { Arc } from "loading-dev";
import { type IconGlyph, Icon } from "@/components/ui/icon";


import { cn } from "@/lib/utils";

export type ButtonVariant =
    | "default"
    | "confirm"
    | "secondary"
    | "ghost"
    | "outline"
    | "destructive"
    | "danger"
    | "link";
export type ButtonCategory = "primary" | "tertiary";
export type ButtonSize = "xs" | "sm" | "md" | "lg" | "icon";
export type ButtonStatus = "idle" | "loading" | "waiting" | "error";

const variantClasses: Record<ButtonVariant, string> = {
    default:
        "bg-accent text-accent-fg hover:bg-accent-hover aria-disabled:bg-accent/50 aria-disabled:text-accent-fg disabled:bg-accent/50 disabled:text-accent-fg",
    confirm:
        "bg-accent text-accent-fg hover:bg-accent-hover aria-disabled:bg-accent/50 aria-disabled:text-accent-fg disabled:bg-accent/50 disabled:text-accent-fg",
    secondary:
        "bg-surface-3 text-text-secondary hover:bg-surface-4 hover:text-text-primary aria-disabled:bg-surface-3 aria-disabled:text-text-disabled disabled:bg-surface-3 disabled:text-text-disabled",
    ghost: "bg-transparent text-text-secondary hover:bg-[var(--btn-hover)] hover:text-text-primary aria-disabled:bg-transparent aria-disabled:text-text-disabled disabled:bg-transparent disabled:text-text-disabled",
    outline:
        "border border-input-border bg-transparent text-text-primary hover:bg-[var(--btn-hover)] aria-disabled:border-border-subtle aria-disabled:text-text-disabled disabled:border-border-subtle disabled:text-text-disabled",
    destructive:
        "bg-error text-white hover:bg-error/90 aria-disabled:bg-error/50 aria-disabled:text-white disabled:bg-error/50 disabled:text-white",
    danger: "bg-error text-white hover:bg-error/90 aria-disabled:bg-error/50 aria-disabled:text-white disabled:bg-error/50 disabled:text-white",
    link: "bg-transparent px-0 text-accent underline-offset-2 hover:underline hover:text-accent-hover aria-disabled:text-text-disabled disabled:text-text-disabled",
};

const tertiaryOverride: Partial<Record<ButtonVariant, string>> = {
    default: "bg-transparent text-accent hover:bg-[var(--btn-hover)] hover:text-accent-hover",
    confirm: "bg-transparent text-accent hover:bg-[var(--btn-hover)] hover:text-accent-hover",
    secondary: "bg-transparent text-text-secondary hover:bg-[var(--btn-hover)] hover:text-text-primary",
    destructive: "bg-transparent text-error hover:bg-error/10 hover:text-error",
    danger: "bg-transparent text-error hover:bg-error/10 hover:text-error",
};

const sizeClasses: Record<ButtonSize, string> = {
    xs: "h-7 min-h-7 px-2.5 text-xs squircle-2xl",
    sm: "h-7.5 min-h-7.5 px-3 text-sm squircle-2xl",
    md: "h-9 min-h-8 px-3.5 text-sm squircle-2xl",
    lg: "h-10 min-h-10 px-4 text-base squircle-3xl",
    icon: "size-7 min-h-7 min-w-7 shrink-0 overflow-visible p-0 squircle-4xl",
};

const selectedClasses =
    "bg-[var(--btn-open)] text-text-primary hover:bg-[var(--btn-open-hover)] hover:text-text-primary";

const spinnerClass: Record<ButtonSize, string> = {
    xs: "imsg-typing imsg-typing-sm",
    sm: "imsg-typing imsg-typing-sm",
    md: "imsg-typing imsg-typing-sm",
    lg: "imsg-typing",
    icon: "imsg-typing imsg-typing-sm",
};

/**
 * The three-dot indicator a button shows while its action is in flight.
 *
 * The dots take the button's own text color instead of a fixed one, because the loading face
 * sits on every variant from accent to ghost, and the status role is the whole accessible
 * output: the dots themselves are decoration.
 */
export function ButtonSpinner({
    className,
    size = "md",
}: {
    className?: string;
    size?: ButtonSize;
}) {
    return (
        <span
            className={cn(spinnerClass[size], "[&_span]:bg-current", className)}
            role="status"
            aria-label="Loading"
        >
            <span />
            <span />
            <span />
        </span>
    );
}

/**
 * The inline progress arc a button shows in place of its icon while it is loading.
 *
 * Smaller than the icon it replaces at the default size, because the arc reads heavier than
 * a glyph at the same box, and it keeps the button's width: the glyph it stands in for has
 * already been laid out.
 */
function LoadingGlyph({ size }: { size: ButtonSize }) {
    return <Arc size={size === "lg" ? 18 : 14} />;
}

/**
 * The class list every face starts from.
 *
 * `press-spring` sits on the element the pointer lands on rather than on an inner wrapper,
 * which is what lets the press animation run on the button's own transform.
 */
const buttonBaseClasses =
    "press-spring relative inline-flex items-center justify-center gap-1.5 font-medium outline-none select-none touch-manipulation [-webkit-tap-highlight-color:transparent] focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 [&_svg.bettershape-icon]:pointer-events-none [&_svg.bettershape-icon]:shrink-0";

/**
 * The fill and text color for a variant, plus the tertiary category's override.
 *
 * Tertiary keeps the variant's text color and gives up its fill, which is the whole
 * difference between a toolbar button and a link-shaped one in the same row.
 */
const variantFaceClasses = (variant: ButtonVariant, category: ButtonCategory): string =>
    cn(variantClasses[variant], category === "tertiary" && tertiaryOverride[variant]);

/**
 * The square correction an icon-only button takes when the caller chose its height.
 *
 * The size class still owns the box, so an icon button lines up with the text buttons beside
 * it; only the horizontal padding and the ratio change.
 */
const iconBoxClasses = (size: ButtonSize): string | false => (size === "icon" ? false : "px-0 aspect-square");

/** The size box, with the icon size standing in when the control holds nothing else. */
const sizeFaceClasses = (size: ButtonSize, iconOnly: boolean): string =>
    cn(sizeClasses[iconOnly && size === "icon" ? "icon" : size], iconOnly && iconBoxClasses(size));

/**
 * The fill a control takes from its own state: committed, full width, or inert.
 *
 * The committed fill is the rung above hover, so a selected button under the pointer still
 * reads as a step up from a hovered one.
 */
const stateFaceClasses = ({
    selected,
    block,
    inactive,
}: {
    selected: boolean;
    block: boolean;
    inactive: boolean;
}): string => cn(selected && selectedClasses, block && "w-full", inactive && "cursor-not-allowed");

/** The inert face of a labelled button, which is a copyable label rather than a control. */
const labelFaceClasses = (label: boolean): string | false =>
    label ? "cursor-default select-text pointer-events-none bg-surface-2 text-text-secondary hover:bg-surface-2" : false;

/** The small numeral after a label, with the spelled-out form for screen readers. */
const ButtonCount = ({ count, countSrText }: { count: number; countSrText?: string }) => (
    <span className="ml-0.5 tabular-nums text-xs text-current/80">
        {count}
        {countSrText ? <span className="sr-only"> {countSrText}</span> : null}
    </span>
);

/** The glyph in front of a label: the progress arc while loading, the icon otherwise. */
const LeadingGlyph = ({
    icon,
    spinnerLoading,
    size,
}: {
    icon?: IconGlyph;
    spinnerLoading: boolean;
    size: ButtonSize;
}) => {
    if (spinnerLoading) return <LoadingGlyph size={size} />;
    return icon ? <Icon icon={icon} /> : null;
};

/**
 * What a busy button shows: its contents held invisible with the dots drawn over them.
 *
 * The contents stay mounted rather than hidden, which is what keeps the width steady while
 * the action is in flight, so nothing beside the button moves when it starts.
 */
const BusyFace = ({
    icon,
    size,
    children,
}: {
    icon?: IconGlyph;
    size: ButtonSize;
    children?: React.ReactNode;
}) => (
    <>
        <span className="invisible inline-flex items-center justify-center gap-1.5">
            {icon ? <Icon icon={icon} /> : null}
            {children}
        </span>
        <span className="absolute inset-0 flex items-center justify-center">
            <ButtonSpinner size={size} />
        </span>
    </>
);

/** What an idle button shows: the leading glyph, the label, and the optional count. */
const IdleFace = ({
    icon,
    spinnerLoading,
    size,
    count,
    countSrText,
    children,
}: {
    icon?: IconGlyph;
    spinnerLoading: boolean;
    size: ButtonSize;
    count?: number;
    countSrText?: string;
    children?: React.ReactNode;
}) => (
    <>
        <LeadingGlyph icon={icon} spinnerLoading={spinnerLoading} size={size} />
        {children}
        {count == null ? null : <ButtonCount count={count} countSrText={countSrText} />}
    </>
);

/**
 * The press state behind the spring, and the rule that decides whether a press counts.
 *
 * A control that opens a popup keeps its pressed look to itself: the menu is already the
 * feedback, and a shadow under it would read as a second state.
 */
const usePressSpring = ({ inactive, label }: { inactive: boolean; label: boolean }) => {
    const [pressed, setPressed] = React.useState(false);
    const endPress = React.useCallback(() => setPressed(false), []);
    const startPress = React.useCallback(
        (element?: HTMLElement | null) => {
            if (inactive || label) return;
            if (element?.getAttribute("aria-haspopup") || element?.getAttribute("aria-expanded") === "true") {
                return;
            }
            setPressed(true);
        },
        [inactive, label],
    );
    return { pressed, endPress, startPress };
};

/** Whether a status means the model, not the button, is working. */
const isAiBusy = (status: ButtonStatus): boolean => status === "loading" || status === "waiting";

/**
 * Whether the control cannot act.
 *
 * `loading` counts even when the caller left `disabled` off: the action is already running,
 * so a second press is the bug this prevents.
 */
const isInactive = (status: ButtonStatus, loading: boolean, disabled?: boolean): boolean =>
    Boolean(disabled) || loading || isAiBusy(status);

/** Whether the local progress arc takes the icon's place. */
const isSpinnerLoading = (status: ButtonStatus, loading: boolean): boolean => loading && !isAiBusy(status);

/** Whether the control holds an icon and nothing else. */
const isIconOnly = (icon: IconGlyph | undefined, children: React.ReactNode): boolean => Boolean(icon) && children == null;

/**
 * Whether the disabled state is the native attribute rather than an announced one.
 *
 * A link, a label and an accessible-disabled control all keep their place in the tab order,
 * so the state has to be announced instead of applied.
 */
const usesNativeDisabled = ({
    inactive,
    accessibleDisabled,
    href,
    label,
}: {
    inactive: boolean;
    accessibleDisabled: boolean;
    href?: string;
    label: boolean;
}): boolean => inactive && !accessibleDisabled && !href && !label;

/**
 * The attributes that say a control is busy, pressed, or unable to act.
 *
 * Both forms of the button build them here, so an anchor and a button cannot end up saying
 * different things about the same state.
 */
const stateAriaProps = ({
    busy,
    pressed,
    blocked,
    ariaDisabled,
}: {
    busy: boolean;
    pressed: boolean;
    blocked: boolean;
    ariaDisabled: boolean;
}) => ({
    "data-pressed": pressed && !blocked ? true : undefined,
    "aria-busy": busy ? true : undefined,
    "aria-disabled": ariaDisabled ? true : undefined,
});

/**
 * Where an anchor points, and how it stands aside when it cannot act.
 *
 * An anchor has no `disabled` attribute, so the state travels as the missing href, the
 * button role it takes when the href is a placeholder, and a negative tab index.
 */
const anchorTargetProps = (href: string, ariaDisabled: boolean) => ({
    href: ariaDisabled ? undefined : href,
    role: href === "#" ? ("button" as const) : undefined,
    tabIndex: ariaDisabled ? -1 : 0,
});

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    category?: ButtonCategory;
    size?: ButtonSize;
    status?: ButtonStatus;
    loading?: boolean;
    selected?: boolean;
    block?: boolean;
    icon?: IconGlyph;
    count?: number;
    countSrText?: string;
    label?: boolean;
    href?: string;
    accessibleDisabled?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    (
        {
            className,
            variant = "default",
            category = "primary",
            size = "md",
            status = "idle",
            loading = false,
            selected = false,
            block = false,
            icon,
            count,
            countSrText,
            label = false,
            href,
            accessibleDisabled = true,
            type = "button",
            disabled,
            children,
            onClick,
            onKeyDown,
            onKeyUp,
            onPointerDown,
            onPointerUp,
            onPointerCancel,
            onPointerLeave,
            "aria-pressed": ariaPressed,
            ...props
        },
        ref,
    ) => {
        const aiBusy = isAiBusy(status);
        const spinnerLoading = isSpinnerLoading(status, loading);
        const inactive = isInactive(status, loading, disabled);
        const resolvedVariant = status === "error" ? "destructive" : variant;
        const iconOnly = isIconOnly(icon, children);
        const useNativeDisabled = usesNativeDisabled({ inactive, accessibleDisabled, href, label });
        const ariaDisabled = inactive && !useNativeDisabled;
        const busy = loading || aiBusy;
        const { pressed, endPress, startPress } = usePressSpring({ inactive, label });

        const classes = cn(
            buttonBaseClasses,
            variantFaceClasses(resolvedVariant, category),
            sizeFaceClasses(size, iconOnly),
            stateFaceClasses({ selected, block, inactive }),
            labelFaceClasses(label),
            className,
        );

        // The busy face renders last: the dots sit over the contents rather than beside them.
        const face = aiBusy ? (
            <BusyFace icon={icon} size={iconOnly ? "icon" : size}>
                {children}
            </BusyFace>
        ) : (
            <IdleFace
                icon={icon}
                spinnerLoading={spinnerLoading}
                size={size}
                count={count}
                countSrText={countSrText}
            >
                {children}
            </IdleFace>
        );

        const content = face;

        /**
         * Swallows a click on a button that cannot act, and says whether it did.
         *
         * `accessibleDisabled` keeps the control focusable and announced rather than
         * removed from the tab order, so the click still has to be stopped here or the
         * handler behind it would run anyway.
         */
        const guardActivation = (event: React.SyntheticEvent) => {
            if (!inactive) return false;
            event.preventDefault();
            event.stopPropagation();
            return true;
        };

        if (label) {
            return (
                <span ref={ref as React.Ref<HTMLSpanElement>} className={classes}>
                    {content}
                </span>
            );
        }

        if (href) {
            return (
                <a
                    ref={ref as React.Ref<HTMLAnchorElement>}
                    {...anchorTargetProps(href, ariaDisabled)}
                    className={classes}
                    {...stateAriaProps({ busy, pressed, blocked: ariaDisabled, ariaDisabled })}
                    onClick={(e) => {
                        if (guardActivation(e)) return;
                        onClick?.(e as unknown as React.MouseEvent<HTMLButtonElement>);
                    }}
                    onPointerDown={(e) => {
                        if (e.button === 0) startPress(e.currentTarget);
                    }}
                    onPointerUp={endPress}
                    onPointerCancel={endPress}
                    onPointerLeave={endPress}
                >
                    {content}
                </a>
            );
        }

        return (
            <button
                ref={ref}
                type={type}
                disabled={useNativeDisabled || undefined}
                {...props}
                className={classes}
                {...stateAriaProps({ busy, pressed, blocked: inactive, ariaDisabled })}
                aria-pressed={selected ? true : ariaPressed}
                onClick={(e) => {
                    if (guardActivation(e)) return;
                    onClick?.(e);
                }}
                onPointerDown={(e) => {
                    onPointerDown?.(e);
                    if (e.button === 0) startPress(e.currentTarget);
                }}
                onPointerUp={(e) => {
                    onPointerUp?.(e);
                    endPress();
                }}
                onPointerCancel={(e) => {
                    onPointerCancel?.(e);
                    endPress();
                }}
                onPointerLeave={(e) => {
                    onPointerLeave?.(e);
                    endPress();
                }}
                onKeyDown={(e) => {
                    if (inactive && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        return;
                    }
                    if (!inactive && (e.key === "Enter" || e.key === " ")) startPress(e.currentTarget);
                    onKeyDown?.(e);
                }}
                onKeyUp={(e) => {
                    if (e.key === "Enter" || e.key === " ") endPress();
                    onKeyUp?.(e);
                }}
            >
                {content}
            </button>
        );
    },
);

Button.displayName = "Button";

export { ButtonGroup } from "./button-group";
