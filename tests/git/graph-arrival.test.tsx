import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GraphSvgRow } from "@/features/git/ui/graph/svg-row";
import {
    collectFreshGraphArrivals,
    detectFreshGraphArrival,
    useArrivingCommitHash,
    useArrivingCommitHashes,
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

    it("collects every newly arrived commit in a multi-commit batch and diamond merge while capping large pulls", () => {
        const prev: GraphHeadSnapshot = {
            cacheKey: "/repo::head",
            topHash: "aaa111",
            known: new Set(["aaa111", "bbb222"]),
            headRef: "branch:main",
        };

        const batch = collectFreshGraphArrivals(
            prev,
            "/repo::head",
            [
                { hash: "ddd444", parents: ["ccc333"] },
                { hash: "ccc333", parents: ["aaa111"] },
                { hash: "aaa111", parents: ["bbb222"] },
            ],
            "branch:main",
        );
        expect(Array.from(batch)).toEqual(["ddd444", "ccc333"]);

        // Merge commit landing with two new side-branch parents + an unrelated orphan root:
        // only commits lying on a path to known history (aaa111) are collected.
        const mergeBatch = collectFreshGraphArrivals(
            prev,
            "/repo::head",
            [
                { hash: "mmm777", parents: ["ddd444", "eee555", "orphan9"] },
                { hash: "ddd444", parents: ["aaa111"] },
                { hash: "eee555", parents: ["aaa111"] },
                { hash: "orphan9", parents: [] },
            ],
            "branch:main",
        );
        expect(Array.from(mergeBatch)).toEqual(["mmm777", "ddd444", "eee555"]);

        // 20-commit fast-forward pull caps animated rows at 12 newest commits.
        const twentyCommits = Array.from({ length: 20 }, (_, index) => {
            const num = 20 - index;
            const parent = num === 1 ? "aaa111" : `new-${num - 1}`;
            return { hash: `new-${num}`, parents: [parent] };
        });
        const capped = collectFreshGraphArrivals(
            prev,
            "/repo::head",
            twentyCommits,
            "branch:main",
        );
        expect(capped.size).toBe(12);
        expect(capped.has("new-20")).toBe(true);
        expect(capped.has("new-9")).toBe(true);
        expect(capped.has("new-8")).toBe(false);
    });

    it("preserves arrival detection across streamed initialLogs + appendLogs chunks", () => {
        const makeLog = (hash: string, parents: string[], refs: string[] = []): GitLogEntry => ({
            hash,
            message: hash,
            author: "Ada",
            author_email: "ada@example.com",
            date: "1700000000",
            files_changed: 1,
            insertions: 1,
            deletions: 0,
            refs,
            parent_count: parents.length,
            parents,
        });

        const baseLogs = [makeLog("base-0", [], ["HEAD -> main"])];
        // First streamed chunk has 2 new commits whose oldest parent (new-1) has not arrived yet.
        const chunkOne = [
            makeLog("new-3", ["new-2"], ["HEAD -> main"]),
            makeLog("new-2", ["new-1"]),
        ];
        // Second streamed chunk appends new-1 -> base-0, bridging the chain to baseLogs.
        const chunkTwo = [
            ...chunkOne,
            makeLog("new-1", ["base-0"]),
            makeLog("base-0", []),
        ];

        const MultiProbe = ({ cacheKey, logs }: { cacheKey: string; logs: GitLogEntry[] }) => {
            const arriving = useArrivingCommitHashes(cacheKey, logs);
            return <div data-arrivals={Array.from(arriving).join(",")} />;
        };

        act(() => {
            root.render(<MultiProbe cacheKey="/repo::head" logs={baseLogs} />);
        });
        expect(container.querySelector("[data-arrivals]")?.getAttribute("data-arrivals")).toBe("");

        act(() => {
            root.render(<MultiProbe cacheKey="/repo::head" logs={chunkOne} />);
        });
        expect(container.querySelector("[data-arrivals]")?.getAttribute("data-arrivals")).toBe("");

        act(() => {
            root.render(<MultiProbe cacheKey="/repo::head" logs={chunkTwo} />);
        });
        expect(container.querySelector("[data-arrivals]")?.getAttribute("data-arrivals")).toBe(
            "new-3,new-2,new-1",
        );

        // Appending older history on the same HEAD keeps the in-progress arrival set intact.
        const chunkThree = [...chunkTwo, makeLog("older-0", [])];
        act(() => {
            root.render(<MultiProbe cacheKey="/repo::head" logs={chunkThree} />);
        });
        expect(container.querySelector("[data-arrivals]")?.getAttribute("data-arrivals")).toBe(
            "new-3,new-2,new-1",
        );

        // Switching HEAD ref under the same cacheKey clears stale arrivals so shared rows stop animating.
        const featureLogs = [
            makeLog("feat-1", ["new-3"], ["HEAD -> feature"]),
            makeLog("new-3", ["new-2"]),
            makeLog("new-2", ["new-1"]),
            makeLog("new-1", ["base-0"]),
        ];
        act(() => {
            root.render(<MultiProbe cacheKey="/repo::head" logs={featureLogs} />);
        });
        expect(container.querySelector("[data-arrivals]")?.getAttribute("data-arrivals")).toBe("");
    });
});
