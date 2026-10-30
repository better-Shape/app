/** A CSS number as typed in an inspector field: the number, then any unit. */
export type NumericDraft = {
    /** The numeric prefix exactly as typed, e.g. `-1.5`. */
    value: string;
    /** Everything after the number, including the space in `12 px`. */
    unit: string;
};

const isDigit = (char: string): boolean => char >= "0" && char <= "9";

/**
 * Parses `12`, `-1.5`, `.5`, `12px` and `12 px`.
 *
 * Written as a scan rather than a pattern: the regex it replaces needed nested
 * quantifiers to allow a spaced unit, and that shape backtracks
 * super-linearly on the kind of long digit runs a design inspector sees.
 * Returns null for anything that is not a single number plus a single unit,
 * which is what keeps a field from reporting `12 px extra` as steppable.
 */
export function parseNumericDraft(raw: string): NumericDraft | null {
    const text = raw.trim();
    let at = 0;
    if (text[at] === "-") at += 1;
    let sawDigit = false;
    while (at < text.length && isDigit(text[at])) {
        sawDigit = true;
        at += 1;
    }
    if (text[at] === ".") {
        at += 1;
        while (at < text.length && isDigit(text[at])) {
            sawDigit = true;
            at += 1;
        }
    }
    if (!sawDigit) return null;
    const unit = text.slice(at);
    // More than one unit token would step the wrong part of the value.
    for (const char of unit.trim()) {
        if (/\s/.test(char)) return null;
    }
    return { value: text.slice(0, at), unit };
}

/** True when the field holds a steppable number. */
export function isNumericDraft(raw: string): boolean {
    return parseNumericDraft(raw) !== null;
}
