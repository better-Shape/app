import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GraphSvgRow } from "@/features/git/ui/graph/svg-row";
import { detectFreshGraphArrival, type GraphHeadSnapshot } from "@/features/git/ui/graph/graph";
import type { GraphNode } from "@/lib/backend";

let container: HTMLDivElement;
let root: Root;

const SAMPLE_NODE: GraphNode = {
    lane: 0,
    color: "#6ea8fe",
    isMerge: false,
    paths: [
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
                    isFirst
                    isLast={false}
                    isHead
                    arriving
                />,
            );
        });

        const drawnPaths = Array.from(container.querySelectorAll("path.t-graph-line-draw"));
        // Shadow + coloured stroke on the outgoing segment only; passthrough lane stays static.
        expect(drawnPaths).toHaveLength(2);
        for (const path of drawnPaths) {
            expect(path.getAttribute("pathLength")).toBe("100");
        }
        const staticLines = container.querySelectorAll("path.graph-line:not(.t-graph-line-draw)");
        expect(staticLines).toHaveLength(1);
        expect(container.querySelector("g.t-graph-node-arrive")).not.toBeNull();
    });

    it("animates only commits extending loaded history in the same cacheKey, not cache or branch switches", () => {
        const prev: GraphHeadSnapshot = {
            cacheKey: "/repo::head",
            topHash: "aaa111",
            known: new Set(["aaa111", "bbb222"]),
        };

        // Genuine new commit on top of aaa111 in the same cacheKey -> animates.
        expect(
            detectFreshGraphArrival(prev, "/repo::head", {
                hash: "ccc333",
                parents: ["aaa111"],
            }),
        ).toBe(true);

        // Toggling showAllBranches switches cacheKey (/repo::all) -> never animates existing history.
        expect(
            detectFreshGraphArrival(prev, "/repo::all", {
                hash: "ddd444",
                parents: ["aaa111"],
            }),
        ).toBe(false);

        // Switching to an unrelated branch tip whose parents are outside loaded history -> stays static.
        expect(
            detectFreshGraphArrival(prev, "/repo::head", {
                hash: "eee555",
                parents: ["zzz999"],
            }),
        ).toBe(false);
    });
});
