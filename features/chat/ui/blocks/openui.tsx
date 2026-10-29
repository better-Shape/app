"use client";

import "./disable-openui-devtools";
import { createLibrary, defineComponent, Renderer } from "@openuidev/react-lang";
import { z } from "zod/v4";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

const childrenSchema = z.array(z.any()).max(24);
const MAX_OPENUI_NESTING = 16;
const MAX_OPENUI_EXPANDED_NODES = 128;
const MAX_OPENUI_RENDER_COST = 4096;
const OPENUI_COMPONENTS = new Set([
    "Surface", "Stack", "Text", "Metric", "Callout", "Progress", "BarChart", "DataTable",
]);
const OPENUI_COMPONENT_NAMES = Array.from(OPENUI_COMPONENTS).join("|");
const OPENUI_COMPONENT_CALL_PATTERN = new RegExp(String.raw`^(${OPENUI_COMPONENT_NAMES})[ \t]*\(`);
const OpenUINestingContext = createContext(0);

/** Attach occurrence-suffixed stable keys so duplicate rendered values remain distinct. */
const withStableKeys = <T,>(
    items: readonly T[],
    identityOf: (item: T) => string,
): Array<{ item: T; key: string }> => {
    const occurrences = new Map<string, number>();
    return items.map((item) => {
        const identity = identityOf(item);
        const occurrence = occurrences.get(identity) ?? 0;
        occurrences.set(identity, occurrence + 1);
        return { item, key: `${identity}-${occurrence}` };
    });
};


/** Blank a line comment while preserving its newline for top-level assignments. */
const maskLineComment = (source: string, start: number, masked: string[]): number => {
    let index = start;
    while (index < source.length && source[index] !== "\n") {
        masked[index] = " ";
        index += 1;
    }
    return index;
};

/** Classify one character inside a quoted value without mutating scanner state. */
const quotedCharacterAction = (
    character: string,
    quote: "\"" | "'",
    escaped: boolean,
): "continue" | "escape-next" | "close" => {
    if (escaped) return "continue";
    if (character === "\\") return "escape-next";
    return character === quote ? "close" : "continue";
};

/** Blank a quoted value without changing line positions or escaped-quote state. */
const maskQuotedValue = (source: string, start: number, quote: "\"" | "'", masked: string[]): number => {
    let escaped = false;
    let index = start;
    while (index < source.length) {
        const character = source[index] ?? "";
        if (character !== "\n") masked[index] = " ";
        const action = quotedCharacterAction(character, quote, escaped);
        if (action === "close") return index + 1;
        escaped = action === "escape-next";
        index += 1;
    }
    return index;
};

/** Mask one comment or quoted token and return its exclusive end position, if present. */
const maskTokenAt = (source: string, index: number, masked: string[]): number | null => {
    if (source[index] === "/" && source[index + 1] === "/") {
        return maskLineComment(source, index, masked);
    }
    const quote = source[index];
    if (quote === "\"" || quote === "'") {
        return maskQuotedValue(source, index, quote, masked);
    }
    return null;
};

/** Mask literals/comments before counting references, so prose cannot inflate the render budget. */
const maskOpenUIStringsAndComments = (source: string): string => {
    const masked = source.split("");
    for (let index = 0; index < source.length;) {
        const tokenEnd = maskTokenAt(source, index, masked);
        index = tokenEnd ?? index + 1;
    }
    return masked.join("");
};

/** Return the matching array close bracket without counting delimiters inside masked literals. */
const matchingArrayEnd = (source: string, openIndex: number): number => {
    let depth = 0;
    for (let index = openIndex; index < source.length; index += 1) {
        if (source[index] === "[") depth += 1;
        else if (source[index] === "]") {
            depth -= 1;
            if (depth === 0) return index;
        }
    }
    return -1;
};

type OpenUIDefinition = { component?: string; children: string[]; inlineComponents: string[]; unsafe?: boolean };
type OpenUIDefinitions = Map<string, OpenUIDefinition>;

