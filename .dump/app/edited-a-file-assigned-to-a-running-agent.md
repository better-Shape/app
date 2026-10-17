# I edited a file I had assigned to a running agent

Measured 2026-10-17 while triaging leftover review findings with four background
agents.

## What happened

I wrote four scope files with strict, non-overlapping file ownership and
dispatched the agents. Twenty minutes later the Playwright QA crawl found a real
hydration bug in `useSettings`, in `lib/settings/store.ts`, which I had assigned
to agent C. I fixed it without re-reading the scope files I had just written.

## What it cost

1. Agent C could have overwritten the fix, because the file is shared and neither
   of us knew about the other. I steered the running agent to preserve the hunk,
   which is recovery, not prevention.
2. My central gate stopped being trustworthy. `npm run build:preview` and
   `npm run typecheck` both failed on `features/chat/lib/use-chat-session.ts`,
   which agent D was editing at the time. The failure was not mine and not a
   regression, and a gate that reports another agent's in-flight state as a
   failure will be misread as a defect sooner or later.

## Changed behaviour

1. **Before editing any file, check the in-flight scope list.** Delegation is not
   a snapshot of what is allowed, it is a live claim on those paths.
2. **A gate failure in a file an agent owns is the agent's state, not a
   regression.** Check `git status` and the scope files before investigating, and
   say which it is rather than guessing.
3. **Do not run a whole-tree gate while agents are mid-edit.** Run the specific
   test files you own instead, then run the full gate once the agents report.