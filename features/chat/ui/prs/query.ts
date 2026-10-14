/**
 * Typed search-query parsing for the pull-request list.
 *
 * Pure: no React, no network, no dependency on the rest of the panel. The shape
 * mirrors GitHub's own search qualifiers so a query can either be evaluated
 * against the rows already in memory or serialised for the host.
 */

/** Qualifiers this parser understands. Everything else becomes a namespaced label. */
export type PrClauseField = "label" | "author" | "repo" | "draft" | "review" | "status";

export type PrClause = {
    field: PrClauseField;
    value: string;
    negated: boolean;
};

export type PrTerm = {
    text: string;
    negated: boolean;
};

export type PrQuery = {
    input: string;
    clauses: PrClause[];
    terms: PrTerm[];
};

/** The smallest row shape the matcher needs. `PrItem` satisfies it structurally. */
export type PrSearchableItem = {
    number: number;
    title: string;
    status: string;
    draft?: boolean;
    author?: string;
    repo: string;
    body?: string;
    labels: { name: string }[];
    headRef?: string;
    baseRef?: string;
};

export type PrMatch = {
    matched: boolean;
    /** The only thing that matched lives in the body, which the row does not show. */
    matchedInBody: boolean;
    /** Clauses this payload cannot answer (there is no review state in a list row). */
    unevaluated: PrClause[];
};

const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

const ENUM_VALUES: Record<"draft" | "review" | "status", readonly string[]> = {
    draft: ["true", "false"],
    review: ["approved", "changes-requested", "required", "none"],
    status: ["open", "closed", "merged", "all"],
};

const REVIEW_ALIASES: Record<string, string> = {
    approved: "approved",
    "changes-requested": "changes-requested",
    changes_requested: "changes-requested",
    required: "required",
    none: "none",
};

/**
 * Split on whitespace, keeping quotes attached so the caller can tell
 * `label:"needs design"` (one qualifier) from `"size:XXL"` (literal text).
 */
function tokenize(input: string): string[] {
    const tokens: string[] = [];
    let current = "";
    let inQuote = false;
    let escaped = false;
    for (const char of input) {
        if (escaped) {
            current += char;
            escaped = false;
            continue;
        }
        if (char === "\\" && inQuote) {
            current += char;
            escaped = true;
            continue;
        }
        if (char === '"') {
            inQuote = !inQuote;
            current += char;
            continue;
        }
        if (!inQuote && /\s/.test(char)) {
            if (current) tokens.push(current);
            current = "";
            continue;
        }
        current += char;
    }
    if (current) tokens.push(current);
    return tokens;
}

/** An unterminated quote means the token was never a qualifier. */
function quotesBalanced(token: string): boolean {
    let open = false;
    let escaped = false;
    for (const char of token) {
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === "\\" && open) escaped = true;
        else if (char === '"') open = !open;
    }
    return !open;
}

function unquote(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    return trimmed;
}

function quoteIfNeeded(value: string): string {
    return /^(?!-)[\w.+-]+$/.test(value) ? value : JSON.stringify(value);
}

function normalizeField(key: string): PrClauseField | null {
    if (key === "label" || key === "labels") return "label";
    if (key === "author") return "author";
    if (key === "repo") return "repo";
    if (key === "draft") return "draft";
    if (key === "review") return "review";
    if (key === "status" || key === "state") return "status";
    return null;
}

/**
 * `status:open` and friends only make sense for the values GitHub defines; a
 * typo (`draft:maybe`) degrades to free text instead of silently matching nothing.
 */
function enumClause(
    field: "draft" | "review" | "status",
    value: string,
    negated: boolean,
): PrClause | null {
    const lowered = value.toLowerCase();
    if (field === "review") {
        const normalized = REVIEW_ALIASES[lowered];
        return normalized ? { field, value: normalized, negated } : null;
    }
    return ENUM_VALUES[field].includes(lowered) ? { field, value: lowered, negated } : null;
}

function clauseFor(key: string, value: string, negated: boolean): PrClause | null {
    if (key === "is") {
        const lowered = value.toLowerCase();
        if (lowered === "draft") return { field: "draft", value: "true", negated };
        if (lowered === "open" || lowered === "closed" || lowered === "merged") {
            return { field: "status", value: lowered, negated };
        }
        return null;
    }
    const field = normalizeField(key);
    if (!field) return null;
    if (field === "draft" || field === "review" || field === "status") {
        return enumClause(field, value, negated);
    }
    const trimmed = value.trim();
    return trimmed ? { field, value: trimmed, negated } : null;
}

export function parsePrQuery(input: string): PrQuery {
    const clauses: PrClause[] = [];
    const terms: PrTerm[] = [];

    for (const rawToken of tokenize(input)) {
        let token = rawToken;
        let negated = false;
        if (token.startsWith("-") && token.length > 1) {
            negated = true;
            token = token.slice(1);
        }

        // Only the first colon matters, and a key that spans a quoted region
        // never survives KEY_PATTERN, so there is no need to skip quoted colons.
        const colon = token.indexOf(":");
        if (colon > 0 && quotesBalanced(token)) {
            const key = unquote(token.slice(0, colon));
            if (KEY_PATTERN.test(key)) {
                const value = unquote(token.slice(colon + 1));
                const clause = clauseFor(key, value, negated);
                if (clause) {
                    clauses.push(clause);
                    continue;
                }
                // Repos namespace labels with colons, so an unrecognised key is a
                // label that happens to contain one, not a mistake. Quoting the
                // whole token (`"size:XXL"`) is the way back to literal text.
                if (key !== "is" && normalizeField(key) === null && value) {
                    clauses.push({ field: "label", value: `${key}:${value}`, negated });
                    continue;
                }
            }
        }

        const text = unquote(token);
        if (text) terms.push({ text, negated });
    }

    return { input, clauses, terms };
}

