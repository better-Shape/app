import { describe, expect, it } from "vitest";
import {
    matchPrQuery,
    parsePrQuery,
    prQueryIsEmpty,
    unevaluableClauses,
    type PrSearchableItem,
} from "@/features/chat/ui/prs/query";

function item(over: Partial<PrSearchableItem> = {}): PrSearchableItem {
    return {
        number: 1,
        title: "Fix the thing",
        status: "open",
        draft: false,
        author: "alice",
        repo: "o/r",
        labels: [{ name: "bug" }],
        ...over,
    };
}

describe("parsePrQuery — clauses", () => {
    it("reads a plain label qualifier", () => {
        expect(parsePrQuery("label:bug").clauses).toEqual([
            { field: "label", value: "bug", negated: false },
        ]);
    });

    it("reads a negated label qualifier", () => {
        expect(parsePrQuery("-label:wip").clauses).toEqual([
            { field: "label", value: "wip", negated: true },
        ]);
    });

    it("keeps a quoted label value whole", () => {
        expect(parsePrQuery('label:"needs design"').clauses).toEqual([
            { field: "label", value: "needs design", negated: false },
        ]);
    });

    it("accepts the plural spelling", () => {
        expect(parsePrQuery("labels:bug").clauses).toEqual([
            { field: "label", value: "bug", negated: false },
        ]);
    });

    it("treats an unrecognised key as a namespaced label rather than a typo", () => {
        expect(parsePrQuery("size:XXL").clauses).toEqual([
            { field: "label", value: "size:XXL", negated: false },
        ]);
    });

    it("namespaces a negated unknown key too", () => {
        expect(parsePrQuery("-size:XXL").clauses).toEqual([
            { field: "label", value: "size:XXL", negated: true },
        ]);
    });

    it("degrades an invalid enum value to free text instead of matching nothing", () => {
        const parsed = parsePrQuery("draft:maybe");
        expect(parsed.clauses).toEqual([]);
        expect(parsed.terms).toEqual([{ text: "draft:maybe", negated: false }]);
    });

    it("maps is: onto the field it really means", () => {
        expect(parsePrQuery("is:draft").clauses).toEqual([
            { field: "draft", value: "true", negated: false },
        ]);
        expect(parsePrQuery("is:merged").clauses).toEqual([
            { field: "status", value: "merged", negated: false },
        ]);
    });

    it("normalises a review alias", () => {
        expect(parsePrQuery("review:approved").clauses).toEqual([
            { field: "review", value: "approved", negated: false },
        ]);
        expect(parsePrQuery("review:changes-requested").clauses).toEqual([
            { field: "review", value: "changes-requested", negated: false },
        ]);
    });

    it("drops an unknown review alias to free text", () => {
        expect(parsePrQuery("review:bananas").clauses).toEqual([]);
        expect(parsePrQuery("review:bananas").terms).toHaveLength(1);
    });

    it("separates bare terms from clauses", () => {
        const parsed = parsePrQuery("label:bug crash -regression");
        expect(parsed.clauses).toEqual([{ field: "label", value: "bug", negated: false }]);
        expect(parsed.terms).toEqual([
            { text: "crash", negated: false },
            { text: "regression", negated: true },
        ]);
    });

    it("reports an all-whitespace query as empty", () => {
        expect(prQueryIsEmpty(parsePrQuery("   "))).toBe(true);
        expect(prQueryIsEmpty(parsePrQuery("label:bug"))).toBe(false);
    });

    it("does not treat a bare dash as a negation", () => {
        expect(parsePrQuery("-").terms).toEqual([{ text: "-", negated: false }]);
    });
});

