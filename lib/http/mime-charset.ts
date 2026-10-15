const MIME_ESSENCE = /^[!#$%&'*+.^_`|~\w-]+\/[!#$%&'*+.^_`|~\w-]+$/;
const PARAMETER_VALUE = /^[\t\x20-\x7e\x80-\xff]*$/;
function trimEnd(value: string): string {
    let end = value.length;
    while (end > 0 && "\t\n\r ".includes(value[end - 1])) end--;
    return value.slice(0, end);
}
const nextSeparator = (source: string, start: number) => {
    const index = source.indexOf(";", start);
    return index < 0 ? source.length : index;
};

/** Consume quoted pairs before seeking a separator; embedded semicolons are not parameters. */
function parameterValue(source: string, start: number): { value: string; end: number; quoted: boolean } {
    if (source[start] !== '"') {
        const end = nextSeparator(source, start);
        return { value: trimEnd(source.slice(start, end)), end, quoted: false };
    }
    let value = "";
    let index = start + 1;
    while (index < source.length) {
        const character = source[index++];
        if (character === '"') break;
        value += character === "\\" && index < source.length ? source[index++] : character;
    }
    return { value, end: nextSeparator(source, index), quoted: true };
}

/** First valid charset parameter, following MIME parsing (including quoted pairs and duplicates). */
export function mimeCharset(source: string): string | undefined {
    source = trimEnd(source);
    const separator = nextSeparator(source, 0);
    const essence = trimEnd(source.slice(0, separator).replace(/^[\t\n\r ]+/, ""));
    if (!MIME_ESSENCE.test(essence)) return undefined;
    let index = separator + 1;
    while (index < source.length) {
        const end = nextSeparator(source, index);
        const equals = source.slice(index, end).indexOf("=");
        if (equals < 0) { index = end + 1; continue; }
        const valueStart = index + equals + 1;
        const name = source.slice(index, valueStart - 1).replace(/^[\t\n\r ]+/, "").toLowerCase();
        const parsed = parameterValue(source, valueStart);
        index = parsed.end + 1;
        if (name === "charset" && (parsed.quoted || parsed.value !== "") && PARAMETER_VALUE.test(parsed.value)) return parsed.value;
    }
    return undefined;
}
