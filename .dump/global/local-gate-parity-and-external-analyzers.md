# Local gate parity, external analyzers and offline sandbox caches

## Conclusion

Passing `npm run lint`, `npx tsc --noEmit` and a single Vitest file in a network-restricted sandbox does not prove that CI or external pull request analyzers will pass. Split verification into local pre-push gates and remote post-push checks.

### Before pushing

- Run `npm ci`, `npm run lint:strict`, `npm run typecheck`, `npm run test:all` and `npm run skills:verify` under the repository toolchain in `package.json`: Node `v22.22.3`, ESLint `^9` via `eslint.config.cjs`, TypeScript `^6.0.3` via `tsconfig.json` and `tests/tsconfig.json`, Vitest `^4.1.12` via `vitest.config.ts`, and Playwright `^1.64.1` via `playwright.config.ts`.
- Run the Cargo format and Clippy commands in `AGENTS.md` whenever `src-tauri/` changes.
- Check touched JavaScript and TypeScript files against the external analyzer rules below.
- Isolate TTL-cached network or IPC tests with explicit cache bypass or command mocks, and restore mocks and clear persisted or in-memory cache state in `finally` blocks so later tests do not depend on execution order.

### After pushing

- Query pull request mergeability separately with `gh pr view <number> --json mergeable,mergeStateStatus` and exit immediately when `mergeable` is `CONFLICTING` or `mergeStateStatus` is `DIRTY`, then poll every page of `gh api --paginate` on both `repos/better-Shape/app/commits/<sha>/check-runs` and `repos/better-Shape/app/commits/<sha>/status` for commit checks and statuses on the pushed head SHA.

## Evidence from PR 53

