# Design and writing skills

Skills in this folder are checked in so every contributor (and every agent
session) works against the same rules. They are read by Claude Code from
`.claude/skills/<name>/SKILL.md`, and by any runtime that follows the same
`SKILL.md` convention.

## Installed

| Skill | Version | License | What it is for |
| --- | --- | --- | --- |
| `impeccable` | 4.5.2 | Apache-2.0 | Design direction, critique, audit, polish and the per-command playbooks (`shape`, `critique`, `audit`, `polish`, `bolder`, `quieter`, `distill`, `harden`, `onboard`, `animate`, `colorize`, `typeset`, `layout`, `delight`, `overdrive`, `clarify`, `adapt`, `optimize`, `live`, `generate`, `init`, `document`, `extract`). Source: [pbakaus/impeccable](https://github.com/pbakaus/impeccable), copied from its `.claude/skills/impeccable` runtime folder. |
| `antislop` | 3.2.20 | MIT | Core filter: 38 numbered rules in three tiers that keep generated UI and copy out of the default AI look. Source: [miqdadbadjuber/anti-slop](https://github.com/miqdadbadjuber/anti-slop). |
| `antislop-ui` | 3.2.20 | MIT | UI half of antislop: color, layout, components, decoration, motion. Loaded together with the core. |
| `antislop-code` | 3.2.20 | MIT | Code half: structure, naming, duplication, error handling. |
| `antislop-copywriting` | 3.2.20 | MIT | Interface copy: labels, empty states, errors, marketing lines. |
| `antislop-human` | 3.2.20 | MIT | Contrast and readability checks (ships `contrast-check.py`). |
| `antislop-layoutmobile` | 3.2.20 | MIT | Responsive and small-screen behaviour. |
| `unslop` | — | in-repo | Edits user-facing prose to remove formulaic AI phrasing. Invoked explicitly (`disable-model-invocation: true`). |

The antislop skills are a set: `antislop` is the core, the others reference its
rule numbers and never renumber them, so install them together and load the
core first.

## Notes

- `impeccable` drives its own workflow from `PRODUCT.md` and `DESIGN.md` in the
  project root plus the playbook under `reference/`. Its launcher
  (`scripts/impeccable`) is a self-contained binary that ships next to it or is
  fetched once on first run; nothing else in the skill needs a runtime.
- Renaming a skill folder changes how it is invoked, so keep the upstream names.
- These are development-time skills. The skills the app itself discovers for
  the agent live under `.bettershape/skills` and are unrelated to this folder.
