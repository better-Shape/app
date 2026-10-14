"use client";

import { commands } from "@/lib/backend";
import { ciFromStatus, parseJson, type PrCi } from "./mapping";

const MAX_CONCURRENT = 4;

type CheckRun = { status?: string; conclusion?: string | null };
type CombinedStatus = { state?: string; total_count?: number };
type CheckPage = { total_count: number; check_runs: CheckRun[] };

/** Neither an empty legacy-status list nor a missing check payload is a green build. */
export function combinedCi(status: CombinedStatus | null, checks: CheckRun[] | null): PrCi {
    const states: PrCi[] = [];
    if (!status || typeof status.total_count !== "number") states.push("unknown");
    else if (status.total_count > 0) states.push(ciFromStatus(status.state));
    if (!checks) states.push("unknown");
    else for (const check of checks) {
        if (check.status !== "completed") states.push("pending");
        else if (["success", "neutral", "skipped"].includes(check.conclusion ?? "")) states.push("success");
        else if (["failure", "cancelled", "timed_out", "action_required", "stale", "startup_failure"].includes(check.conclusion ?? "")) states.push("failure");
        else states.push("unknown");
    }
    if (states.includes("failure")) return "failure";
    if (states.includes("pending")) return "pending";
    if (states.length === 0 || states.includes("unknown")) return "unknown";
    return "success";
}

async function loadCi(owner: string, repo: string, sha: string): Promise<PrCi> {
    const base = `/repos/${owner}/${repo}/commits/${sha}`;
    // Sequential within a job: the queue bounds actual gh processes, not just rows.
    let status: CombinedStatus | null = null;
    try {
        status = parseJson(await commands.githubApiGet(`${base}/status`)) as CombinedStatus;
    } catch { /* Check runs can still reveal a failure when legacy status is unavailable. */ }
    let checks: CheckRun[] | null = [];
    try {
        for (let page = 1; ; page += 1) {
            const payload = parseJson(await commands.githubApiGet(
                `${base}/check-runs?filter=latest&per_page=100&page=${page}`,
            )) as CheckPage;
            if (!Array.isArray(payload?.check_runs) || typeof payload.total_count !== "number") {
                throw new Error("Invalid GitHub checks response");
            }
            checks.push(...payload.check_runs);
            if (checks.length >= payload.total_count) break;
            // Never mark a truncated response as green.
            if (payload.check_runs.length === 0) throw new Error("Incomplete GitHub checks response");
        }
    } catch {
        checks = null;
    }
    return combinedCi(status, checks);
}

type Job = {
    run: () => Promise<PrCi>;
    resolve: (ci: PrCi) => void;
    reject: (error: unknown) => void;
};

const inFlight = new Map<string, Promise<PrCi>>();
const queue: Job[] = [];
let active = 0;

function pump() {
    while (active < MAX_CONCURRENT && queue.length > 0) {
        const job = queue.shift()!;
        active += 1;
        job.run().then(job.resolve, job.reject).finally(() => {
            active -= 1;
            pump();
        });
    }
}

export function requestCiStatus(owner: string, repo: string, sha: string): Promise<PrCi> {
    const key = `${owner}/${repo}@${sha}`;
    const existing = inFlight.get(key);
    if (existing) return existing;
    const promise = new Promise<PrCi>((resolve, reject) => {
        queue.push({
            run: () => loadCi(owner, repo, sha).finally(() => inFlight.delete(key)),
            resolve,
            reject,
        });
    });
    inFlight.set(key, promise);
    pump();
    return promise;
}
