/**
 * Reads the indentation a file already uses, so the editor can match it.
 *
 * Settings -> Editor -> "Detect indentation" is a switch a reader expects to
 * change what Tab does. It only can if the buffer is inspected: the editor
 * otherwise keeps whatever the setting says and reindents a two-space file with
 * four.
 */
export function detectIndentation(content: string): { tabSize: number; insertSpaces: boolean } | null {
    const lines = content.split("\n");
    let tabbed = 0;
    let spaced = 0;
    const widths = new Map<number, number>();
    for (const line of lines) {
        if (!line.trim()) continue;
        const match = /^([ \t]+)/.exec(line);
        if (!match) continue;
        const indent = match[1];
        if (indent.startsWith("\t")) {
            tabbed += 1;
            continue;
        }
        spaced += 1;
        if (indent.length > 0) widths.set(indent.length, (widths.get(indent.length) ?? 0) + 1);
    }
    if (tabbed === 0 && spaced === 0) return null;
    if (tabbed > spaced) return { tabSize: 1, insertSpaces: false };
    if (spaced === 0) return null;
    // The smallest indent used is the unit: a file indented by 2 then 4 then 6
    // spaces has a tab size of 2, not 6.
    const size = Math.min(...widths.keys());
    if (!Number.isFinite(size) || size < 1 || size > 16) return null;
    return { tabSize: size, insertSpaces: true };
}