describe("matchPrQuery — clauses", () => {
    it("matches a label case-insensitively", () => {
        expect(matchPrQuery(item(), parsePrQuery("label:BUG")).matched).toBe(true);
        expect(matchPrQuery(item(), parsePrQuery("label:enhancement")).matched).toBe(false);
    });

    it("inverts a negated label", () => {
        expect(matchPrQuery(item(), parsePrQuery("-label:bug")).matched).toBe(false);
        expect(
            matchPrQuery(item({ labels: [{ name: "chore" }] }), parsePrQuery("-label:bug")).matched,
        ).toBe(true);
    });

    it("matches a namespaced label against the full colon form", () => {
        expect(matchPrQuery(item({ labels: [{ name: "size:XXL" }] }), parsePrQuery("size:XXL")).matched).toBe(true);
        expect(matchPrQuery(item(), parsePrQuery("size:XXL")).matched).toBe(false);
    });

    it("matches on status and ignores status:all", () => {
        expect(matchPrQuery(item({ status: "open" }), parsePrQuery("status:open")).matched).toBe(true);
        expect(matchPrQuery(item({ status: "merged" }), parsePrQuery("status:open")).matched).toBe(false);
        expect(matchPrQuery(item({ status: "merged" }), parsePrQuery("status:all")).matched).toBe(true);
    });

    it("matches draft:true against a draft row only", () => {
        expect(matchPrQuery(item({ draft: true }), parsePrQuery("draft:true")).matched).toBe(true);
        expect(matchPrQuery(item({ draft: false }), parsePrQuery("draft:true")).matched).toBe(false);
        expect(matchPrQuery(item({ draft: false }), parsePrQuery("draft:false")).matched).toBe(true);
    });

    it("reports a review clause as unevaluated instead of matching or rejecting", () => {
        const result = matchPrQuery(item(), parsePrQuery("review:approved"));
        expect(result.matched).toBe(true);
        expect(result.unevaluated.map((c) => c.field)).toEqual(["review"]);
    });

    it("still applies the clauses it can evaluate when one clause is unevaluated", () => {
        const result = matchPrQuery(item(), parsePrQuery("label:bug review:approved"));
        expect(result.matched).toBe(true);
        expect(result.unevaluated).toHaveLength(1);
    });

    it("stops reporting unevaluated clauses once an earlier clause rejects", () => {
        // Clause order matters here, and that is exactly why the UI derives its warning from
        // the query instead of from a row. See `unevaluableClauses`.
        const rejected = matchPrQuery(item(), parsePrQuery("label:chore review:approved"));
        expect(rejected.matched).toBe(false);
        expect(rejected.unevaluated).toHaveLength(0);
    });
});

describe("unevaluableClauses", () => {
    it("reports the review clauses a pull request list cannot answer", () => {
        expect(unevaluableClauses(parsePrQuery("label:bug review:approved")).map((c) => c.value)).toEqual([
            "approved",
        ]);
    });

    it("keeps the negation so the warning can show what was actually typed", () => {
        expect(unevaluableClauses(parsePrQuery("-review:required"))[0]).toMatchObject({
            field: "review",
            value: "required",
            negated: true,
        });
    });

    it("is empty for a query the payload can fully evaluate", () => {
        expect(unevaluableClauses(parsePrQuery("label:bug author:alice draft:true"))).toEqual([]);
    });

    it("reports the clause even when no row could ever match the rest of the query", () => {
        // The whole reason this is not read off a row: with zero matches the per-row list is
        // empty, so the warning would vanish precisely when the user needs it.
        const query = parsePrQuery("author:nobody review:approved");
        expect(matchPrQuery(item(), query).matched).toBe(false);
        expect(unevaluableClauses(query)).toHaveLength(1);
    });
});

describe("matchPrQuery — terms", () => {
    it("matches the title, repo and head/base ref", () => {
        const row = item({ headRef: "feature/x", baseRef: "main" });
        expect(matchPrQuery(row, parsePrQuery("Fix")).matched).toBe(true);
        expect(matchPrQuery(row, parsePrQuery("feature/x")).matched).toBe(true);
        expect(matchPrQuery(row, parsePrQuery("o/r")).matched).toBe(true);
        expect(matchPrQuery(row, parsePrQuery("nothinghere")).matched).toBe(false);
    });

    it("flags a body-only match so the row can be labelled", () => {
        const result = matchPrQuery(item({ body: "a stack trace lives here" }), parsePrQuery("stack"));
        expect(result.matched).toBe(true);
        expect(result.matchedInBody).toBe(true);
    });

    it("does not flag a match that a visible field already explained", () => {
        const result = matchPrQuery(item({ body: "fix the thing" }), parsePrQuery("fix"));
        expect(result.matchedInBody).toBe(false);
    });

    it("excludes a row when a negated term matches it", () => {
        expect(matchPrQuery(item({ title: "regression" }), parsePrQuery("-regression")).matched).toBe(
            false,
        );
        expect(matchPrQuery(item(), parsePrQuery("-regression")).matched).toBe(true);
    });

    it("excludes on a negated term that only hits the body", () => {
        const row = item({ title: "Fix the thing", body: "a regression slipped in" });
        expect(matchPrQuery(row, parsePrQuery("-regression")).matched).toBe(false);
    });

    it("never marks a negated-term row as matched-in-body", () => {
        // An excluded row is excluded whether the hit was visible or buried, so the
        // "matched in description" pill must not fire for it.
        const row = item({ title: "Fix the thing", body: "a regression slipped in" });
        expect(matchPrQuery(row, parsePrQuery("-regression")).matchedInBody).toBe(false);
    });

    it("requires every term to match", () => {
        expect(matchPrQuery(item(), parsePrQuery("Fix thing")).matched).toBe(true);
        expect(matchPrQuery(item(), parsePrQuery("Fix missing")).matched).toBe(false);
    });
});