/** Find the first argument boundary without treating nested calls as separators. */
const firstArgumentRange = (source: string, argsStart: number): [number, number] => {
    let arrayDepth = 0;
    let callDepth = 0;
    for (let index = argsStart; index < source.length; index += 1) {
        const character = source[index];
        if (character === "[") arrayDepth += 1;
        else if (character === "]") arrayDepth -= 1;
        else if (character === "(") callDepth += 1;
        else if (character === ")") {
            if (callDepth === 0 && arrayDepth === 0) return [argsStart, index];
            callDepth -= 1;
        } else if (character === "," && arrayDepth === 0 && callDepth === 0) {
            return [argsStart, index];
        }
    }
    return [argsStart, source.length];
};

/** Find a literal child array only when it is the component's first argument. */
const firstChildArrayRange = (source: string, argsStart: number): [number, number] | null => {
    const [argumentStart, argumentEnd] = firstArgumentRange(source, argsStart);
    let arrayStart = argumentStart;
    while (arrayStart < argumentEnd && /\s/.test(source[arrayStart] ?? "")) arrayStart += 1;
    if (source[arrayStart] !== "[") return null;
    const arrayEnd = matchingArrayEnd(source, arrayStart);
    return arrayEnd === -1 || arrayEnd > argumentEnd ? null : [arrayStart, arrayEnd];
};

/** Extract non-component identifiers from a bounded child-array source range. */
const childIdentifiersInRange = (source: string, start: number, end: number): string[] =>
    source.slice(start + 1, end)
        .match(/[A-Za-z_][\w-]*/g)
        ?.filter((identifier) => !OPENUI_COMPONENTS.has(identifier)) ?? [];

/** Count inline component calls as part of their containing definition's expansion cost. */
const inlineComponentsInRange = (source: string, start: number, end: number): string[] => {
    const calls = new RegExp(String.raw`\b(${OPENUI_COMPONENT_NAMES})\s*\(`, "g");
    const components: string[] = [];
    calls.lastIndex = start + 1;
    let match: RegExpExecArray | null;
    while ((match = calls.exec(source)) !== null && match.index < end) {
        if (match[1]) components.push(match[1]);
    }
    return components;
};

/** Record child references and inline calls from a container's first child argument. */
const definitionChildren = (
    source: string,
    component: string,
    argsStart: number,
): Pick<OpenUIDefinition, "children" | "inlineComponents"> | null => {
    if (component !== "Surface" && component !== "Stack") {
        return { children: [], inlineComponents: [] };
    }
    const range = firstChildArrayRange(source, argsStart);
    if (range) {
        return {
            children: childIdentifiersInRange(source, ...range),
            inlineComponents: inlineComponentsInRange(source, ...range),
        };
    }
    const [argumentStart, argumentEnd] = firstArgumentRange(source, argsStart);
    const childName = source.slice(argumentStart, argumentEnd).trim();
    if (!childName) return { children: [], inlineComponents: [] };
    const reference = /^[A-Za-z_][A-Za-z0-9_-]*$/.exec(childName)?.[0];
    return reference ? { children: [reference], inlineComponents: [] } : null;
};

