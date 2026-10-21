"use client";

import "./disable-openui-devtools";
import { createLibrary, defineComponent, Renderer } from "@openuidev/react-lang";
import { z } from "zod/v4";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

const childrenSchema = z.array(z.any()).max(24);
const MAX_OPENUI_NESTING = 16;
const OpenUINestingContext = createContext(0);

type BoundedChildrenProps = {
    children: unknown;
    renderNode: (value: unknown) => ReactNode;
};

function BoundedChildren({ children, renderNode }: BoundedChildrenProps) {
    const depth = useContext(OpenUINestingContext);
    if (depth >= MAX_OPENUI_NESTING) {
        return <p className="text-xs text-text-secondary" role="status">This visual response is nested too deeply to display.</p>;
    }
    return (
        <OpenUINestingContext.Provider value={depth + 1}>
            {renderNode(children)}
        </OpenUINestingContext.Provider>
    );
}

const Surface = defineComponent({
    name: "Surface",
    description: "The required top-level container for one visual answer.",
    props: z.object({
        children: childrenSchema,
        title: z.string().optional(),
        subtitle: z.string().optional(),
    }),
    component: ({ props, renderNode }) => (
        <section className="my-3 w-full rounded-xl border border-border-subtle bg-surface-2 p-3">
            {props.title || props.subtitle ? (
                <header className="min-w-0">
                    {props.title ? <h3 className="text-md font-semibold text-text-primary">{props.title}</h3> : null}
                    {props.subtitle ? <p className={(props.title ? "mt-1 " : "") + "text-xs leading-relaxed text-text-secondary"}>{props.subtitle}</p> : null}
                </header>
            ) : null}
            <div className={props.title || props.subtitle ? "mt-3" : ""}>
                <BoundedChildren renderNode={renderNode}>{props.children}</BoundedChildren>
            </div>
        </section>
    ),
});

const Stack = defineComponent({
    name: "Stack",
    description: "A vertical or horizontal layout for related content.",
    props: z.object({
        children: childrenSchema,
        direction: z.enum(["row", "column"]).optional(),
    }),
    component: ({ props, renderNode }) => (
        <div className={"flex min-w-0 gap-2.5 sm:gap-3 " + (props.direction === "row" ? "flex-row flex-wrap" : "flex-col")}>
            <BoundedChildren renderNode={renderNode}>{props.children}</BoundedChildren>
        </div>
    ),
});

const Text = defineComponent({
    name: "Text",
    description: "A short heading, label, or paragraph.",
    props: z.object({
        value: z.string(),
        variant: z.enum(["body", "heading", "muted"]).default("body"),
    }),
    component: ({ props }) => {
        const className = props.variant === "heading"
            ? "text-md font-semibold text-text-primary"
            : props.variant === "muted"
                ? "text-xs text-text-secondary"
                : "text-sm leading-relaxed text-text-primary";
        return props.variant === "heading"
            ? <h4 className={className}>{props.value}</h4>
            : <p className={className}>{props.value}</p>;
    },
});

