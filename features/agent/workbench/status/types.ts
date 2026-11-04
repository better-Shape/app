export type EditorStatus = {
    line: number;
    column: number;
    spaces: number;
    insertSpaces: boolean;
    eol: "LF" | "CRLF";
    language: string;
    /** "Author · 1d ago" for the caret line, once inline blame has data. */
    blame?: string;
};

export const DEFAULT_EDITOR_STATUS: EditorStatus = {
    line: 1,
    column: 1,
    spaces: 4,
    insertSpaces: true,
    eol: "LF",
    language: "Plain Text",
};
