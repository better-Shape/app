/**
 * The row recipes shared by Git list rows and the skeletons that stand in for them.
 *
 * A skeleton is only worth showing if it occupies the space the real row will take:
 * if the placeholder is a different height, the list jolts the moment data lands and
 * the placeholder has made the wait *worse* than showing nothing. These constants are
 * the single source of that geometry, the live row and its skeleton both read them,
 * so a padding change cannot silently desync the two.
 *
 * Measured against the compiled stylesheet at the app's 13px root: `py-2` is 6.5px a
 * side, `gap-1` is 3.25px, `gap-0.5` is 1.625px, one `text-sm leading-snug` line box
 * is 19.25px, `text-xs` is 17.33px and `text-2xs` is 16.8px.
 */
export const GIT_ROW = {
    /** Job rows: disclosure chevron, status glyph, title over meta. */
    job: "h-auto w-full items-start gap-1 rounded-xl px-2 py-2 text-left font-normal",
    /** Run rows: status glyph, title (up to two lines) over meta + actor avatar. */
    run: "h-auto w-full flex-col items-stretch gap-0.5 rounded-xl px-3 py-2 text-left font-normal",
    /** Release rows: tag over date, no leading glyph. */
    release: "flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors",
    /** One-line dense rows: steps, branches, commit files. */
    dense: "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs",
} as const;

export type GitRowVariant = keyof typeof GIT_ROW;

/**
 * Line-box classes for the placeholder lines, matching the live row's type, plus the
 * height the live row's title can take up.
 *
 * `titleLines` is what the skeleton draws, and `titleReserve` is the matching minimum on
 * the live title, so a row is the same height whether the title wraps or not. Only a
 * clamped title needs both: at the 13px root one `text-sm leading-snug` line box is
 * 19.25px, so a two-line clamp reserves 38.5px and the skeleton stacks two line boxes to
 * the same total.
 */
export const GIT_ROW_TEXT = {
    job: { title: "text-sm", meta: "text-xs", titleLines: 1, titleReserve: "" },
    run: { title: "text-sm leading-snug", meta: "text-2xs", titleLines: 2, titleReserve: "min-h-[38.5px]" },
    release: { title: "text-sm", meta: "text-xs", titleLines: 1, titleReserve: "" },
    dense: { title: "text-xs", meta: "text-xs", titleLines: 1, titleReserve: "" },
} as const satisfies Record<GitRowVariant, { title: string; meta: string; titleLines: number; titleReserve: string }>;
