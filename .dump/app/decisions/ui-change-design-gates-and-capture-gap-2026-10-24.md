# UI change design gates and the capture attachment gap, 2026-10-24

## Decision

The `/git` stage-checkbox margin change ships with the delivery gates reported in
the PR body, a recorded capture in `.qa-artifacts/capture/`, and one gap recorded
here: the recording could not be attached to PR #52 from this sandbox.

## What changed

`features/git/ui/source/source.tsx`, the Source file row: the stage checkbox
wrapper's right margin `mr-1` (3.25px) to `mr-1.5` (4.875px). Nothing else. No
user-facing string, no token, no colour, no radius, no duration changed.

## Delivery gates, design-skills.md

1. **antislop Delivery Gate.** Mode 1 `During`, per `design-skills.md`, which
   overrides the skill's own ask-which-mode step.
   - `R-01` no generic template layout: PASS, one margin value on one existing
     row; no new container, card or wrapper introduced.
   - `R-02` no stock gradient or decoration: PASS, nothing decorative touched.
   - `R-03` no fake copy: PASS, no copy changed; the added code comment names the
     rule and the measurement instead of narrating intent.
   - `R-04` no placeholder or stub: PASS, the change is the fix itself.
2. **Baseline mirror check.** Matched `design-system-baseline.md` rule 1 (tokens
   only) and rule 12 (dense lists get less motion, not more: nothing about motion
   was touched). Deviation considered and not taken: the token utility `mr-sm`
   (8px) is the only margin-right token utility in `globals.css` and would also
   pass at a 32.25px safe diameter, but shifts the row 4.75px and breaks the
   row's existing two-value rhythm, since the icon wrapper two lines below
   already uses `mr-1.5`. DESIGN.md permits Tailwind's numeric scale explicitly,
   noting only that its values are rem based.
3. **unslop pass on copy.** No user-visible string changed. The only new prose
   is a JSX comment and these records, checked for sentence case and `...`.
4. **Motion check.** No timing added or changed. The row keeps its existing
   `transition-colors` and the tokens it already used; `app/transitions.css` is
   untouched.
5. **Accessibility pass.** The change exists for accessibility: the safe
   clickable diameter around the `role="checkbox"` control goes from 22.8px, a
   WCAG 2.2 SC 2.5.8 failure, to 26.0px. Focus ring, `aria-label` and keyboard
   path are unchanged because the element itself is unchanged. Verified by
   running `runAxeAudit` on `/git` before and after: 2 `target-size` nodes to 1,
   and the remaining node is the one the baseline pins.
6. **Skill report.** Loaded and read: `DESIGN.md` sections 3 and 4 plus the icon
   table; `engineering/design-system-baseline.md` in full;
   `engineering/design-skills.md` in full; `.agents/skills/ui-capture/SKILL.md`
   in full and its scripts were run; `impeccable/reference/craft-floor.md`;
   `antislop/SKILL.md` core; `ui-ux-pro-max/SKILL.md` rule table row 2 and the
   touch-target rows of `data/app-interface.csv`, which arbitrate per platform
   and warn against collapsing iOS 44pt, Android 48dp and web 24 CSS px into one
   number. Not loaded, with reason: `impeccable` proper, whose setup step curls a
   binary and is refused by `design-skills.md` execution limits, so only its
   `reference/` was read; `design-taste-frontend` and the style skills, which
   route landing and marketing surfaces and this is neither; `unslop` beyond its
   rules, since no user-facing string changed.
7. **Capture gate.** Ran, watched, and reported below.

## Capture

Recorded with `ui-capture` against `npm run dev:browser` on `127.0.0.1:48921`,
URL `/git?seed=project`, the schema's documented seed parameter. Eleven seconds,
330 encoded frames at 30fps, 1100x688, 313KB, well under GitHub's inline limit.
`validate.mjs` verdict PASS_WITH_WARNINGS; the only warning is that `tesseract`
is absent so captions were not OCR-read back, and the vision read stands in for
it.

Watched, per the skill's step 5. The twelve-frame inspect sheet shows the Git
manager intro, the Source list mounting with README.md staged and App.tsx
unstaged, the cursor gliding onto the App.tsx checkbox, the click, and the file
moving into "Staged Changes 2 files" with the checkbox filled. The full
resolution still confirms the cursor lands on the checkbox, not beside it, which
is the failure mode the skill names. Captions read as correct English in the
right order. Nothing in the frames hides a defect: the row highlight on hover
and the commit field behave as before.

## The gap: the recording is not attached to the PR

`AGENTS.md` line 329 and line 344 require attaching the GIF to the pull request.
`ui-capture` requires keeping the artifacts out of Git, and `.gitignore:56`
enforces that. No upload channel exists in this sandbox that satisfies both:
`gh gist create` refuses binary files, GitHub's comment attachment endpoint is
the web UI's, and a release or a committed copy would each violate a rule.

So the clip lives at `.qa-artifacts/capture/out.gif` on this working branch, is
described frame by frame in the PR body, and the maintainer can attach it by
dragging that one file into the PR. An honest gap, recorded, rather than a
committed artifact or a link that resolves to nothing.

## Toolchain note

`ffmpeg` and `ffprobe` came from the `@ffmpeg-installer/linux-x64` and
`@ffprobe-installer/linux-x64` npm packages, which bundle the binaries in their
tarballs, so no CDN was needed. `gifsicle` is not installable here: the npm
package vendors `gifsicle-1.93` *source* and this image has no autotools to
bootstrap it. `encode.mjs` treats it as optional and logged the substitution, so
the GIF is unoptimized at 313KB instead of smaller. See
`../research/playwright-in-a-cdn-blocked-sandbox-2026-10-24.md` for the Chromium
side of the same trick.