On branch `arena/c0114966-app` in [PR 53](https://github.com/better-Shape/app/pull/53), commit `414ce6b11938aa828534b2b1184c90df79fa9bb6` passed `npx eslint` on changed files, `npx tsc --noEmit` and a targeted Vitest file locally, then failed four separate checks on GitHub.

| Check or status | Failure on `414ce6b1` | Root cause | Fix verified on `3387105b`, `2a6cfe8089` and `9afb3672` |
| --- | --- | --- | --- |
| `Lint & Typecheck` and `Static Checks` on macOS | `eslint --max-warnings=0` exited with 1 on `react-hooks/exhaustive-deps` | `.github/workflows/ci.yml` lines 37 and 165 run `npm run lint:strict`, whereas `AGENTS.md` listed `npm run lint` which allows warnings | Updated `AGENTS.md` to require `npm run lint:strict` and stabilized the hook dependency |
| `Test JS` in Vitest | `tests/features/chat-stream-strip-equiv.test.ts` and `tests/lib/model-catalog.test.ts` failed | Targeted Vitest skipped the cross-module equivalence test, and `refreshModelCatalog()` warmed its 24-hour TTL cache on online CI runners before the mocked `fetch` test ran | Derived fence bounds from `scanMarkdownCodeFences` in `features/chat/ui/md/stream.ts` and called `refreshModelCatalog(true)` with `finally` cleanup in `tests/lib/model-catalog.test.ts` |
| `DeepSource: JavaScript` and `SonarQube Cloud` | `JS-0113` and `typescript:S5868` on `[\uFE0E\uFE0F]`, plus `typescript:S6666` unnecessary optional chain | External analyzers run type-aware and Unicode character-class rules that `eslint.config.cjs` does not enable locally | Replaced the variation-selector character class with code-point range predicates and removed redundant optional chains on non-nullable arrays |
| PR babysitting and bot reviews | `gh pr edit` exited with 1 and `check-runs` omitted `DeepSource`, `CodeAnt`, `DeepScan` and `Snyk` | GitHub removed the `projectCards` GraphQL field that `gh pr edit` queries, and four analyzers publish commit statuses instead of check runs | Updated PR bodies via `gh api -X PATCH repos/better-Shape/app/pulls/53` and polled both `commits/<sha>/check-runs` and `commits/<sha>/status` |

## External analyzer rules absent from local ESLint

`SonarQube Cloud` via the [PR 53 Quality Gate report](https://github.com/better-Shape/app/pull/53#issuecomment-6465355718) for project `better-Shape_app`, `DeepSource` configured by `.deepsource.toml` `version = 1` at the repository root and reporting commit statuses `DeepSource: JavaScript`, `DeepSource: Rust` and `DeepSource: Secrets`, `DeepScan` reporting commit status `DeepScan`, and `CodeAnt` reporting in [comment 6388574213](https://github.com/better-Shape/app/pull/53#issuecomment-6388574213) and [comment 6388663282](https://github.com/better-Shape/app/pull/53#issuecomment-6388663282) inspect every pull request push outside `eslint.config.cjs`:

- Unnecessary nullish coalescing or optional chaining on non-nullable types fails `SonarQube Cloud` rule [`typescript:S6666`](https://rules.sonarsource.com/typescript/RSPEC-6666/) because `tsconfig.json` leaves `noUncheckedIndexedAccess` disabled, so `items[0]` has a non-undefined static type.
- Variation selectors `\uFE0E` and `\uFE0F` or combining marks inside regex character classes `[...]` fail `DeepSource` rule [`JS-0113`](https://deepsource.com/directory/javascript/issues/JS-0113) and `SonarQube Cloud` rule [`typescript:S5868`](https://rules.sonarsource.com/typescript/RSPEC-5868/). Use numeric `codePointAt` range predicates or non-character-class alternation with the `u` flag.
- Under `.deepsource.toml` `version = 1`, module-scope `function` declarations trigger `DeepSource` [`JS-0067`](https://deepsource.com/directory/javascript/issues/JS-0067), undocumented exported declarations trigger [`JS-D1001`](https://deepsource.com/directory/javascript/issues/JS-D1001), forward references before `const` arrow definitions trigger [`JS-0356`](https://deepsource.com/directory/javascript/issues/JS-0356), `void` expressions trigger [`JS-0098`](https://deepsource.com/directory/javascript/issues/JS-0098), single-character identifiers trigger [`JS-C1002`](https://deepsource.com/directory/javascript/issues/JS-C1002), JSX trees deeper than 4 nested elements trigger [`JS-0415`](https://deepsource.com/directory/javascript/issues/JS-0415), and cyclomatic complexity above 5 degrades the complexity grade. Identical conditional branches trigger `DeepScan` [`IDENTICAL_BRANCHES`](https://deepscan.io/docs/rules/identical-branches).
- Copy-pasted token blocks across changed files fail the `SonarQube Cloud` Clean as You Code `new_duplicated_lines_density` gate, verified at `0.0%` on PR 53 in [comment 6465355718](https://github.com/better-Shape/app/pull/53#issuecomment-6465355718). Extract shared helpers instead of repeating structure.

## Rejected approaches

- Lowering analyzer thresholds or editing `.deepsource.toml` to silence warnings hides real defects and violates the Verification Gate rules in `AGENTS.md`.
- Truncating fenced tool blocks from the first opening fence to the first leaked tag or scanning mid-line backtick runs corrupts valid Markdown prose and earlier code blocks. Always derive fenced block spans from `scanMarkdownCodeFences` in `features/chat/ui/md/stream.ts`.
- Posting `@codeant-ai review` while CodeAnt's automatic incremental push review is still running can leave [comment 6388663282](https://github.com/better-Shape/app/pull/53#issuecomment-6388663282) anchored to the previous commit. Wait until [comment 6388574213](https://github.com/better-Shape/app/pull/53#issuecomment-6388574213) marks its push review complete before posting a manual tag if one is still needed.
- Waiting for `check-runs` to reach the full `pull_request` workflow count while `mergeStateStatus` is `DIRTY` loops forever, because GitHub Actions does not trigger `pull_request` workflows when the base branch advances into a merge conflict, as observed between `cf4efd4b1e717e1e4f657bb40cbf01882d044fd2` and `008b0cbae2b5fda030d0ba2b702bc96c495168a9`. Break out of CI polling immediately when `mergeable` is `CONFLICTING` or `mergeStateStatus` is `DIRTY`.
