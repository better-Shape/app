"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { CopyButton } from "@/components/ui/copy-button";
import { providerIcon } from "@/lib/ui/provider-icon";
import { tableCellModelId } from "@/lib/chat/fence-tables";
import styles from "./data-table.module.css";

function escapeMdCell(cell: string): string {
    return cell
        .replace(/\r?\n/g, " ")
        .replace(/\\/g, "\\\\")
        .replace(/\|/g, "\\|")
        .trim();
}

/** Formats header and body cells into an escaped GFM pipe table. */
export function formatRowsAsMarkdownTable(headers: string[], rows: string[][]): string {
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
}

function extractDomTableAsMarkdown(container: HTMLElement | null): string {
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
}

function CellInner({ value }: { value: string }) {
    const modelId = tableCellModelId(value);
    return (
        <span className={styles.cellInner}>
            {modelId ? <span className={styles.brand}>{providerIcon(modelId, 14)}</span> : null}
            <span>{value}</span>
        </span>
    );
}

export function ChatDataTable({
    headers,
    rows,
}: {
    headers: string[];
    rows: string[][];
}) {
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
            <table className={styles.table}>
                {headers.length > 0 ? (
                    <thead>
                        <tr>
                            {headers.map((h) => (
                                <th key={h} className={styles.th}>
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                ) : null}
                <tbody>
                    {rows.map((row, i) => (
                        <tr key={i} className={styles.tr}>
                            {row.map((cell, j) => (
                                <td key={j} className={styles.td}>
                                    <CellInner value={cell} />
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function ChatKeyedRowsTable({ rows }: { rows: Record<string, string>[] }) {
    const headers = React.useMemo(() => {
        const keys: string[] = [];
        for (const row of rows) {
            for (const k of Object.keys(row)) {
                if (!keys.includes(k)) keys.push(k);
            }
        }
        return keys;
    }, [rows]);
    const body = rows.map((row) => headers.map((h) => row[h] ?? ""));
    return <ChatDataTable headers={headers} rows={body} />;
}

export function MarkdownTableShell({ children }: { children?: React.ReactNode }) {
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
            {children}
        </div>
    );
}