export function prQueryIsEmpty(query: PrQuery): boolean {
    return query.clauses.length === 0 && query.terms.length === 0;
}

/**
 * Clauses this payload can never answer, independent of any row.
 *
 * `PrMatch.unevaluated` is collected per row and stops at the first clause that
 * rejects, so it both depends on clause order and comes back empty whenever no
 * row matches -- which is exactly when a user most needs to be told their query
 * was only partly honoured. What the payload cannot express is a property of the
 * query, not of the row, so it is derived here once.
 */
export function unevaluableClauses(query: PrQuery): PrClause[] {
    return query.clauses.filter((clause) => clause.field === "review");
}

const GITHUB_REVIEW_VALUES: Record<string, string> = {
    approved: "approved",
    "changes-requested": "changes_requested",
    required: "required",
    none: "none",
};

function clauseToGitHub(clause: PrClause): string | null {
    const sign = clause.negated ? "-" : "";
    switch (clause.field) {
        case "label":
            return `${sign}label:${quoteIfNeeded(clause.value)}`;
        case "author":
            return `${sign}author:${quoteIfNeeded(clause.value)}`;
        case "repo":
            return `${sign}repo:${quoteIfNeeded(clause.value)}`;
        case "draft":
            // `draft:false` and `-draft:true` both mean "not a draft"; the sign
            // flips when the value already encodes the opposite sense.
            return (clause.value === "true") !== clause.negated ? "is:draft" : "-is:draft";
        case "review":
            return `${sign}review:${GITHUB_REVIEW_VALUES[clause.value] ?? clause.value}`;
        case "status":
            if (clause.value === "all") return null;
            return `${sign}is:${clause.value}`;
    }
}

/**
 * Serialise a parsed query as a GitHub search string. `is:pr` is always present
 * because the issue search endpoint would otherwise return issues too.
 */
export function toGitHubSearchQuery(query: PrQuery): string {
    const parts: string[] = ["is:pr"];
    for (const clause of query.clauses) {
        const rendered = clauseToGitHub(clause);
        if (rendered) parts.push(rendered);
    }
    for (const term of query.terms) {
        parts.push(`${term.negated ? "-" : ""}${quoteIfNeeded(term.text)}`);
    }
    return parts.join(" ");
}

function visibleHaystacks(item: PrSearchableItem): string[] {
    return [
        item.title,
        `#${item.number}`,
        String(item.number),
        item.author ?? "",
        item.repo,
        item.headRef ?? "",
        item.baseRef ?? "",
        ...item.labels.map((label) => label.name),
    ].map((value) => value.toLowerCase());
}

function termMatches(item: PrSearchableItem, term: PrTerm): { ok: boolean; inBody: boolean } {
    const needle = term.text.toLowerCase();
    const inVisible = visibleHaystacks(item).some((haystack) => haystack.includes(needle));
    const inBody = !inVisible && Boolean(item.body) && item.body!.toLowerCase().includes(needle);
    // A negated term excludes the rows it matches, so it has to be inverted here --
    // `clauseMatches` does the same for clauses. An excluded row is excluded whether
    // the hit was visible or buried in the body, so `inBody` is false either way.
    if (term.negated) return { ok: !(inVisible || inBody), inBody: false };
    return { ok: inVisible || inBody, inBody };
}

function clauseMatches(item: PrSearchableItem, clause: PrClause): boolean | null {
    switch (clause.field) {
        case "label": {
            const wanted = clause.value.toLowerCase();
            const has = item.labels.some((label) => label.name.toLowerCase() === wanted);
            return clause.negated ? !has : has;
        }
        case "author": {
            const wanted = clause.value.toLowerCase();
            const has = (item.author ?? "").toLowerCase() === wanted;
            return clause.negated ? !has : has;
        }
        case "repo": {
            const has = item.repo.toLowerCase() === clause.value.toLowerCase();
            return clause.negated ? !has : has;
        }
        case "draft": {
            const wantsDraft = clause.value === "true";
            const has = Boolean(item.draft);
            const matches = has === wantsDraft;
            return clause.negated ? !matches : matches;
        }
        case "status": {
            if (clause.value === "all") return true;
            const wanted = clause.value;
            const has = item.status.toLowerCase() === wanted;
            return clause.negated ? !has : has;
        }
        case "review":
            // A list row carries no review decision, so this clause cannot be
            // answered here. Callers get it back in `unevaluated`.
            return null;
    }
}

export function matchPrQuery(item: PrSearchableItem, query: PrQuery): PrMatch {
    const unevaluated: PrClause[] = [];
    let matchedInBody = false;

    for (const clause of query.clauses) {
        const result = clauseMatches(item, clause);
        if (result === null) {
            unevaluated.push(clause);
            continue;
        }
        if (!result) return { matched: false, matchedInBody: false, unevaluated };
    }

    for (const term of query.terms) {
        const { ok, inBody } = termMatches(item, term);
        if (!ok) return { matched: false, matchedInBody: false, unevaluated };
        if (inBody) matchedInBody = true;
    }

    return { matched: true, matchedInBody, unevaluated };
}