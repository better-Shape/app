import { test, expect, expectPreviewActive, gotoRoute } from "./fixtures";
import { streamAssistantMarkdown } from "./helpers/chat-stream";

test.use({ seedMode: "project" });

/**
 * Layout facts only a browser computes: bidi ordering, resolved direction, header alignment
 * and the focus ring of a scrolling table. Each reply streams into the seeded conversation.
 */
test.describe("chat reply direction and tables", () => {
    test.beforeEach(async ({ page }) => {
        await gotoRoute(page, "/");
        await expectPreviewActive(page, "project");
        await expect(page.locator("[data-openui-block]").first()).toBeVisible({ timeout: 30_000 });
    });

    test.afterEach(({ expectNoPageErrors, expectNoConsoleErrors }) => {
        expectNoPageErrors();
        expectNoConsoleErrors();
    });

    test("a right-to-left reply mirrors its blocks and keeps code left to right", async ({ page }) => {
        await streamAssistantMarkdown(
            page,
            [
                "1. خطوة أولى",
                "",
                "2. خطوة ثانية:",
                "",
                "   ```ts",
                "   const x = foo();",
                "   ```",
                "",
                "> اقتباس مع `bar()` هنا",
                "",
                "| الاسم | الحالة |",
                "| --- | --- |",
                "| `fn()` | جاهز |",
            ].join("\n"),
        );
        // The reply is revealed as it streams, so wait for its last text, the table's inline code,
        // before reading the layout once.
        const table = page.locator("table").filter({ hasText: "الاسم" });
        await expect(table.locator("code", { hasText: "fn()" })).toBeVisible();

        const layout = await page.evaluate(() => {
            /** Left edge of the first occurrence of `char` inside `root`. */
            const charX = (root: Element, char: string) => {
                const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
                for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                    const at = node.textContent?.indexOf(char) ?? -1;
                    if (at < 0) continue;
                    const range = document.createRange();
                    range.setStart(node, at);
                    range.setEnd(node, at + 1);
                    return range.getBoundingClientRect().left;
                }
                return Number.NaN;
            };
            /** The first element matching `selector` that contains `text`; the test fails without one. */
            const byText = (selector: string, text: string): Element => {
                const match = [...document.querySelectorAll(selector)].find((el) => el.textContent?.includes(text));
                if (!match) throw new Error(`no ${selector} contains ${text}`);
                return match;
            };
            const inline = byText("code", "fn()");
            const block = byText("pre, code", "const x = foo();");
            const list = byText("ol", "خطوة ثانية");
            const quote = byText("blockquote", "اقتباس");
            return {
                inlineInOrder: charX(inline, "f") < charX(inline, ")"),
                blockInOrder: charX(block, "c") < charX(block, ";"),
                listDirection: getComputedStyle(list).direction,
                // The marker gutter is on the start side: right-to-left markers hang in it, unclipped.
                listGutterOnRight: Number.parseFloat(getComputedStyle(list).paddingRight) > 0,
                quoteDirection: getComputedStyle(quote).direction,
                quoteRuleRight: getComputedStyle(quote).borderRightWidth,
            };
        });
        expect(layout).toEqual({
            inlineInOrder: true,
            blockInOrder: true,
            listDirection: "rtl",
            listGutterOnRight: true,
            quoteDirection: "rtl",
            quoteRuleRight: "2px",
        });
    });

    test("numbered steps split by a code block keep counting", async ({ page }) => {
        await streamAssistantMarkdown(page, "1. Install it\n\n```bash\nnpm install\n```\n\n2. Run it\n\n3. Ship it");
        const run = page.locator("ol").filter({ hasText: "Run it" });
        await expect(run).toBeVisible();
        await expect(run).toHaveJSProperty("start", 2);
    });

    test("a wide table keeps headers aligned to the start and shows its focus ring", async ({ page }) => {
        const columns = ["Name", "Status", "Owner", "Notes", "A long extra column", "Another", "More", "Even more"];
        await streamAssistantMarkdown(
            page,
            [
                `| ${columns.join(" | ")} |`,
                `| ${columns.map(() => "---").join(" | ")} |`,
                `| Composer | Ready | Ada | ${"Works in every case we tried ".repeat(3)} | x | y | z | w |`,
            ].join("\n"),
        );
        const scroller = page.getByRole("group", { name: "Scrollable table" }).last();
        await expect(scroller).toBeVisible();
        await expect(scroller.locator("th").first()).toHaveCSS("text-align", "start");

        // Keyboard modality, so programmatic focus matches :focus-visible as a Tab would.
        await page.keyboard.press("Shift");
        await scroller.focus();
        // The ring is drawn inside the scroller: the table's rounded frame clips anything outside.
        await expect(scroller).toHaveCSS("outline-style", "solid");
        await expect(scroller).toHaveCSS("outline-width", "2px");
        await expect(scroller).toHaveCSS("outline-offset", "-2px");
    });
});
