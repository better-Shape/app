# Local gate parity, external analyzers and offline sandbox caches

## Conclusion

Passing `npm run lint`, `npx tsc --noEmit` and a single Vitest file in a network-restricted sandbox does not prove that CI or external pull request analyzers will pass. Run every step below before you push a branch in this repository.

- Run `npm ci`, `npm run lint:strict`, `npm run typecheck`, `npm run test:all` and `npm run skills:verify`.
- Run the Cargo format and Clippy commands in `AGENTS.md` whenever `src-tauri` changes.
- Check touched JavaScript and TypeScript files against the external analyzer rules below.
- Isolate TTL-cached network tests with explicit cache bypass or `fetch` stubs.
- Poll every page of `gh api --paginate` on both `check-runs` and `status` for the pushed head SHA.

## Evidence from PR 53

On branch `arena/c0114966-app` in PR 53, commit `414ce6b11938aa828534b2b1184c90df79fa9bb6` passed `npx eslint` on changed files, `npx tsc --noEmit` and a targeted Vitest file locally, then failed four separate checks on GitHub.

| Check or status | Failure on `414ce6b1` | Root cause | Fix verified on `3387105b` and `2a6cfe8089` |
| --- | --- | --- | --- |
| `Lint & Typecheck` and `Static Checks` on macOS | `eslint --max-warnings=0` exited with 1 on `react-hooks/exhaustive-deps` | `.github/workflows/ci.yml` lines 37 and 165 run `npm run lint:strict`, whereas `AGENTS.md` listed `npm run lint` which allows warnings | Updated `AGENTS.md` to require `npm run lint:strict` and stabilized the hook dependency |
| `Test JS` in Vitest | `tests/features/chat-stream-strip-equiv.test.ts` and `tests/lib/model-catalog.test.ts` failed | Targeted Vitest skipped the cross-module equivalence test, and `refreshModelCatalog()` warmed its 24-hour TTL cache on online CI runners before the mocked `fetch` test ran | Derived fence bounds from `scanMarkdownCodeFences` in `features/chat/ui/md/stream.ts` and called `refreshModelCatalog(true)` with `finally` cleanup in `tests/lib/model-catalog.test.ts` |
| `DeepSource: JavaScript` and `SonarQube Cloud` | `JS-0113` and `typescript:S5868` on `[\uFE0E\uFE0F]`, plus `typescript:S6666` unnecessary optional chain | External analyzers run type-aware and Unicode character-class rules that `eslint.config.cjs` does not enable locally | Replaced the variation-selector character class with code-point range predicates and removed redundant optional chains on non-nullable arrays |
| PR babysitting and bot reviews | `gh pr edit` exited with 1 and `check-runs` omitted `DeepSource`, `CodeAnt`, `DeepScan` and `Snyk` | GitHub removed the `projectCards` GraphQL field that `gh pr edit` queries, and four analyzers publish commit statuses instead of check runs | Updated PR bodies via `gh api -X PATCH repos/better-Shape/app/pulls/53` and polled both `commits/<sha>/check-runs` and `commits/<sha>/status` |

## External analyzer rules absent from local ESLint

`SonarQube Cloud`, `DeepSource`, `DeepScan` and `CodeAnt` inspect every pull request push outside `eslint.config.cjs`:

- Unnecessary nullish coalescing or optional chaining on non-nullable types fails `SonarQube Cloud` type-aware checks because `tsconfig.json` leaves `noUncheckedIndexedAccess` disabled, so `items[0]` has a non-undefined static type.
- Variation selectors `\uFE0E` and `\uFE0F` or combining marks inside regex character classes `[...]` fail `DeepSource` `JS-0113` and `SonarQube Cloud` `S5868`. Use numeric `codePointAt` range predicates or non-character-class alternation with the `u` flag.
- Module-scope `function` declarations trigger `DeepSource` `JS-0067`, undocumented inner or exported arrows trigger `JS-D1001`, forward references before `const` arrow definitions trigger `JS-0356`, `void` expressions trigger `JS-0098`, single-character identifiers trigger `JS-C1002`, JSX trees deeper than 4 nested elements trigger `JS-0415`, and cyclomatic complexity above 5 degrades the complexity grade.
- Copy-pasted token blocks across changed files fail `SonarQube Cloud` new-code duplication when duplicated lines exceed 0.0 percent. Extract shared helpers instead of repeating structure.

## Rejected approaches

- Lowering analyzer thresholds or editing `.deepsource.toml` to silence warnings hides real defects and violates the Verification Gate rules.
- Truncating fenced tool blocks from the first opening fence to the first leaked tag or scanning mid-line backtick runs corrupts valid Markdown prose and earlier code blocks. Always derive fenced block spans from `scanMarkdownCodeFences` in `features/chat/ui/md/stream.ts`.
- Posting `@codeant-ai review` while CodeAnt's automatic incremental push review is still running can leave the nitpick comment anchored to the previous commit. Wait until CodeAnt marks its push review complete before posting a manual tag if one is still needed.
- Waiting for `check-runs` to reach the full `pull_request` workflow count while `mergeStateStatus` is `DIRTY` loops forever, because GitHub Actions does not trigger `pull_request` workflows when the base branch advances into a merge conflict. Break out of CI polling immediately when `mergeable` is `CONFLICTING` or `mergeStateStatus` is `DIRTY`.
