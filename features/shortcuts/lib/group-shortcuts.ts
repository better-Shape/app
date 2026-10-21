import type { KeyBinding } from "@/lib/ui/shortcuts";

export type ShortcutGroup = { category: string; list: KeyBinding[] };

/**
 * Group the effective keybindings for the cheatsheet, filtering by label, chord
 * or category. Empty chords stay visible (they can still be filtered by label)
 * so the reference doubles as a list of unassigned commands.
 */
export function groupShortcuts(bindings: readonly KeyBinding[], query: string): ShortcutGroup[] {
    const needle = query.trim().toLowerCase();
    const filtered = needle
        ? bindings.filter(
            (binding) =>
                binding.label.toLowerCase().includes(needle)
                || binding.key.toLowerCase().includes(needle)
                || binding.category.toLowerCase().includes(needle),
        )
        : bindings;

    const byCategory = new Map<string, KeyBinding[]>();
    for (const binding of filtered) {
        const list = byCategory.get(binding.category) ?? [];
        list.push(binding);
        byCategory.set(binding.category, list);
    }

    return [...byCategory.entries()]
        .map(([category, list]) => ({
            category,
            list: [...list].sort((a, b) => a.label.localeCompare(b.label)),
        }))
        .sort((a, b) => a.category.localeCompare(b.category));
}

export function countBoundShortcuts(bindings: readonly KeyBinding[]): number {
    return bindings.reduce((total, binding) => (binding.key.trim() ? total + 1 : total), 0);
}
