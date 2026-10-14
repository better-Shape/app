"use client";

import { commands } from "@/lib/backend";
import { ciFromStatus, parseJson, type PrCi } from "./mapping";

/**
 * CI status is the one part of a row that costs a separate call per pull
 * request. Requests are de-duplicated by commit and run a few at a time so
 * scrolling a long list cannot open twenty `gh api` processes at once.
 */

const MAX_CONCURRENT = 4;

type Job = {
    run: () => Promise<PrCi>;
    resolve: (ci: PrCi) => void;
    reject: (error: unknown) => void;
};

const inFlight = new Map<string, Promise<PrCi>>();
let queue: Job[] = [];
let active = 0;

function pump() {
    while (active < MAX_CONCURRENT && queue.length > 0) {
        const job = queue.shift();
        if (!job) return;
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
            run: async () => {
                try {
                    const raw = await commands.githubApiGet(
                        `/repos/${owner}/${repo}/commits/${sha}/status`,
                    );
                    const status = parseJson(raw) as { state?: string } | null;
                    return ciFromStatus(status?.state);
                } finally {
                    inFlight.delete(key);
                }
            },
            resolve,
            reject,
        });
    });

    inFlight.set(key, promise);
    pump();
    return promise;
}