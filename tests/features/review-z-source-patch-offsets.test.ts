import { locateJsx, patchHtmlOpening } from "@/features/preview/design/jsx-source";

/**
 * `locateJsx` and the native resolver both report UTF-8 byte offsets, because the
 * Rust side slices `&str` by bytes. `patchHtmlOpening` is the one consumer that
 * slices a JavaScript string, so it has to translate those bytes first. The
 * fixtures put multi-byte text far enough in front of the element that a raw byte
 * offset lands on a different part of the tag.
 */
describe("review z: html patch ranges arrive as UTF-8 byte offsets", () => {
    function page(prefix: string, body: string) {
        return `${prefix}export default function Page() {\n  return ${body};\n}\n`;
    }

    function patchAstroOpening(source: string, tag: string, classes: string[], styles: Record<string, string>) {
        const hit = locateJsx(source, { tag, classes });
        expect(hit).not.toBeNull();
        return patchHtmlOpening(source, hit!.openingStart, hit!.openingEnd, styles);
    }

    it("merges into the class attribute after a Japanese label", () => {
        const source = page('const label = "日本語です";\n', '<a class="hero">Start</a>');
        const next = patchAstroOpening(source, "a", ["hero"], { display: "flex" });
        expect(next).toBe(source.replace('class="hero"', 'class="hero flex"'));
    });

    it("merges into the class attribute after emoji, which are surrogate pairs", () => {
        const source = page('const emoji = "\u{1F30D}\u{1F600}";\n', '<a class="hero">Start</a>');
        const next = patchAstroOpening(source, "a", ["hero"], { display: "flex" });
        expect(next).toBe(source.replace('class="hero"', 'class="hero flex"'));
    });

    it("adds a class attribute to a tag that has none, after accented text", () => {
        const source = page('const label = "日本語です";\n', "<section>Hi</section>");
        const next = patchAstroOpening(source, "section", [], { display: "flex" });
        expect(next).toBe(source.replace("<section>", '<section class="flex">'));
    });

    it("still refuses a class:list opening once the bytes are translated", () => {
        const source = page('const label = "日本語です";\n', '<section class:list={["hero"]}>Hi</section>');
        expect(() => patchAstroOpening(source, "section", ["hero"], { display: "flex" })).toThrow(
            /dynamic class/,
        );
    });

    it("leaves the file alone when the byte range runs past the end of the source", () => {
        const source = page('const label = "日本語です";\n', '<a class="hero">Start</a>');
        const hit = locateJsx(source, { tag: "a", classes: ["hero"] })!;
        expect(patchHtmlOpening(source, hit.openingStart, hit.openingEnd + 4096, { display: "flex" })).toBe(source);
    });

    it("still patches an all-ASCII source unchanged", () => {
        const source = page("", '<a class="hero">Start</a>');
        const next = patchAstroOpening(source, "a", ["hero"], { display: "flex" });
        expect(next).toBe(source.replace('class="hero"', 'class="hero flex"'));
    });
});