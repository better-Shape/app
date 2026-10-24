# Running the Playwright suite in a sandbox where the browser CDN is blocked

## Conclusion

The e2e suite in this repository is runnable in a sandbox that cannot reach
`cdn.playwright.dev`. Do not report it as unrunnable. `@sparticuz/chromium` is
already a devDependency, its npm tarball carries a complete Chromium build plus
the NSS/NSPR shared libraries, and `registry.npmjs.org` is normally reachable
when the browser CDN is not. `playwright.config.ts` already knows how to use it.

Verified on 2026-10-24: the full CI command passed locally, 22 tests, 36.8s,
with Chromium 153.0.8010.0.

## What is blocked and what is not

`npx playwright install chromium` fails: Playwright 1.64.1 wants Chrome for
Testing 156.0.8078.4 (chromium v1248) from `cdn.playwright.dev`, outside the
allowlist. Job logs and CI artifacts are also unreachable, both redirecting to
`*.blob.core.windows.net`, so a CI-only failure cannot be read from its logs or
from its uploaded `playwright-report`. That combination is what makes local
execution the only practical way to diagnose an e2e failure.

## Recipe

```bash
npm pack @sparticuz/chromium          # 70 MB tarball from registry.npmjs.org
tar xzf sparticuz-chromium-*.tgz -C chr
```

The tarball's `package/bin/` holds brotli-compressed payloads, not Lambda-only
artifacts:

| file | decompresses to |
| --- | --- |
| `chromium.br` | a 209 MB ELF executable, Chromium 153.0.8010.0 |
| `al2023.tar.br` | a tar with `lib/libnss3.so`, `libnspr4.so`, `libnssutil3.so`, `libplc4.so`, `libplds4.so`, `libfreebl3.so`, `libsoftokn3.so`, `libexpat.so.1` |
| `swiftshader.tar.br`, `fonts.tar.br` | software GL and fonts, not needed for this suite |

Node decompresses brotli without any extra binary, which matters because the
sandbox has no `brotli` and no `apt`:

```js
const z = require("zlib"), fs = require("fs");
fs.writeFileSync(out, z.brotliDecompressSync(fs.readFileSync(inp)));
```

`al2023.tar` supplies exactly the three libraries the Chromium binary misses on
a bare image. Without them it dies with
`error while loading shared libraries: libnspr4.so`; with
`LD_LIBRARY_PATH` pointed at them, `./chromium --version` prints
`Chromium 153.0.8010.0` and `ldd` reports nothing unresolved. They are Amazon
Linux 2023 builds and work on a plain glibc container.

## Letting the repo's own config resolve it

`playwright.config.ts` already implements this fallback, so no override and no
config edit is needed:

- `resolveChromium()` tries `PLAYWRIGHT_CHROMIUM_PATH`, then Playwright's own
  downloaded browser (probed with `--version`, because existence is not
  usability), then `sandboxChromium()`.
- `sandboxChromium()` requires Linux and Node `^22.17.0 || >=24.0.0`, then asks
  `@sparticuz/chromium` for its executable path and returns
  `["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"]`.
- `PLAYWRIGHT_SANDBOX_LIBS` is prepended to `LD_LIBRARY_PATH` for the browser
  child only, deliberately never for this process, so the dev server the config
  starts does not inherit browser-only libraries.

The `--no-sandbox` args are why the automatic path beats setting
`PLAYWRIGHT_CHROMIUM_PATH` by hand: the explicit override returns no args, and a
containerised Chromium without `--no-sandbox` will not start.

So the working invocation is:

```bash
npm run build:preview
E2E_STATIC=1 PLAYWRIGHT_SANDBOX_LIBS=<dir>/al2023/lib \
  ./node_modules/.bin/playwright test --grep-invert @visual
```

`@sparticuz/chromium` may be missing from `node_modules` even though it is a
non-optional devDependency at `^153.0.0` and present in `package-lock.json`.
`npm ci --ignore-scripts` has twice reported success while leaving packages
absent, so verify the directory exists and install with
`npm install @sparticuz/chromium --no-save` if it does not. `--no-save` keeps
`package.json` and the lockfile untouched; confirm with `git status` afterwards.

## Reading a failure once it runs locally

`e2e/audit.spec.ts` writes `test-results/browser-audit.json` and attaches it.
The current version records, per route, each axe violation with `targets`, the
axe selector for every failing node. The version at `d49de661` recorded counts
only, no `targets`, so an old baseline cannot tell you which node it pinned.
Where the recorded data is not enough, a throwaway spec that calls
`runAxeAudit(page)` and prints `node.target`, `node.html` and
`node.failureSummary` gives the selectors, the measured pixel size and the rule's
own explanation. Delete it afterwards and confirm with `git status`.

`failureSummary` is the most useful field: it names both the size and the
spacing branch of WCAG 2.5.8 and prints the computed safe-clickable diameter,
which identifies the constraining neighbour.

## Related

`git-stage-checkbox-target-size-regression-2026-10-24.md` for the defect this
harness was built to diagnose.
`../audits/native-toolchain-and-cross-target-verification.md` for the Rust
analogue of the same trick, republished toolchains on the npm registry, and for
why that one cannot verify a deprecation newer than the version it ships.
