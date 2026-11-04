/**
 * Reads the indentation a file already uses, so the editor can match it.
 *
 * Settings -> Editor -> "Detect indentation" is a switch a reader expects to
 * change what Tab does. It only can if the buffer is inspected: the editor
 * otherwise keeps whatever the setting says and reindents a two-space file with
 * four.
 */
/**
 * Removes block and line comments from one line, carrying the block-comment
 * state across lines. Comment continuation lines (` * text`) would otherwise
 * look like a one-space indent and drag the detected tab size down to 1.
 */
function codeOutsideComments(line: string, open: { block: boolean }): string {
    let code = "";
    let index = 0;
    while (index < line.length) {
        if (open.block) {
            const end = line.indexOf("*/", index);
            if (end === -1) return code;
            index = end + 2;
            open.block = false;
            continue;
        }
        const block = line.indexOf("/*", index);
        const single = line.indexOf("//", index);
        if (single !== -1 && (block === -1 || single < block)) {
            return code + line.slice(index, single);
        }
        if (block === -1) return code + line.slice(index);
        code += line.slice(index, block);
        open.block = true;
        index = block + 2;
    }
    return code;
}

export function detectIndentation(content: string): { tabSize: number; insertSpaces: boolean } | null {
    const lines = content.split("\n");
    let tabbed = 0;
    let spaced = 0;
    const widths = new Map<number, number>();
    const open = { block: false };
    for (const line of lines) {
        const startsInComment = open.block;
        const code = codeOutsideComments(line, open);
        // Nothing to measure: blank, or a line that is only comment text.
        if (!code.trim()) continue;
        // A continuation line's spaces belong to the comment's star column, not
        // to the code, so only a line that starts in code carries an indent.
        if (startsInComment) continue;
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
