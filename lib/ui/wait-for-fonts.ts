/**
 * `FontFaceSet.ready` is a promise, so branching on it is always true while the
 * FontFaceSet exists, and the branch never means what its author intended. Every
 * caller wants the same thing: wait for pending font loads, then carry on. A
 * rejected FontFaceSet must never hold up the caller, so the rejection is
 * swallowed here rather than at each call site.
 *
 * The preview runtime injects JavaScript as a source string and cannot import
 * this module, so those call sites keep an inline equivalent.
 */
export async function waitForFonts(doc: Document): Promise<void> {
    try {
        await doc.fonts?.ready;
    } catch {
        /* a failed font load must not block the caller */
    }
}
