"use client";

import React from "react";
import { cn, createOccurrenceKeyer } from "@/lib/utils";
import { CopyButton } from "@/components/ui/copy-button";
import { providerIcon } from "@/lib/ui/provider-icon";
import { tableCellModelId } from "@/lib/chat/fence-tables";
import styles from "./data-table.module.css";

/**
 * Wide tables scroll sideways inside this box, so it takes keyboard focus: a scroll region with
 * no focusable content is unreachable without a pointer (WCAG 2.1.1). A named group, not a
 * region, so every table does not add a landmark.
 */
const TABLE_SCROLLER_PROPS = { tabIndex: 0, role: "group", "aria-label": "Scrollable table" } as const;
/**
 * The focus ring is an inset outline: the rounded frame around the scroller clips anything drawn
 * outside it, and an outline paints above the table's cell backgrounds where an inset shadow
 * would sit beneath them.
 */
const TABLE_SCROLLER_CLASS =
    "custom-scrollbar overflow-x-auto overflow-y-hidden rounded-[inherit] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-text";

/** Escape md cell. */
const escapeMdCell = (cell: string): string => {
    return cell
        .replace(/\r?\n/g, " ")
        .replace(/\\/g, "\\\\")
        .replace(/\|/g, "\\|")
        .trim();
};

/** Formats header and body cells into an escaped GFM pipe table. */
export const formatRowsAsMarkdownTable = (headers: string[], rows: string[][]): string => {
    const colCount = Math.max(
        headers.length,
        rows.reduce((max, r) => Math.max(max, r.length), 0),
    );
    if (colCount === 0) return "";
    const effectiveHeaders =
        headers.length > 0
            ? Array.from({ length: colCount }, (_, i) => escapeMdCell(headers[i] ?? ""))
            : Array.from({ length: colCount }, (_, i) => `Column ${i + 1}`);
    const divider = effectiveHeaders.map(() => "---");
    const lines = [
        `| ${effectiveHeaders.join(" | ")} |`,
        `| ${divider.join(" | ")} |`,
        ...rows.map((row) => {
            const cells = Array.from({ length: colCount }, (_, i) => escapeMdCell(row[i] ?? ""));
            return `| ${cells.join(" | ")} |`;
        }),
    ];
    return lines.join("\n");
};

/** Extract dom table as markdown. */
const extractDomTableAsMarkdown = (container: HTMLElement | null): string => {
    const table = container?.querySelector("table");
    if (!table) return "";
    const headers = Array.from(table.querySelectorAll("thead th")).map(
        (th) => th.textContent?.trim() ?? "",
    );
    const bodyRows = Array.from(table.querySelectorAll("tbody tr")).map((tr) =>
        Array.from(tr.querySelectorAll("td, th")).map((td) => td.textContent?.trim() ?? ""),
    );
    if (headers.length === 0 && bodyRows.length > 0) {
        const allRows = Array.from(table.querySelectorAll("tr")).map((tr) =>
            Array.from(tr.querySelectorAll("td, th")).map((td) => td.textContent?.trim() ?? ""),
        );
        if (allRows.length > 0) {
            return formatRowsAsMarkdownTable(allRows[0] ?? [], allRows.slice(1));
        }
    }
    return formatRowsAsMarkdownTable(headers, bodyRows);
};

function CellInner({ value }: { value: string }) {
    const modelId = tableCellModelId(value);
    return (
        <span className={styles.cellInner}>
            {modelId ? <span className={styles.brand}>{providerIcon(modelId, 14)}</span> : null}
            <span>{value}</span>
        </span>
    );
}

/** Renders body rows inside `ChatDataTable`. */
const ChatDataTableBody = ({ rows }: { rows: string[][] }) => {
    const rowKey = createOccurrenceKeyer();
    return (
        <tbody>
            {rows.map((row) => {
                const cellKey = createOccurrenceKeyer();
                return (
                    <tr key={rowKey(row.join("|"))} className={styles.tr}>
                        {row.map((cell) => (
                            <td key={cellKey(cell)} className={styles.td}>
                                <CellInner value={cell} />
                            </td>
                        ))}
                    </tr>
                );
            })}
        </tbody>
    );
};

/** Renders the ChatDataTable UI component. */
export const ChatDataTable = ({
    headers,
    rows,
}: {
    headers: string[];
    rows: string[][];
}) => {
    const markdownText = React.useMemo(
        () => formatRowsAsMarkdownTable(headers, rows),
        [headers, rows],
    );
    return (
        <div className={cn(styles.wrap, "group/table relative")}>
            {markdownText ? (
                <div className="absolute top-1.5 right-1.5 z-10 opacity-0 transition-opacity duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] group-hover/table:opacity-100 focus-within:opacity-100">
                    <CopyButton
                        text={markdownText}
                        label="Copy table as Markdown"
                        boxClassName="bg-surface-3 border border-border-subtle shadow-xs"
                    />
                </div>
            ) : null}
            <div {...TABLE_SCROLLER_PROPS} className={cn(styles.scroller, TABLE_SCROLLER_CLASS)}>
                <table className={styles.table}>
                    {headers.length > 0 ? (
                        <thead>
                            <tr>
                                {headers.map((header) => (
                                    <th key={header} className={styles.th}>
                                        {header}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                    ) : null}
                    <ChatDataTableBody rows={rows} />
                </table>
            </div>
        </div>
    );
};

/** Reads an own stringified cell value from `row` without traversing `Object.prototype`. */
const readOwnTableCell = (row: Record<string, unknown>, header: string): string => {
    const value = Object.hasOwn(row, header) ? row[header] : undefined;
    return value == null ? "" : String(value);
};

/** Renders the ChatKeyedRowsTable UI component. */
export const ChatKeyedRowsTable = ({ rows }: { rows: Record<string, string>[] }) => {
    const headers = React.useMemo(() => {
        const keys: string[] = [];
        for (const row of rows) {
            for (const key of Object.keys(row)) {
                if (!keys.includes(key)) keys.push(key);
            }
        }
        return keys;
    }, [rows]);
    const body = rows.map((row) => headers.map((header) => readOwnTableCell(row, header)));
    return <ChatDataTable headers={headers} rows={body} />;
};

/** Renders the MarkdownTableShell UI component. */
export const MarkdownTableShell = ({ children }: { children?: React.ReactNode }) => {
    const wrapRef = React.useRef<HTMLDivElement>(null);
    const [mdText, setMdText] = React.useState("");

    const syncTableMarkdown = React.useCallback(() => {
        const next = extractDomTableAsMarkdown(wrapRef.current);
        setMdText((prev) => (prev === next ? prev : next));
    }, []);

    React.useEffect(() => {
        syncTableMarkdown();
    }, [children, syncTableMarkdown]);

    return (
        <div
            ref={wrapRef}
            onMouseEnter={syncTableMarkdown}
            onFocus={syncTableMarkdown}
            className={cn(styles.wrap, "group/table relative my-2")}
        >
            <div className="absolute top-1.5 right-1.5 z-10 opacity-0 transition-opacity duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] group-hover/table:opacity-100 focus-within:opacity-100">
                <CopyButton
                    text={mdText}
                    label="Copy table as Markdown"
                    boxClassName="bg-surface-3 border border-border-subtle shadow-xs"
                />
            </div>
            <div {...TABLE_SCROLLER_PROPS} className={cn(styles.scroller, TABLE_SCROLLER_CLASS)}>
                {children}
            </div>
        </div>
    );
};
