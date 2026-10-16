"use client";

import { Clipboard20Regular } from "@fluentui/react-icons/headless/svg/clipboard";

import { DrawnCheck } from "@/components/ui/checkmark";
import { Icon } from "@/components/ui/icon";
import { SwapText } from "@/components/ui/swap";
import { useCopyToClipboard } from "@/lib/ui/use-copy";
import { cn } from "@/lib/utils";

export interface CopyButtonProps {
    /** Text written to the clipboard. */
    text: string;
    /** Spoken label, and the tooltip when `showLabel` is false. */
    label?: string;
    /** Render the word next to the glyph instead of glyph-only. */
    showLabel?: boolean;
    /** Toast copy, e.g. "Commit hash copied to clipboard". */
    successDescription?: string;
    className?: string;
    /** Extra classes for the button box, so call sites keep their own chrome. */
    boxClassName?: string;
}

/** The three faces the control can show, in the order the state resolves. */
const copyState = (copied: boolean, failed: boolean): "copied" | "failed" | "idle" => {
    if (copied) return "copied";
    return failed ? "failed" : "idle";
};

/**
 * The incoming layer: a drawn mark once copied, the clipboard glyph otherwise.
 *
 * The word is fixed to "Copy"/"Copied" rather than the `label` prop, which carries longer
 * text ("Copy path") for the tooltip and the spoken name; that would be too wide here.
 */
const CopyFace = ({ face, showLabel }: { face: string; showLabel: boolean }) => (
    <>
        {face === "Copied" ? <DrawnCheck /> : <Icon icon={Clipboard20Regular} />}
        {showLabel ? <span>{face === "Copied" ? "Copied" : "Copy"}</span> : null}
    </>
);

/**
 * The copy affordance, in one place.
 *
 * Before this, a copy glyph could mean three different things depending on which
 * panel you were in: a toast, a silent no-op, or a word that flipped instantly.
 * The glyph and word now cross through `SwapText`, so the control answers in one
 * beat whether it is icon-only or labelled.
 */
export const CopyButton = ({
    text,
    label = "Copy",
    showLabel = false,
    successDescription,
    className,
    boxClassName,
}: CopyButtonProps) => {
    const { copied, failed, copy } = useCopyToClipboard({ successDescription });

    // One place decides which of the three faces the control shows, so the attribute, the
    // spoken name and the tone cannot drift apart.
    const state = copyState(copied, failed);
    const face = state === "copied" ? "Copied" : label;

    return (
        <button
            type="button"
            data-copy-state={state}
            aria-label={face}
            title={showLabel ? undefined : label}
            onClick={(e) => {
                e.stopPropagation();
                copy(text);
            }}
            className={cn(
                "press-spring inline-flex items-center gap-1.5 rounded-lg",
                state === "copied" && "text-success",
                state === "failed" && "text-error",
                className,
                boxClassName,
            )}
        >
            <SwapText
                value={face}
                live
                render={(face) => <CopyFace face={face} showLabel={showLabel} />}
            />
        </button>
    );
};
