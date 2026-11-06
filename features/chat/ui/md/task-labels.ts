import type { ExtraProps } from "react-markdown";

/** The hast element type, read through react-markdown because `hast` is not a direct dependency. */
type HastElement = NonNullable<ExtraProps["node"]>;
/** Anything an element holds: elements, text and comments. */
type HastContent = HastElement["children"][number];
/** A tree a rehype plugin walks: the root or any element. */
type HastParent = Pick<HastElement, "children">;

/** Parts of a task item that are not its own words: the checkbox and any nested list. */
const SKIPPED_TAGS = new Set(["input", "ol", "ul"]);

/** The text of a node, leaving out the checkbox and nested lists. */
const ownText = (node: HastContent): string => {
    if (node.type === "text") return node.value;
    if (node.type !== "element" || SKIPPED_TAGS.has(node.tagName)) return "";
    return node.children.map(ownText).join("");
};

/** Whether `node` is a checkbox input. */
const isCheckbox = (node: HastContent): node is HastElement =>
    node.type === "element" && node.tagName === "input" && node.properties.type === "checkbox";

/** Whether `node` is a paragraph, which wraps a loose list item's checkbox and text. */
const isParagraph = (node: HastContent): node is HastElement => node.type === "element" && node.tagName === "p";

/** The task checkbox of a list item: a direct child, or inside the item's paragraph in a loose list. */
const findCheckbox = (item: HastElement): HastElement | undefined =>
    item.children.find(isCheckbox) ?? item.children.find(isParagraph)?.children.find(isCheckbox);

/** Names a task item's checkbox after the item's own text. */
const labelTask = (item: HastElement) => {
    const checkbox = findCheckbox(item);
    const text = item.children.map(ownText).join("").replaceAll(/\s+/g, " ").trim();
    if (checkbox && text) checkbox.properties = { ...checkbox.properties, ariaLabel: text };
};

/** Visits every list item under `node`. */
const labelTasksIn = (node: HastParent) => {
    for (const child of node.children) {
        if (child.type !== "element") continue;
        if (child.tagName === "li") labelTask(child);
        labelTasksIn(child);
    }
};

/**
 * Rehype plugin that names each GFM task checkbox after its task, so a screen reader moving
 * between controls hears which task is done instead of the same word for every box.
 */
export const rehypeTaskLabels = () => (tree: HastParent) => labelTasksIn(tree);
