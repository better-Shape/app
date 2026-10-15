import { describe, expect, it } from "vitest";
import { mapPrTimeline } from "@/features/chat/ui/prs/timeline";

describe("PR timeline mapping", () => {
    it("orders comments, reviews, and commits by their actual event dates", () => {
        const events = mapPrTimeline([
            { id: 5, event: "reviewed", state: "approved", submitted_at: "2026-10-14T12:00:00Z", user: { login: "reviewer" }, body: "Looks good" },
            { event: "committed", sha: "1234567890", author: { name: "Committer", date: "2026-10-12T12:00:00Z" }, message: "Fix parsing" },
            { id: 5, event: "commented", created_at: "2026-10-13T12:00:00Z", user: { login: "author", avatar_url: "https://github.com/author.png" }, body: "Ready" },
        ]);
        expect(events.map((event) => event.description)).toEqual(["committed 1234567", "commented", "approved these changes"]);
        expect(events.map((event) => event.body)).toEqual(["Fix parsing", "Ready", "Looks good"]);
        expect(events[2].actor?.login).toBe("reviewer");
        expect(new Set(events.map((event) => event.id)).size).toBe(3);
    });
    it("handles deleted actors and missing dates without inventing opening times", () => {
        const events = mapPrTimeline([{ event: "closed", id: 3, actor: null }, {}, { event: "head_ref_deleted", id: 4 }]);
        expect(events).toHaveLength(2);
        expect(events[0].actor).toBeUndefined();
        expect(events[0].date).toBeUndefined();
        expect(events[1].description).toBe("head ref deleted");
    });
    it("represents requested changes, labels, teams, and title changes", () => {
        expect(mapPrTimeline([
            { id: 1, event: "reviewed", state: "changes_requested" },
            { id: 2, event: "labeled", label: { name: "bug" } },
            { id: 3, event: "review_requested", requested_team: { name: "Maintainers" } },
            { id: 4, event: "renamed", rename: { to: "New title" } },
        ]).map((event) => event.description)).toEqual(expect.arrayContaining([
            "requested changes", "added label bug", "requested a review from Maintainers", "renamed this pull request to New title",
        ]));
    });
});
