import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

    const ArrivalsProbe = ({ cacheKey, logs }: { cacheKey: string; logs: GitLogEntry[] }) => {
        const arriving = useArrivingCommitHashes(cacheKey, logs);
        return <div data-arrivals={Array.from(arriving).join(",")} />;
    };

    const renderArrivals = (logs: GitLogEntry[], cacheKey = "/repo::head"): string => {
        act(() => {
            root.render(<ArrivalsProbe cacheKey={cacheKey} logs={logs} />);
        });
        return container.querySelector("[data-arrivals]")?.getAttribute("data-arrivals") ?? "";
    };

    const makeLinearChain = (prefix: string, count: number, tailParent: string): GitLogEntry[] =>
        Array.from({ length: count }, (_, idx) => {
            const step = count - idx;
            const parent = step === 1 ? tailParent : `${prefix}-${step - 1}`;
            return makeLog(`${prefix}-${step}`, [parent], step === count ? ["HEAD -> main"] : []);
        });

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

        expect(renderArrivals(baseLogs)).toBe("");
        expect(renderArrivals(chunkOne)).toBe("");
        expect(renderArrivals(chunkTwo)).toBe("new-3,new-2,new-1");

        // Appending older history on the same HEAD keeps the in-progress arrival set intact.
        expect(renderArrivals([...chunkTwo, makeLog("older-0", [])])).toBe("new-3,new-2,new-1");

        // Switching HEAD ref under the same cacheKey clears stale arrivals so shared rows stop animating.
        const featureLogs = [
            makeLog("feat-1", ["new-3"], ["HEAD -> feature"]),
            makeLog("new-3", ["new-2"]),
            makeLog("new-2", ["new-1"]),
            makeLog("new-1", ["base-0"]),
        ];
        expect(renderArrivals(featureLogs)).toBe("");
    });

    it("retains baseline across streamed merge slices so side-branch commits animate when appended", () => {
        vi.useFakeTimers();
        const baseLogs = [makeLog("base-0", [], ["HEAD -> main"])];
        const mergeChunkOne = [
            makeLog("merge-head", ["base-0", "side-2"], ["HEAD -> main"]),
            makeLog("base-0", []),
        ];
        const mergeChunkTwo = [
            ...mergeChunkOne,
            makeLog("side-2", ["side-1"]),
            makeLog("side-1", ["base-0"]),
        ];

        try {
            expect(renderArrivals(baseLogs)).toBe("");
            expect(renderArrivals(mergeChunkOne)).toBe("merge-head");
            expect(renderArrivals(mergeChunkTwo)).toBe("merge-head,side-2,side-1");

            act(() => {
                vi.advanceTimersByTime(520);
            });
            expect(container.querySelector("[data-arrivals]")?.getAttribute("data-arrivals")).toBe("");
            expect(renderArrivals([...mergeChunkTwo, makeLog("older-0", [])])).toBe("");
        } finally {
            vi.useRealTimers();
        }
    });

    it("animates delayed merge side-branch chunks arriving after the 520ms head highlight expires without replaying settled commits", () => {
        vi.useFakeTimers();
        const mergeStart = [
            makeLog("delayed-merge", ["root-a", "branch-2"], ["HEAD -> main"]),
            makeLog("root-a", []),
        ];
        const middlePage = [...mergeStart, makeLog("ancient-a", [])];
        const finalPage = [
            ...middlePage,
            makeLog("branch-2", ["branch-1"]),
            makeLog("branch-1", ["root-a"]),
        ];

        try {
            expect(renderArrivals([makeLog("root-a", [], ["HEAD -> main"])])).toBe("");
            expect(renderArrivals(mergeStart)).toBe("delayed-merge");

            act(() => {
                vi.advanceTimersByTime(520);
            });
            expect(renderArrivals(middlePage)).toBe("");
            expect(renderArrivals(finalPage)).toBe("branch-2,branch-1");

            act(() => {
                vi.advanceTimersByTime(520);
            });
            expect(container.querySelector("[data-arrivals]")?.getAttribute("data-arrivals")).toBe("");
        } finally {
            vi.useRealTimers();
        }
    });

    it("retains pending baseline when 12 commits confirm before a deeper missing side parent arrives and bounds active union to 12", () => {
        vi.useFakeTimers();
        const leadChain = makeLinearChain("lead", 11, "deep-merge");
        const firstSlice = [
            ...leadChain,
            makeLog("deep-merge", ["anchor-0", "late-side", "later-side"]),
            makeLog("anchor-0", []),
        ];
        const secondSlice = [...firstSlice, makeLog("late-side", ["anchor-0"])];
        const thirdSlice = [...secondSlice, makeLog("later-side", ["anchor-0"])];

        try {
            expect(renderArrivals([makeLog("anchor-0", [], ["HEAD -> main"])])).toBe("");
            const initialSet = renderArrivals(firstSlice).split(",");
            expect(initialSet).toHaveLength(12);
            expect(initialSet[0]).toBe("lead-11");
            expect(initialSet[11]).toBe("deep-merge");

            // Chunk arriving within 520ms adds late-side while keeping active size <= 12.
            const midWindowSet = renderArrivals(secondSlice).split(",");
            expect(midWindowSet).toHaveLength(12);
            expect(midWindowSet).toContain("late-side");

            // Chunk arriving after 520ms animates only newly resolved later-side.
            act(() => {
                vi.advanceTimersByTime(520);
            });
            expect(renderArrivals(thirdSlice)).toBe("later-side");
        } finally {
            vi.useRealTimers();
        }
    });

    it("keeps pending merge baseline when HEAD advances before the side branch arrives", () => {
        vi.useFakeTimers();
        const rootSlice = [makeLog("base-root", [], ["HEAD -> main"])];
        const mergeWithoutSide = [
            makeLog("merge-tip", ["base-root", "missing-side"], ["HEAD -> main"]),
            makeLog("base-root", []),
        ];
        const headAdvancedSlice = [
            makeLog("followup-tip", ["merge-tip"], ["HEAD -> main"]),
            makeLog("merge-tip", ["base-root", "missing-side"]),
            makeLog("base-root", []),
        ];
        const appendedSideSlice = [
            ...headAdvancedSlice,
            makeLog("missing-side", ["base-root"]),
        ];

        try {
            expect(renderArrivals(rootSlice)).toBe("");
            expect(renderArrivals(mergeWithoutSide)).toBe("merge-tip");

            // HEAD advances before missing-side arrives: followup-tip leads and baseline survives.
            expect(renderArrivals(headAdvancedSlice)).toBe("followup-tip,merge-tip");

            act(() => {
                vi.advanceTimersByTime(520);
            });
            const settled = container.querySelector("[data-arrivals]")?.getAttribute("data-arrivals");
            expect(settled).toBe("");

            // Delayed append delivers missing-side without replaying followup-tip or merge-tip.
            expect(renderArrivals(appendedSideSlice)).toBe("missing-side");

            // Resetting HEAD to an already-known commit clears active arrivals immediately.
            expect(renderArrivals(rootSlice)).toBe("");
        } finally {
            vi.useRealTimers();
        }
    });

    it("prevents capped overflow commits from replaying when a missing parent arrives", () => {
        vi.useFakeTimers();
        const fourteenLead = makeLinearChain("over", 14, "overflow-merge");
        const chunkOne = [
            ...fourteenLead,
            makeLog("overflow-merge", ["base-x", "late-branch"]),
            makeLog("base-x", []),
        ];
        const chunkTwo = [...chunkOne, makeLog("late-branch", ["base-x"])];

        try {
            expect(renderArrivals([makeLog("base-x", [], ["HEAD -> main"])])).toBe("");
            const firstWave = renderArrivals(chunkOne).split(",");
            expect(firstWave).toHaveLength(12);
            expect(firstWave[0]).toBe("over-14");
            expect(firstWave[11]).toBe("over-3");

            act(() => {
                vi.advanceTimersByTime(520);
            });
            // Already-present overflow commits (over-2, over-1, overflow-merge) must not animate.
            expect(renderArrivals(chunkTwo)).toBe("late-branch");
        } finally {
            vi.useRealTimers();
        }
    });

    it("tracks checked-out HEAD rather than other branches under Show all branches", () => {
        vi.useFakeTimers();
        const remoteTip = makeLog("remote-1", ["shared-0"], ["origin/feature"]);
        const remoteNewer = makeLog("remote-2", ["remote-1"], ["origin/feature"]);
        const headBase = makeLog("main-1", ["shared-0"], ["HEAD -> main"]);
        const sharedRoot = makeLog("shared-0", []);

        try {
            expect(renderArrivals([remoteTip, headBase, sharedRoot], "/repo::all")).toBe("");

            // Fetching a newer commit on origin/feature at index 0 must not animate as HEAD.
            const afterFetch = [remoteNewer, remoteTip, headBase, sharedRoot];
            expect(renderArrivals(afterFetch, "/repo::all")).toBe("");

            // New commit on HEAD -> main behind a newer-dated remote tip still animates.
            const mainCommit = makeLog("main-2", ["main-1"], ["HEAD -> main"]);
            const mainDemoted = makeLog("main-1", ["shared-0"]);
            const afterMainCommit = [remoteNewer, mainCommit, remoteTip, mainDemoted, sharedRoot];
            expect(renderArrivals(afterMainCommit, "/repo::all")).toBe("main-2");

            // Resetting HEAD -> main back to main-1 clears active arrival even with remote-2 first.
            expect(renderArrivals(afterFetch, "/repo::all")).toBe("");
        } finally {
            vi.useRealTimers();
        }
    });

    it("recovers from an unanchored deep pull so subsequent local commits animate cleanly", () => {
        vi.useFakeTimers();
        const initialSlice = [makeLog("old-head", [], ["HEAD -> main"])];
        // Deep pull where old-head is pushed off the loaded window (pull-1's parent pull-0 is missing).
        const deepPullSlice = [
            makeLog("pull-2", ["pull-1"], ["HEAD -> main"]),
            makeLog("pull-1", ["pull-0"]),
        ];
        // User creates a new local commit on top of pull-2 without ever paging down to old-head.
        const localCommitSlice = [
            makeLog("local-1", ["pull-2"], ["HEAD -> main"]),
            makeLog("pull-2", ["pull-1"]),
            makeLog("pull-1", ["pull-0"]),
        ];
        const secondLocalSlice = [
            makeLog("local-2", ["local-1"], ["HEAD -> main"]),
            makeLog("local-1", ["pull-2"]),
            makeLog("pull-2", ["pull-1"]),
            makeLog("pull-1", ["pull-0"]),
        ];

        try {
            expect(renderArrivals(initialSlice)).toBe("");
            // Unanchored pull stays suppressed while old-head is not yet reachable.
            expect(renderArrivals(deepPullSlice)).toBe("");
            // Subsequent local commit connects to pull-2 in prev.known and animates cleanly.
            expect(renderArrivals(localCommitSlice)).toBe("local-1");
            act(() => {
                vi.advanceTimersByTime(520);
            });
            expect(renderArrivals(secondLocalSlice)).toBe("local-2");
        } finally {
            vi.useRealTimers();
        }
    });
});