const Metric = defineComponent({
    name: "Metric",
    description: "A single key figure with a short label and optional context.",
    props: z.object({
        label: z.string(),
        value: z.string(),
        detail: z.string().optional(),
    }),
    component: ({ props }) => (
        <div className="min-w-32 flex-1">
            <p className="text-xs font-medium text-text-secondary">{props.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-text-primary">{props.value}</p>
            {props.detail ? <p className="mt-1 text-xs leading-relaxed text-text-secondary">{props.detail}</p> : null}
        </div>
    ),
});

const Callout = defineComponent({
    name: "Callout",
    description: "A static note that emphasizes an important point.",
    props: z.object({
        title: z.string(),
        body: z.string(),
        tone: z.enum(["neutral", "positive", "caution"]).default("neutral"),
    }),
    component: ({ props }) => {
        const titleTone = props.tone === "positive"
            ? "text-success"
            : props.tone === "caution"
                ? "text-warning"
                : "text-text-primary";
        return (
            <aside role="note" className="min-w-0">
                <p className={"text-sm font-medium " + titleTone}>{props.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-text-secondary">{props.body}</p>
            </aside>
        );
    },
});

const Progress = defineComponent({
    name: "Progress",
    description: "A labeled progress value from zero to one hundred percent.",
    props: z.object({
        label: z.string(),
        value: z.number().finite(),
        detail: z.string().optional(),
    }),
    component: ({ props }) => {
        const value = Math.max(0, Math.min(100, props.value));
        return (
            <div className="min-w-0">
                <div className="mb-1 flex items-baseline justify-between gap-3">
                    <span className="truncate text-xs font-medium text-text-secondary">{props.label}</span>
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-text-primary">{value}%</span>
                </div>
                <div
                    className="h-2.5 overflow-hidden rounded-full bg-surface-3"
                    role="progressbar"
                    aria-label={props.label}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={value}
                >
                    <div className="h-full rounded-full bg-accent-text" style={{ width: `${value}%` }} />
                </div>
                {props.detail ? <p className="mt-1 text-xs text-text-secondary">{props.detail}</p> : null}
            </div>
        );
    },
});

const BarChart = defineComponent({
    name: "BarChart",
    description: "A simple bar chart for comparing a small number of labeled values.",
    props: z.object({
        labels: z.array(z.string()),
        values: z.array(z.number()),
        title: z.string().optional(),
    }),
    component: ({ props }) => {
        const count = Math.min(props.labels.length, props.values.length, 12);
        const values = props.values.slice(0, count).map((value) => (Number.isFinite(value) ? value : 0));
        const maxMagnitude = Math.max(1, ...values.map((value) => Math.abs(value)));
        const hasNegativeValues = values.some((value) => value < 0);
        const dataLimited = props.labels.length !== props.values.length || props.labels.length > count || props.values.length > count;
        return (
            <figure className="min-w-0">
                {props.title ? <figcaption className="mb-3 text-sm font-medium text-text-primary">{props.title}</figcaption> : null}
                {count === 0 ? (
                    <p className="text-xs text-text-secondary">No chart data was provided.</p>
                ) : (
                    <div aria-hidden="true" className="space-y-2">
                        {props.labels.slice(0, count).map((label, index) => {
                            const value = values[index] ?? 0;
                            const magnitude = Math.min(1, Math.abs(value) / maxMagnitude);
                            const width = `${magnitude * (hasNegativeValues ? 50 : 100)}%`;
                            const left = hasNegativeValues
                                ? value < 0 ? `${50 - magnitude * 50}%` : "50%"
                                : "0%";
                            return (
                                <div key={`${label}-${index}`} className="grid grid-cols-[minmax(5rem,1fr)_3fr_auto] items-center gap-2 text-xs">
                                    <span className="truncate text-text-secondary" title={label}>{label}</span>
                                    <span className="relative h-2.5 overflow-hidden rounded-full bg-surface-3">
                                        <span className={"absolute inset-y-0 w-px bg-border-subtle " + (hasNegativeValues ? "left-1/2" : "left-0")} />
                                        <span
                                            className="absolute inset-y-0 rounded-full bg-accent-text"
                                            style={{ width, left }}
                                        />
                                    </span>
                                    <span className="min-w-8 text-right tabular-nums text-text-primary">{value}</span>
                                </div>
                            );
                        })}
                    </div>
                )}
                {dataLimited ? <p className="mt-2 text-xs text-text-secondary" role="status">Showing the first {count} matching label-value pairs.</p> : null}
                <table className="sr-only">
                    <caption>{props.title || "Bar chart data"}</caption>
                    <thead><tr><th scope="col">Category</th><th scope="col">Value</th></tr></thead>
                    <tbody>{props.labels.slice(0, count).map((label, index) => <tr key={`${label}-${index}`}><th scope="row">{label}</th><td>{values[index] ?? 0}</td></tr>)}</tbody>
                </table>
            </figure>
        );
    },
});

const DataTable = defineComponent({
    name: "DataTable",
    description: "A compact data table. Each row must contain one value for each column.",
    props: z.object({
        columns: z.array(z.string()),
        rows: z.array(z.array(z.string())),
        title: z.string().optional(),
    }),
    component: ({ props }) => {
        const columns = props.columns.slice(0, 8);
        const rows = props.rows.slice(0, 30);
        const truncated = props.columns.length > columns.length || props.rows.length > rows.length;
        return (
            <div className="max-w-full overflow-x-auto">
                {props.title ? <h4 className="mb-2 text-sm font-medium text-text-primary">{props.title}</h4> : null}
                <table className="w-full border-collapse border-y border-border-subtle text-left text-xs">
                    <caption className="sr-only">{props.title || "Generated data table"}</caption>
                    <thead className="bg-surface-3/70 text-text-secondary"><tr>{columns.map((column, index) => <th key={`${column}-${index}`} scope="col" className="break-words px-3 py-2 font-medium">{column}</th>)}</tr></thead>
                    <tbody>{rows.map((row, rowIndex) => (
                        <tr key={rowIndex} className="border-t border-border-subtle text-text-primary">
                            {columns.map((_, columnIndex) => <td key={columnIndex} className="max-w-56 break-words px-3 py-2" title={row[columnIndex] ?? ""}>{row[columnIndex] ?? ""}</td>)}
                        </tr>
                    ))}</tbody>
                </table>
                {columns.length === 0 || rows.length === 0 ? <p className="px-3 py-2 text-xs text-text-secondary">No table data was provided.</p> : null}
                {truncated ? <p className="px-3 py-2 text-xs text-text-secondary" role="status">Showing the first {rows.length} rows and {columns.length} columns.</p> : null}
            </div>
        );
    },
});

const library = createLibrary({
    root: "Surface",
    components: [Surface, Stack, Text, Metric, Callout, Progress, BarChart, DataTable],
});

export function OpenUIBlock({ response, isStreaming, truncated }: { response: string; isStreaming?: boolean; truncated?: boolean }) {
    const [renderError, setRenderError] = useState(false);
    const handleError = useCallback((errors: Array<{ severity?: "warning" }>) => {
        setRenderError(errors.some((error) => !error.severity));
    }, []);

    return (
        <div data-openui-block="true" className="min-w-0 max-w-full">
            <Renderer
                response={response}
                library={library}
                isStreaming={isStreaming}
                publishObservability={false}
                onError={handleError}
            />
            {renderError ? <p className="text-xs text-text-secondary" role="status">This visual response could not be rendered. The surrounding answer is still available.</p> : null}
            {truncated ? <p className="text-xs text-text-secondary" role="status">The visual response was shortened to keep rendering responsive.</p> : null}
        </div>
    );
}
