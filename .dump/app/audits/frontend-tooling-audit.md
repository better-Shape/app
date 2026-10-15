# Frontend tooling audit

The npm audit on 2026-10-15 reports five high-severity package entries caused by one advisory, [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). The advisory describes a stack overflow in recursive brace-pattern processing and lists no patched release.

The installed dependency path is `eslint-config-next@16.4.0` to `@next/eslint-plugin-next@16.4.0`, `fast-glob@3.3.1`, `micromatch@4.0.8`, and `braces@3.0.3`. This is a development-tooling dependency path. `npm audit --omit=dev --audit-level=high` reports zero vulnerabilities for the resolved production dependency tree. That narrower result does not make the full audit green.

The npm remediation suggests downgrading `eslint-config-next` to 14.2.35, a major-version mismatch with the current Next.js toolchain. No forced downgrade, fake patched version, scanner suppression or removal of framework lint rules was applied. The full security gate remains blocked until an upstream fix or a reviewed compatible replacement exists.

Primary evidence is the GitHub global-advisory response for the named GHSA and the installed `npm ls braces micromatch fast-glob --all` dependency trace. The advisory's `first_patched_version` is null. A new audit and advisory check are required when this dependency chain changes.
