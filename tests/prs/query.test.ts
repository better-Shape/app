import { describe, expect, it } from "vitest";
import { matchPrQuery, parsePrQuery, toGitHubSearchQuery, unevaluableClauses, type PrSearchableItem } from "@/features/chat/ui/prs/query";

const item: PrSearchableItem = { number: 1, title: "Fix tests", status: "open", repo: "owner/repo", labels: [], body: "Hidden description" };

describe("PR search", () => {
    it.each([
        ["draft:true", true, true], ["draft:true", false, false],
        ["draft:false", true, false], ["draft:false", false, true],
        ["-draft:true", true, false], ["-draft:true", false, true],
        ["-draft:false", true, true], ["-draft:false", false, false],
    ])("matches %s against draft=%s", (query, draft, expected) => {
        expect(matchPrQuery({ ...item, draft }, parsePrQuery(query)).matched).toBe(expected);
    });

    it("retains escaped quotes and backslashes inside a qualified phrase", () => {
        const value = 'needs "design" C:\\work';
        const parsed = parsePrQuery(`label:${JSON.stringify(value)} author:alice`);
        expect(parsed.clauses).toEqual([
            { field: "label", value, negated: false },
            { field: "author", value: "alice", negated: false },
        ]);
        expect(toGitHubSearchQuery(parsed)).toBe(`is:pr label:${JSON.stringify(value)} author:alice`);
    });

    it("does not reinterpret quoted negation or colons as qualifiers", () => {
        const query = parsePrQuery('"-literal" "size:XXL"');
        expect(query.terms).toEqual([{ text: "-literal", negated: false }, { text: "size:XXL", negated: false }]);
        expect(toGitHubSearchQuery(query)).toBe('is:pr "-literal" "size:XXL"');
    });

    it("reports body-only matches and applies negation to the body", () => {
        expect(matchPrQuery(item, parsePrQuery("hidden"))).toMatchObject({ matched: true, matchedInBody: true });
        expect(matchPrQuery(item, parsePrQuery("-hidden"))).toMatchObject({ matched: false, matchedInBody: false });
    });

    it("keeps unsupported is values as text, not namespaced labels", () => {
        expect(parsePrQuery("is:typo").terms).toEqual([{ text: "is:typo", negated: false }]);
        expect(parsePrQuery("size:XXL").clauses[0]).toMatchObject({ field: "label", value: "size:XXL" });
    });

    it("reports unanswerable review clauses independent of results", () => {
        expect(unevaluableClauses(parsePrQuery("label:missing review:approved"))).toEqual([
            { field: "review", value: "approved", negated: false },
        ]);
    });
});
