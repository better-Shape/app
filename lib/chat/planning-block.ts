export function todoCountLabel(completed: number, total: number): string {
    return `${completed}/${total}`;
}

export type PlanStepStatus = "done" | "active" | "pending" | "cancelled";

export function freezeActiveSteps<T extends { status: PlanStepStatus }>(
    steps: T[],
    isGenerating?: boolean,
): T[] {
    return steps.map((step) =>
        !isGenerating && step.status === "active" ? { ...step, status: "pending" as const } : step,
    );
}

export interface PlanningStepItem {
    status: PlanStepStatus;
    label: string;
}

export interface PlanningPreviewWindow<T extends PlanningStepItem = PlanningStepItem> {
    items: Array<{ step: T; index: number }>;
    hiddenCount: number;
}

/**
 * Selects a compact sliding preview window for collapsed `PlanningBlock` checklists so
 * long plans follow the currently active (or next pending) step instead of pinning the
 * first two completed steps forever.
 */
export function selectPlanningPreviewSteps<T extends PlanningStepItem>(
    steps: readonly T[],
    maxVisible = 2,
): PlanningPreviewWindow<T> {
    if (maxVisible <= 0 || steps.length === 0) {
        return { items: [], hiddenCount: steps.length };
    }
    if (steps.length <= maxVisible) {
        return {
            items: steps.map((step, index) => ({ step, index })),
            hiddenCount: 0,
        };
    }

    const activeIdx = steps.findIndex((s) => s.status === "active");
    const firstPendingIdx = steps.findIndex((s) => s.status === "pending");
    let lastDoneIdx = -1;
    for (let i = steps.length - 1; i >= 0; i -= 1) {
        if (steps[i]?.status === "done") {
            lastDoneIdx = i;
            break;
        }
    }

    const anchorIdx =
        activeIdx >= 0
            ? activeIdx
            : firstPendingIdx >= 0
              ? firstPendingIdx
              : lastDoneIdx >= 0
                ? lastDoneIdx
                : steps.length - 1;

    const selected = new Set<number>([anchorIdx]);

    if (selected.size < maxVisible) {
        let prevDone = -1;
        for (let i = anchorIdx - 1; i >= 0; i -= 1) {
            if (steps[i]?.status === "done") {
                prevDone = i;
                break;
            }
        }
        if (prevDone >= 0) {
            selected.add(prevDone);
        }
    }

    for (let offset = 1; selected.size < maxVisible && offset < steps.length; offset += 1) {
        const after = anchorIdx + offset;
        if (after < steps.length) {
            selected.add(after);
            if (selected.size >= maxVisible) break;
        }
        const before = anchorIdx - offset;
        if (before >= 0) {
            selected.add(before);
        }
    }

    const ordered = [...selected]
        .sort((a, b) => a - b)
        .flatMap((index) => {
            const step = steps.at(index);
            return step ? [{ step, index }] : [];
        });

    return {
        items: ordered,
        hiddenCount: Math.max(0, steps.length - ordered.length),
    };
}
