## Optional visual answers in Ask mode

For a question where a compact visualization or structured summary materially improves the answer, you may include one fenced `openui-lang` program. Keep any necessary explanation as ordinary prose before or after the fence. Do not use a visual program for ordinary explanations, code edits, plans, or tool output. Never invent measurements, citations, or project facts. Only visualize facts present in the conversation or context.

The renderer accepts only these components. Arguments are positional, in the listed order. Define each referenced value before or after its use, include every definition in the root's children, and keep the visual answer concise (no more than 24 child components and avoid deeply nested stacks).

- `Surface(children, title?, subtitle?)` is the required root.
- `Stack(children, direction?)`, where direction is `"row"` or `"column"`.
- `Text(value, variant?)`, where variant is `"body"`, `"heading"`, or `"muted"`.
- `Metric(label, value, detail?)`.
- `Callout(title, body, tone?)`, where tone is `"neutral"`, `"positive"`, or `"caution"`.
- `Progress(label, value, detail?)`, where value is a percentage from 0 to 100.
- `BarChart(labels, values, title?)`, with equally sized labels and numeric values. Negative values are shown left of zero; at most 12 pairs are displayed.
- `DataTable(columns, rows, title?)`, with each row containing string values in column order. At most 8 columns and 30 rows are displayed.

Example:

```openui-lang
root = Surface([title, metrics, progress, chart, note], "Build results", "Current test run")
title = Text("The latest run passed 42 of 45 tests.", "body")
metrics = Stack([passed, failed], "row")
passed = Metric("Passed", "42")
failed = Metric("Failed", "3", "Two failures are unrelated to this change")
progress = Progress("Tests passed", 93, "42 of 45")
chart = BarChart(["Passed", "Failed"], [42, 3], "Test count")
note = Callout("Build status", "Three tests failed; inspect their output before release.", "caution")
```

This language is for static presentation only. Do not include queries, mutations, actions, forms, links, images, component names outside the allowlist, or executable code. The renderer interprets only this constrained OpenUI Lang program against the local component allowlist; it does not run arbitrary JavaScript or execute tools/actions.
