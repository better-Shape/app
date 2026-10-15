#!/usr/bin/env python3
"""
Move every BUTTON in the app from the row hover rung to the button rung.

Material 3 puts a button's hover state layer at 8% for every variant, filled, outlined,
text, icon, and reserves the lower values for list items and rows. This app gave the two
the same value, which is why a 28px icon and a 200px row reacted identically and why the
sessions cluster read as having no hover state at all on a dark panel.

The classification below is explicit because it is a judgment call per site and no
heuristic can make it. `row` entries are repeating list items, tree rows, menu rows and
status-bar segments: they keep `--row-hover`, because a row's hover has to stay at half of
the row's committed fill for the anticipation to mean anything.
"""
import re
import pathlib
from collections import defaultdict

# Sites that are buttons: a discrete control the user presses, not a repeating item.
BUTTON_SITES = {
    "components/ui/button.tsx": "ALL",
    "components/ui/morph-menu.tsx": [100],
    "components/layout/error/crash-screen.tsx": [196],
    "features/agent/chrome.tsx": [56, 225],
    "features/agent/sidebar/chats.tsx": [174, 184, 187],
    "features/agent/sidebar/collection-dialog.tsx": [160, 196],
    "features/agent/sidebar/index.tsx": [187],
    "features/agent/workbench/status/ui/copy-button.tsx": [21],
    "features/agent/workbench/titlebar/ui/layout-controls.tsx": [7],
    "features/agent/workbench/titlebar/ui/titlebar.tsx": [100],
    "features/agent/workbench/titlebar/ui/update-button.tsx": [47, 70],
    "features/agent/workbench/titlebar/ui/window-controls.tsx": [113, 121],
    "features/agent/workspace/browser.tsx": [1123, 1230],
    "features/agent/workspace/commit-menu.tsx": [551],
    "features/agent/workspace/file-bar.tsx": [33],
    "features/agent/workspace/file-diff.tsx": [181, 202],
    "features/agent/workspace/tool.tsx": [30],
    "features/chat/ui/blocks/gallery.tsx": [337, 345, 358, 369],
    "features/chat/ui/blocks/search.tsx": [383],
    "features/chat/ui/blocks/terminal-live.tsx": [246],
    "features/chat/ui/composer/activity.tsx": [38],
    "features/chat/ui/composer/edits.tsx": [55, 74],
    "features/chat/ui/composer/queue.tsx": [47],
    "features/chat/ui/composer/usage.tsx": [87],
    "features/chat/ui/shell/history.tsx": [180],
    "features/chat/ui/shell/open-in.tsx": [115],
    "features/git/ui/graph/filter-menu.tsx": [34],
    "features/git/ui/graph/graph.tsx": [868, 873, 887, 901, 915],
    "features/git/ui/manager/git-manager-trigger.tsx": [17],
    "features/git/ui/shared/generate-star.tsx": [80],
    "features/git/ui/source/source.tsx": [1235, 1240, 1245, 1250],
    "features/panels/ui/sidebar-panel-header.tsx": [67],
    "features/preview/design/bottom-toolbar.tsx": [57],
    "features/preview/design/panel/field.tsx": [187],
    "features/settings/ui/sections/shortcuts.tsx": [371, 379],
    "features/terminal/ui/terminal.tsx": [1104],
}

# Sites deliberately left on the row rung, recorded so the decision is reviewable.
ROW_SITES = {
    "features/agent/workspace/browser.tsx": [700, 726],          # result cards in a list
    "features/agent/workspace/tree.tsx": [156, 224],             # file tree rows
    "features/agent/sidebar/sections.tsx": [424, 654, 855],      # chat rows, shelf header
    "features/agent/sidebar/agent-tabs-chip.tsx": [46, 72],      # rows
    "components/ui/collapsible.tsx": [58],                       # section header
    "features/chat/ui/blocks/questions.tsx": [219],              # option rows
    "features/chat/ui/composer/mentions.tsx": [490, 514, 549],   # suggestion rows
    "features/command-palette/cmd-palette.tsx": [687],           # result rows
    "features/git/ui/actions/console.tsx": [522, 909],           # log rows
    "features/git/ui/graph/commit-row.tsx": [164],               # commit rows
    "features/git/ui/github/detail/index.tsx": [849, 976, 1075, 1117, 1205, 1254],
    "features/git/ui/source/source.tsx": [233, 276],             # tree rows
    "features/agent/workbench/status/ui/status.tsx": [144],      # status segments
    "features/agent/workbench/status/ui/status-item.tsx": [24],
    "features/editor/ui/main/ui/breadcrumb.tsx": [291, 347],     # breadcrumb chips
    "components/ui/checkmark.tsx": [34],
    "features/chat/ui/md/diff.tsx": [244],
}

REPLACEMENTS = [
    (re.compile(r"hover:bg-panel-hover(?!/)"), "hover:bg-[var(--btn-hover)]"),
    (re.compile(r"hover:bg-\[var\(--row-hover\)\]"), "hover:bg-[var(--btn-hover)]"),
]


def main() -> None:
    changed = defaultdict(list)
    for path, spec in BUTTON_SITES.items():
        p = pathlib.Path(path)
        lines = p.read_text().split("\n")
        targets = range(1, len(lines) + 1) if spec == "ALL" else spec
        for i in targets:
            if i > len(lines):
                print(f"  !! {path}:{i} is past the end of the file ({len(lines)} lines)")
                continue
            before = lines[i - 1]
            for pattern, repl in REPLACEMENTS:
                lines[i - 1] = pattern.sub(repl, lines[i - 1])
            if lines[i - 1] != before:
                changed[path].append(i)
        p.write_text("\n".join(lines))

    total = sum(len(v) for v in changed.values())
    print(f"{total} button lines moved to the button rung, in {len(changed)} files\n")
    for path in sorted(changed):
        print(f"  {path}  ({len(changed[path])})")

    # Audit: nothing in the row list may have been touched, and nothing may be left on
    # the row rung that the classification called a button.
    print("\n── auditing")
    leaked = []
    for path, lines in ROW_SITES.items():
        src = pathlib.Path(path).read_text().split("\n")
        for i in lines:
            if i <= len(src) and "var(--btn-hover)" in src[i - 1]:
                leaked.append(f"{path}:{i}")
    print(f"   row sites that accidentally moved: {leaked or 'none'}")
    missed = []
    for path, spec in BUTTON_SITES.items():
        if spec == "ALL":
            if "var(--btn-hover)" not in pathlib.Path(path).read_text():
                missed.append(f"{path} (none)")
            continue
        src = pathlib.Path(path).read_text().split("\n")
        for i in spec:
            if i <= len(src) and "var(--btn-hover)" not in src[i - 1] and "btn-hover" not in "\n".join(src[i - 1 : i + 2]):
                missed.append(f"{path}:{i}")
    print(f"   button sites still on a row tone:   {missed or 'none'}")


if __name__ == "__main__":
    main()
