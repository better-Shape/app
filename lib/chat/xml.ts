/** Encode double-quoted XML-like metadata without changing the original value. */
export function escapeXmlAttr(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/** Decode the producer's four entities exactly once, preserving literal entity names. */
export function decodeXmlAttr(value: string): string {
    return value.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
