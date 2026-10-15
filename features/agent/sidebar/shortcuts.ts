import { primaryModifier } from "@/lib/platform";

/** Include the legacy IME keycode used before browsers expose isComposing reliably. */
export function isComposingKey(event: KeyboardEvent): boolean {
    return event.isComposing || event.keyCode === 229;
}

/** Text editors own their shortcuts, including events originating from nested markup. */
function isTextEditingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    if (target instanceof HTMLElement && target.isContentEditable) return true;
    return Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'));
}

/** Reserved, modified and composition keystrokes must never become sidebar commands. */
function isAvailableKey(event: KeyboardEvent): boolean {
    return !event.defaultPrevented && !event.altKey && !event.shiftKey && !isComposingKey(event);
}

/** Resolve the platform's primary modifier without changing the secondary-modifier policy. */
function hasPrimaryModifier(event: KeyboardEvent): boolean {
    return primaryModifier() === "meta" ? event.metaKey : event.ctrlKey;
}

/** Shared ownership gate for global sidebar undo and numbered navigation. */
export function isSidebarShortcut(event: KeyboardEvent): boolean {
    return isAvailableKey(event) && hasPrimaryModifier(event) && !isTextEditingTarget(event.target);
}
