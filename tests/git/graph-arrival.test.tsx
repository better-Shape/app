import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GraphSvgRow } from "@/features/git/ui/graph/svg-row";
import {
    detectFreshGraphArrival,
    useArrivingCommitHash,
    type GraphHeadSnapshot,
} from "@/features/git/ui/graph/graph";
import type { GitLogEntry, GraphNode } from "@/lib/backend";

let container: HTMLDivElement;
let root: Root;

const SAMPLE_NODE: GraphNode = {
    lane: 0,
    color: "#6ea8fe",
    isMerge: false,
    paths: [
        { fromX: 2, toX: 0, color: "#ffd43b", type: "incoming" },
        { fromX: 0, toX: 0, color: "#6ea8fe", type: "outgoing" },
        { fromX: 1, toX: 1, color: "#8ce99a", type: "passthrough" },
    ],
};

beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

describe("GraphSvgRow arrival stroke draw", () => {
    it("leaves existing history rows static at rest", () => {
        act(() => {
            root.render(
                <GraphSvgRow
                    node={SAMPLE_NODE}
                    isFirst
                    isLast={false}
                    isHead
                    arriving={false}
                />,
            );
        });

        expect(container.querySelectorAll(".t-graph-line-draw")).toHaveLength(0);
        expect(container.querySelector(".t-graph-node-arrive")).toBeNull();
    });

    it("draws incoming/outgoing branch paths while keeping passthrough lanes steady on arrival", () => {
        act(() => {
            root.render(
                <GraphSvgRow
                    node={SAMPLE_NODE}
                    isFirst={false}
                    isLast={false}
                    isHead
                    arriving
                />,
            );
        });

        const drawnPaths = Array.from(container.querySelectorAll("path.t-graph-line-draw"));
        // Shadow + coloured stroke for both incoming (#ffd43b) and outgoing (#6ea8fe) segments.
        expect(drawnPaths).toHaveLength(4);
        for (const path of drawnPaths) {
            expect(path.getAttribute("pathLength")).toBe("100");
        }
        const drawnColors = Array.from(
            container.querySelectorAll("path.graph-line.t-graph-line-draw"),
        ).map((el) => el.getAttribute("stroke"));
        expect(drawnColors).toEqual(["#ffd43b", "#6ea8fe"]);
        const staticLines = container.querySelectorAll("path.graph-line:not(.t-graph-line-draw)");
        expect(staticLines).toHaveLength(1);
        expect(container.querySelector("g.t-graph-node-arrive")).not.toBeNull();
    });

    it("animates only commits extending loaded history on the same checked-out HEAD ref", () => {
        const prev: GraphHeadSnapshot = {
            cacheKey: "/repo::head",
            topHash: "aaa111",
            known: new Set(["aaa111", "bbb222"]),
            headRef: "branch:main",
        };

        // Genuine new commit on top of aaa111 on the same branch -> animates.
        expect(
            detectFreshGraphArrival(
                prev,
                "/repo::head",
                { hash: "ccc333", parents: ["aaa111"] },
                "branch:main",
            ),
        ).toBe(true);

        // Multi-commit fast-forward / batch arrival on the same HEAD ref -> animates newest head.
        expect(
            detectFreshGraphArrival(
                prev,
                "/repo::head",
                [
                    { hash: "ddd444", parents: ["ccc333"] },
                    { hash: "ccc333", parents: ["aaa111"] },
                ],
                "branch:main",
            ),
        ).toBe(true);

        // Checking out an existing descendant branch without changing cacheKey -> stays static.
        expect(
            detectFreshGraphArrival(
                prev,
                "/repo::head",
                { hash: "fff999", parents: ["aaa111"] },
                "branch:feature",
            ),
        ).toBe(false);

        // Toggling showAllBranches switches cacheKey (/repo::all) -> never animates existing history.
        expect(
            detectFreshGraphArrival(
                prev,
                "/repo::all",
                { hash: "ddd444", parents: ["aaa111"] },
                "branch:main",
            ),
        ).toBe(false);

        // Switching to an unrelated branch tip whose parents are outside loaded history -> stays static.
        expect(
            detectFreshGraphArrival(
                prev,
                "/repo::head",
                { hash: "eee555", parents: ["zzz999"] },
                "branch:main",
            ),
        ).toBe(false);
    });

    it("ignores stale gitLogs carried over on the render where cacheKey switches", () => {
        const makeLog = (hash: string, parents: string[]): GitLogEntry => ({
            hash,
            message: hash,
            author: "Ada",
            author_email: "ada@example.com",
            date: "1700000000",
            files_changed: 1,
            insertions: 1,
            deletions: 0,
            refs: [],
            parent_count: parents.length,
            parents,
        });

        const headLogs = [makeLog("aaa111", [])];
        const allBranchLogs = [makeLog("bbb222", ["aaa111"]), makeLog("aaa111", [])];

        const Probe = ({ cacheKey, logs }: { cacheKey: string; logs: GitLogEntry[] }) => {
            const arriving = useArrivingCommitHash(cacheKey, logs);
            return <div data-arriving={arriving ?? ""} />;
        };

        act(() => {
            root.render(<Probe cacheKey="/repo::head" logs={headLogs} />);
        });
        expect(container.querySelector("[data-arriving]")?.getAttribute("data-arriving")).toBe("");

        // Render 1 of toggling showAllBranches: cacheKey flips while logs still holds headLogs.
        act(() => {
            root.render(<Probe cacheKey="/repo::all" logs={headLogs} />);
        });
        expect(container.querySelector("[data-arriving]")?.getAttribute("data-arriving")).toBe("");

        // Render 2: cached descendant head bbb222 (parent aaa111) settles for /repo::all -> must NOT animate as new.
        act(() => {
            root.render(<Probe cacheKey="/repo::all" logs={allBranchLogs} />);
        });
        expect(container.querySelector("[data-arriving]")?.getAttribute("data-arriving")).toBe("");

        // Subsequent real commit ccc333 on /repo::all -> animates!
        const afterCommitLogs = [makeLog("ccc333", ["bbb222"]), ...allBranchLogs];
        act(() => {
            root.render(<Probe cacheKey="/repo::all" logs={afterCommitLogs} />);
        });
        expect(container.querySelector("[data-arriving]")?.getAttribute("data-arriving")).toBe("ccc333");
    });
});