/** Parse component and child-array definitions within the bounded response. */
const parseOpenUIDefinitions = (source: string): OpenUIDefinitions | null => {
    if (/@Each\s*\(/i.test(source)) return null;
    const definitions: OpenUIDefinitions = new Map();
    const assignment = /^[ \t]*([A-Za-z_][A-Za-z0-9_-]*)[ \t]*=[ \t]*/gm;
    let match: RegExpExecArray | null;
    while ((match = assignment.exec(source)) !== null) {
        const name = match[1];
        if (!name) continue;
        const valueStart = assignment.lastIndex;
        const call = OPENUI_COMPONENT_CALL_PATTERN.exec(source.slice(valueStart));
        if (call?.[1]) {
            const component = call[1];
            const argsStart = valueStart + call[0].length;
            const children = definitionChildren(source, component, argsStart);
            if (!children) return null;
            definitions.set(name, { component, ...children });
        } else if (source[valueStart] === "[") {
            const arrayEnd = matchingArrayEnd(source, valueStart);
            if (arrayEnd === -1) return null;
            definitions.set(name, {
                children: childIdentifiersInRange(source, valueStart, arrayEnd),
                inlineComponents: inlineComponentsInRange(source, valueStart, arrayEnd),
            });
        } else {
            const lineEnd = source.indexOf("\n", valueStart);
            const expression = source.slice(valueStart, lineEnd === -1 ? source.length : lineEnd);
            if (expression.includes("(")) {
                definitions.set(name, { children: [], inlineComponents: [], unsafe: true });
            }
        }
        if (definitions.size > MAX_OPENUI_EXPANDED_NODES) return null;
    }
    return definitions;
};

/** Estimate each allowlisted component's maximum bounded DOM fan-out. */
const componentRenderCost = (component: string): number => {
    if (component === "DataTable") return 300; // 30 rows × 8 cells, headings and table structure.
    if (component === "BarChart") return 128; // 12 bars plus the accessible data table.
    if (component === "Surface" || component === "Stack") return 2;
    return 8;
};

type OpenUIWorkBudget = { nodes: number; renderCost: number };

/** Return the rejection sentinel used for cycles, excessive depth, and either work limit. */
const rejectedExpansionCount = (): number => MAX_OPENUI_EXPANDED_NODES + 1;

/** Reserve one definition's own and inline component work against both limits. */
const reserveDefinitionBudget = (
    definition: OpenUIDefinition | undefined,
    budget: OpenUIWorkBudget,
): boolean => {
    const nodes = definition
        ? Number(Boolean(definition.component)) + definition.inlineComponents.length
        : 1;
    const renderCost = definition
        ? (definition.component ? componentRenderCost(definition.component) : 0)
            + definition.inlineComponents.reduce((total, component) => total + componentRenderCost(component), 0)
        : 1;
    if (budget.nodes < nodes || budget.renderCost < renderCost) return false;
    budget.nodes -= nodes;
    budget.renderCost -= renderCost;
    return true;
};

/** Count a referenced definition while reserving component and estimated DOM work. */
const countDefinitionTree = (
    definitions: OpenUIDefinitions,
    name: string,
    depth: number,
    budget: OpenUIWorkBudget,
    ancestors: Set<string>,
): number => {
    if (ancestors.has(name)) return rejectedExpansionCount();
    const definition = definitions.get(name);
    if (definition?.unsafe || !reserveDefinitionBudget(definition, budget)) return rejectedExpansionCount();
    if (!definition) return 1;

    let total = Number(Boolean(definition.component)) + definition.inlineComponents.length;
    if (definition.component && definition.children.length > 0 && depth >= MAX_OPENUI_NESTING) {
        return rejectedExpansionCount();
    }
    if (definition.children.length === 0) return total;

    ancestors.add(name);
    const childDepth = depth + Number(Boolean(definition.component));
    for (const child of definition.children) {
        const expandedChildCount = countDefinitionTree(definitions, child, childDepth, budget, ancestors);
        if (expandedChildCount > MAX_OPENUI_EXPANDED_NODES) return expandedChildCount;
        total += expandedChildCount;
    }
    ancestors.delete(name);
    return total;
};

/** Count repeated child references as expanded work, not just unique definitions. */
const countExpandedNodes = (response: string): number => {
    const definitions = parseOpenUIDefinitions(maskOpenUIStringsAndComments(response));
    if (!definitions) return MAX_OPENUI_EXPANDED_NODES + 1;
    if (!definitions.has("root")) return 0;
    return countDefinitionTree(
        definitions,
        "root",
        0,
        { nodes: MAX_OPENUI_EXPANDED_NODES, renderCost: MAX_OPENUI_RENDER_COST },
        new Set(),
    );
};

type BoundedChildrenProps = {
    children: unknown;
    renderNode: (value: unknown) => ReactNode;
};

/** Apply the depth context before the language renderer recursively materializes children. */
const BoundedChildren = ({ children, renderNode }: BoundedChildrenProps) => {
    const depth = useContext(OpenUINestingContext);
    if (depth >= MAX_OPENUI_NESTING) {
        return <p className="text-xs text-text-secondary" role="status">This visual response is nested too deeply to display.</p>;
    }
    return (
        <OpenUINestingContext.Provider value={depth + 1}>
            {renderNode(children)}
        </OpenUINestingContext.Provider>
    );
};

/** Render an optional title inside the surface heading. */
const SurfaceTitle = ({ title }: { title?: string }) => title
    ? <h3 className="text-md font-semibold text-text-primary">{title}</h3>
    : null;

/** Render an optional subtitle with spacing that follows the title naturally. */
const SurfaceSubtitle = ({ title, subtitle }: { title?: string; subtitle?: string }) => subtitle
    ? <p className={`${title ? "mt-1 " : ""}text-xs leading-relaxed text-text-secondary`}>{subtitle}</p>
    : null;

/** Render optional surface heading content without adding wrapper logic to the host component. */
const SurfaceHeader = ({ title, subtitle }: { title?: string; subtitle?: string }) =>
    title || subtitle ? (
        <header className="min-w-0">
            <SurfaceTitle title={title} />
            <SurfaceSubtitle title={title} subtitle={subtitle} />
        </header>
    ) : null;

const Surface = defineComponent({
    name: "Surface",
    description: "The required top-level container for one visual answer.",
    props: z.object({
        children: childrenSchema,
        title: z.string().optional(),
        subtitle: z.string().optional(),
    }),
    component: ({ props, renderNode }) => {
        const hasHeader = Boolean(props.title || props.subtitle);
        return (
            <section className="my-3 w-full rounded-xl border border-border-subtle bg-surface-2 p-3">
                <SurfaceHeader title={props.title} subtitle={props.subtitle} />
                <div className={hasHeader ? "mt-3" : ""}>
                    <BoundedChildren renderNode={renderNode}>{props.children}</BoundedChildren>
                </div>
            </section>
        );
    },
});

const Stack = defineComponent({
    name: "Stack",
    description: "A vertical or horizontal layout for related content.",
    props: z.object({
        children: childrenSchema,
        direction: z.enum(["row", "column"]).optional(),
    }),
    component: ({ props, renderNode }) => (
        <div className={`flex min-w-0 gap-2.5 sm:gap-3 ${props.direction === "row" ? "flex-row flex-wrap" : "flex-col"}`}>
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
                <p className={`text-sm font-medium ${titleTone}`}>{props.title}</p>
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

type BarChartPoint = { label: string; value: number };
type KeyedBarChartPoint = { item: BarChartPoint; key: string };
type BarChartData = {
    count: number;
    maxMagnitude: number;
    hasNegativeValues: boolean;
    dataLimited: boolean;
    points: KeyedBarChartPoint[];
};

/** Normalize chart data and cap the amount of work the visual renderer emits. */
const buildBarChartData = (labels: string[], rawValues: number[]): BarChartData => {
    const count = Math.min(labels.length, rawValues.length, 12);
    const values = rawValues.slice(0, count).map((value) => Number.isFinite(value) ? value : 0);
    const points = labels.slice(0, count).map((label, index) => ({ label, value: values[index] ?? 0 }));
    return {
        count,
        maxMagnitude: Math.max(1, ...values.map((value) => Math.abs(value))),
        hasNegativeValues: values.some((value) => value < 0),
        dataLimited: labels.length !== rawValues.length || labels.length > count || rawValues.length > count,
        points: withStableKeys(points, (point) => JSON.stringify([point.label, point.value])),
    };
};

type BarChartRowsProps = Pick<BarChartData, "points" | "maxMagnitude" | "hasNegativeValues">;

/** Render accessible chart bars with stable keys and bounded labels. */
const BarChartRows = ({ points, maxMagnitude, hasNegativeValues }: BarChartRowsProps) => (
    <div aria-hidden="true" className="space-y-2">
        {points.map(({ item: { label, value }, key }) => {
            const magnitude = Math.min(1, Math.abs(value) / maxMagnitude);
            const width = `${magnitude * (hasNegativeValues ? 50 : 100)}%`;
            const left = hasNegativeValues
                ? value < 0 ? `${50 - magnitude * 50}%` : "50%"
                : "0%";
            return (
                <div key={key} className="grid grid-cols-[minmax(5rem,1fr)_3fr_auto] items-center gap-2 text-xs">
                    <span className="truncate text-text-secondary" title={label}>{label}</span>
                    <span className="relative h-2.5 overflow-hidden rounded-full bg-surface-3">
                        <span className={`absolute inset-y-0 w-px bg-border-subtle ${hasNegativeValues ? "left-1/2" : "left-0"}`} />
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
);

/** Provide screen-reader table rows for the chart's plotted values. */
const BarChartAccessibleRows = ({ points }: { points: KeyedBarChartPoint[] }) => (
    <tbody>
        {points.map(({ item: { label, value }, key }) => (
            <tr key={key}><th scope="row">{label}</th><td>{value}</td></tr>
        ))}
    </tbody>
);

/** Expose chart data in a semantic table for assistive technology. */
const BarChartAccessibleTable = ({ title, points }: { title?: string; points: KeyedBarChartPoint[] }) => (
    <table className="sr-only">
        <caption>{title || "Bar chart data"}</caption>
        <thead><tr><th scope="col">Category</th><th scope="col">Value</th></tr></thead>
        <BarChartAccessibleRows points={points} />
    </table>
);

/** Keep the visual chart caption inside its figure while avoiding extra render branching. */
const BarChartTitle = ({ title }: { title?: string }) => title
    ? <figcaption className="mb-3 text-sm font-medium text-text-primary">{title}</figcaption>
    : null;

/** Render either the bounded visual bars or a concise empty-data message. */
const BarChartContents = ({ chart }: { chart: BarChartData }) => chart.count === 0
    ? <p className="text-xs text-text-secondary">No chart data was provided.</p>
    : <BarChartRows
        points={chart.points}
        maxMagnitude={chart.maxMagnitude}
        hasNegativeValues={chart.hasNegativeValues}
    />;

/** Announce chart truncation when displayed values were capped for safety. */
const BarChartLimitNotice = ({ chart }: { chart: BarChartData }) => chart.dataLimited
    ? <p className="mt-2 text-xs text-text-secondary" role="status">Showing the first {chart.count} matching label-value pairs.</p>
    : null;

type BarChartComponentProps = { labels: string[]; values: number[]; title?: string };

/** Adapt OpenUI chart props to the bounded visual and accessible chart views. */
const renderBarChart = ({ props }: { props: BarChartComponentProps }) => {
    const chart = buildBarChartData(props.labels, props.values);
    return (
        <>
            <figure className="min-w-0">
                <BarChartTitle title={props.title} />
                <BarChartContents chart={chart} />
                <BarChartLimitNotice chart={chart} />
            </figure>
            <BarChartAccessibleTable title={props.title} points={chart.points} />
        </>
    );
};

const BarChart = defineComponent({
    name: "BarChart",
    description: "A simple bar chart for comparing a small number of labeled values.",
    props: z.object({
        labels: z.array(z.string()),
        values: z.array(z.number()),
        title: z.string().optional(),
    }),
    component: renderBarChart,
});

type KeyedDataTableColumn = { item: string; key: string };
type KeyedDataTableCell = { value: string; key: string };
type KeyedDataTableRow = { item: KeyedDataTableCell[]; key: string };
type DataTableData = {
    columns: KeyedDataTableColumn[];
    rows: KeyedDataTableRow[];
    empty: boolean;
    truncated: boolean;
};

/** Prepare stable row and column identities while enforcing table display limits. */
const buildDataTableData = (rawColumns: string[], rawRows: string[][]): DataTableData => {
    const columns = withStableKeys(rawColumns.slice(0, 8), (column) => column);
    const rows = withStableKeys(rawRows.slice(0, 30), (row) => JSON.stringify(row));
    return {
        columns,
        rows: rows.map(({ item: values, key }) => {
            const remainingValues = values[Symbol.iterator]();
            const cells = columns.map(({ key: columnKey }) => ({
                key: columnKey,
                value: remainingValues.next().value ?? "",
            }));
            return { item: cells, key };
        }),
        empty: columns.length === 0 || rows.length === 0,
        truncated: rawColumns.length > columns.length || rawRows.length > rows.length,
    };
};

/** Render column headings separately to keep the table tree shallow and accessible. */
const DataTableHead = ({ columns }: Pick<DataTableData, "columns">) => (
    <thead className="bg-surface-3/70 text-text-secondary">
        <tr>
            {columns.map(({ item: column, key }) => (
                <th key={key} scope="col" className="break-words px-3 py-2 font-medium">{column}</th>
            ))}
        </tr>
    </thead>
);

/** Render bounded table rows with per-cell stable keys. */
const DataTableRows = ({ rows }: Pick<DataTableData, "rows">) => (
    <tbody>
        {rows.map(({ item: row, key: rowKey }) => (
            <tr key={rowKey} className="border-t border-border-subtle text-text-primary">
                {row.map(({ value, key }) => (
                    <td key={key} className="max-w-56 break-words px-3 py-2" title={value}>
                        {value}
                    </td>
                ))}
            </tr>
        ))}
    </tbody>
);

/** Explain an empty table without adding conditional markup to the table component. */
const DataTableEmptyState = ({ empty }: { empty: boolean }) => empty
    ? <p className="px-3 py-2 text-xs text-text-secondary">No table data was provided.</p>
    : null;

/** Explain when source rows or columns exceed the display budget. */
const DataTableLimitNotice = ({ table }: { table: DataTableData }) => table.truncated
    ? <p className="px-3 py-2 text-xs text-text-secondary" role="status">Showing the first {table.rows.length} rows and {table.columns.length} columns.</p>
    : null;

/** Render a table title only when the generated surface supplied one. */
const DataTableTitle = ({ title }: { title?: string }) => title
    ? <h4 className="mb-2 text-sm font-medium text-text-primary">{title}</h4>
    : null;

/** Give the data table a useful accessible caption when no title was provided. */
const DataTableCaption = ({ title }: { title?: string }) => (
    <caption className="sr-only">{title || "Generated data table"}</caption>
);

/** Render the compact table component while delegating row details to focused helpers. */
type DataTableComponentProps = { columns: string[]; rows: string[][]; title?: string };

/** Adapt OpenUI table props to the bounded, accessible data-table view. */
const renderDataTable = ({ props }: { props: DataTableComponentProps }) => {
    const table = buildDataTableData(props.columns, props.rows);
    return (
        <div className="max-w-full overflow-x-auto">
            <DataTableTitle title={props.title} />
            <table className="w-full border-collapse border-y border-border-subtle text-left text-xs">
                <DataTableCaption title={props.title} />
                <DataTableHead columns={table.columns} />
                <DataTableRows rows={table.rows} />
            </table>
            <DataTableEmptyState empty={table.empty} />
            <DataTableLimitNotice table={table} />
        </div>
    );
};

const DataTable = defineComponent({
    name: "DataTable",
    description: "A compact data table. Each row must contain one value for each column.",
    props: z.object({
        columns: z.array(z.string()),
        rows: z.array(z.array(z.string())),
        title: z.string().optional(),
    }),
    component: renderDataTable,
});

const library = createLibrary({
    root: "Surface",
    components: [Surface, Stack, Text, Metric, Callout, Progress, BarChart, DataTable],
});

type OpenUIResponseProps = {
    response: string;
    isStreaming?: boolean;
    exceedsWorkBudget: boolean;
    onError: (errors: Array<{ severity?: "warning" }>) => void;
};

/** Render only bounded output; over-budget source never reaches the language renderer. */
const OpenUIResponse = ({ response, isStreaming, exceedsWorkBudget, onError }: OpenUIResponseProps) => {
    if (exceedsWorkBudget) {
        return (
            <p className="text-xs text-text-secondary" role="status">
                This visual response is too complex to display safely. The surrounding answer is still available.
            </p>
        );
    }
    return (
        <Renderer
            response={response}
            library={library}
            isStreaming={isStreaming}
            publishObservability={false}
            onError={onError}
        />
    );
};

/** Display renderer and truncation notices as independent accessible status messages. */
const OpenUIStatusMessages = ({ renderError, truncated }: { renderError: boolean; truncated?: boolean }) => (
    <>
        {renderError ? <p className="text-xs text-text-secondary" role="status">This visual response could not be rendered. The surrounding answer is still available.</p> : null}
        {truncated ? <p className="text-xs text-text-secondary" role="status">The visual response was shortened to keep rendering responsive.</p> : null}
    </>
);

/** Check expanded work before invoking the DSL renderer, then expose only a safe fallback on failure. */
export const OpenUIBlock = ({ response, isStreaming, truncated }: { response: string; isStreaming?: boolean; truncated?: boolean }) => {
    const [renderErrorResponse, setRenderErrorResponse] = useState<string | null>(null);
    const exceedsWorkBudget = countExpandedNodes(response) > MAX_OPENUI_EXPANDED_NODES;
    const handleError = useCallback((errors: Array<{ severity?: "warning" }>) => {
        setRenderErrorResponse(errors.some((error) => !error.severity) ? response : null);
    }, [response]);
    const renderError = renderErrorResponse === response;

    return (
        <div data-openui-block="true" className="min-w-0 max-w-full">
            <OpenUIResponse
                response={response}
                isStreaming={isStreaming}
                exceedsWorkBudget={exceedsWorkBudget}
                onError={handleError}
            />
            <OpenUIStatusMessages renderError={renderError} truncated={truncated} />
        </div>
    );
};
