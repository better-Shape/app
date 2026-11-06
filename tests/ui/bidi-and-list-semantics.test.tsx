import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Breadcrumb, BreadcrumbItem } from "@/components/ui/breadcrumb";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatMarkdown } from "@/features/chat/ui/md/view";
import { ChatMessageItem } from "@/features/chat/ui/message/item";

vi.mock("mermaid", () => ({ default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: "" })) } }));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
});

describe("chat markdown text direction", () => {
    it("lets each block take its direction from its own first strong character", async () => {
        await act(async () => {
            root.render(
                <ChatMarkdown
                    content={"مرحبا بالعالم\n\n- عنصر\n- פריט\n\n> اقتباس\n\n## عنوان\n\n#### عنوان فرعي\n\n| الاسم | الحالة |\n| --- | --- |\n| واجهة | جاهز |"}
                />,
            );
        });
        for (const selector of ["p", "ul", "blockquote", "h2", "h4", "table"]) {
            expect(host.querySelector(selector)?.getAttribute("dir"), selector).toBe("auto");
        }
        // Physical left-side spacing would not mirror for right-to-left blocks.
        expect(host.querySelector("blockquote")?.className).toMatch(/\bborder-s-2\b/);
        expect(host.querySelector("blockquote")?.className).not.toMatch(/\bborder-l-2\b/);
        expect(host.querySelector("ul")?.className).toMatch(/\bms-4\b/);
        expect(host.querySelector("table")?.className).toMatch(/\btext-start\b/);
    });

    it("lets nested blocks inherit their container's direction and keeps code left to right", async () => {
        await act(async () => {
            root.render(
                <ChatMarkdown
                    content={[
                        "1. خطوة أولى",
                        "",
                        "2. خطوة ثانية مع `fn()`",
                        "",
                        "   ```ts",
                        "   const x = foo();",
                        "   ```",
                        "",
                        "> اقتباس",
                        ">",
                        "> سطر ثان",
                        ">",
                        "> ##### عنوان داخلي",
                        "",
                        "| الاسم | الحالة |",
                        "| --- | --- |",
                        "| `run()` | جاهز |",
                        "",
                        "```",
                        "plain(a, b);",
                        "next();",
                        "```",
                    ].join("\n")}
                />,
            );
        });
        // A nested dir would hide the item and quote text from the container's own auto
        // direction, so a right-to-left loose list would resolve left to right.
        expect(host.querySelector("ol")?.getAttribute("dir")).toBe("auto");
        const nested = [...host.querySelectorAll("ol p, blockquote p")];
        expect(nested).toHaveLength(4);
        expect(nested.filter((p) => p.hasAttribute("dir"))).toEqual([]);
        expect(host.querySelector("blockquote h5")?.hasAttribute("dir")).toBe(false);
        // Code never takes or decides the prose direction: inline code, a labelled fence, and an
        // unlabelled fence each sit under dir="ltr".
        const innermostWith = (text: string) =>
            [...host.querySelectorAll<HTMLElement>("*")].findLast((el) => el.textContent?.includes(text));
        for (const text of ["fn()", "run()", "const x = foo();", "plain(a, b);"]) {
            expect(innermostWith(text)?.closest('[dir="ltr"]'), text).not.toBeNull();
        }
        // The user agent centres a header cell whose row inherits the initial alignment.
        expect(host.querySelector("th")?.className).toMatch(/\btext-start\b/);
    });

    it("keeps the number an ordered list resumes from", async () => {
        await act(async () => {
            root.render(<ChatMarkdown content={"1. Install\n\n```bash\nnpm install\n```\n\n2. Run\n3. Ship"} />);
        });
        const lists = [...host.querySelectorAll("ol")];
        expect(lists.map((list) => list.getAttribute("start"))).toEqual([null, "2"]);
        expect(lists[1]?.textContent).toContain("Run");
    });

    it("names each read-only task checkbox after its own task", async () => {
        await act(async () => {
            root.render(<ChatMarkdown content={"- [x] done\n- [ ] open"} />);
        });
        const boxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
        expect(boxes).toHaveLength(2);
        expect(boxes.map((box) => box.getAttribute("aria-label"))).toEqual(["done", "open"]);
        expect(boxes.map((box) => box.checked)).toEqual([true, false]);
    });

    it("names task checkboxes in loose and nested lists without borrowing nested text", async () => {
        await act(async () => {
            root.render(<ChatMarkdown content={"- [x] write the plan\n\n- [ ] ship it\n  - [ ] nested step"} />);
        });
        const boxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
        expect(boxes.map((box) => box.getAttribute("aria-label"))).toEqual(["write the plan", "ship it", "nested step"]);
    });
});

describe("sent message text direction", () => {
    it("keeps code, paths and mention chips out of the message's automatic direction", async () => {
        await act(async () => {
            root.render(
                <TooltipProvider>
                    <ChatMessageItem role="user" content={"`foo()` @app.tsx src/main.ts مرحبا"} timestamp={1700000000000} />
                </TooltipProvider>,
            );
        });
        // `dir="auto"` skips descendants with their own `dir`, so the Arabic prose decides it.
        expect(host.querySelector("code")?.closest("[dir]")?.getAttribute("dir")).toBe("ltr");
        expect(host.querySelector("code")?.parentElement?.closest('[dir="auto"]')).not.toBeNull();
        const tokens = [...host.querySelectorAll("button[data-chat-find-text]")];
        expect(tokens.map((token) => token.textContent)).toEqual(["@app.tsx", "src/main.ts"]);
        expect(tokens.map((token) => token.getAttribute("dir"))).toEqual(["ltr", "ltr"]);
    });
});

describe("breadcrumb list structure", () => {
    it("keeps separators as hidden list items so the list owns only <li>", () => {
        act(() =>
            root.render(
                <Breadcrumb>
                    <BreadcrumbItem>bettershape-demo</BreadcrumbItem>
                    <BreadcrumbItem current>Preview fixture chat</BreadcrumbItem>
                </Breadcrumb>,
            ),
        );
        const children = [...(host.querySelector("ol")?.children ?? [])];
        expect(children.map((child) => child.tagName)).toEqual(["LI", "LI", "LI"]);
        expect(children[1].getAttribute("aria-hidden")).toBe("true");
        expect(children[1].getAttribute("role")).toBe("presentation");
    });
});
