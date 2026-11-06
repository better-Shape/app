import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { Checkmark } from "@/components/ui/checkmark";
import { Switch } from "@/components/ui/switch";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CollectionDialog } from "@/features/agent/sidebar/collection-dialog";
import { ComposerRightActions } from "@/features/chat/ui/composer/input-controls";
import { contrastRatio, cssToken } from "../helpers/contrast";

/** Variants with a solid `--accent` or `--danger` fill. */
const FILLED: ButtonVariant[] = ["default", "confirm", "destructive", "danger"];
/** Variants on a dark surface or no fill, where the shared ring already holds 3:1. */
const UNFILLED: ButtonVariant[] = ["secondary", "ghost", "outline", "link"];

/** The ring utility a filled face adds over the shared `--accent-text` ring. */
const LABEL_RING = "focus-visible:outline-current";

/** The classes of the first element in server-rendered markup. */
const classesOf = (markup: string): string[] => /class="([^"]*)"/.exec(markup)?.[1].split(/\s+/) ?? [];

/** The classes of the composer's Send button, idle or ready to send. */
const sendButtonClasses = (sendActive: boolean): string[] => {
    const markup = renderToString(
        <TooltipProvider>
            <ComposerRightActions
                showExpandButton={false}
                isExpanded={false}
                onToggleExpand={() => undefined}
                canStop={false}
                isPreparing={false}
                isLoading={false}
                sendDisabled={!sendActive}
                sendActive={sendActive}
                onStopMessage={() => undefined}
                onSendWithHistory={() => undefined}
            />
        </TooltipProvider>,
    );
    const tag = /<button[^>]*aria-label="Send"[^>]*>/.exec(markup)?.[0];
    if (!tag) throw new Error("no Send button rendered");
    return classesOf(tag);
};

describe("filled control focus ring", () => {
    it("draws the ring in the label colour on every filled button face", () => {
        for (const variant of FILLED) {
            expect(classesOf(renderToString(<Button variant={variant}>Save</Button>)), variant).toContain(LABEL_RING);
        }
    });

    it("keeps the shared ring on unfilled faces and on the tertiary category, which drops the fill", () => {
        for (const variant of UNFILLED) {
            expect(classesOf(renderToString(<Button variant={variant}>Save</Button>)), variant).not.toContain(LABEL_RING);
        }
        for (const variant of FILLED) {
            const markup = renderToString(
                <Button variant={variant} category="tertiary">
                    Save
                </Button>,
            );
            expect(classesOf(markup), `tertiary ${variant}`).not.toContain(LABEL_RING);
        }
    });

    it("draws the ring in the label colour when an error turns a button destructive", () => {
        const markup = renderToString(
            <Button variant="ghost" status="error">
                Retry
            </Button>,
        );
        expect(classesOf(markup)).toContain(LABEL_RING);
    });

    it("rings the composer's Send button in its label colour once it can send", () => {
        const ready = sendButtonClasses(true);
        expect(ready).toContain("bg-accent");
        expect(ready).toContain(LABEL_RING);
        expect(sendButtonClasses(false)).not.toContain(LABEL_RING);
    });

    it("rings the collection dialog's filled step button in its label colour", () => {
        const host = document.createElement("div");
        document.body.append(host);
        const root = createRoot(host);
        try {
            act(() => root.render(<CollectionDialog chatIds={["chat-1"]} onClose={() => undefined} />));
            const next = [...document.querySelectorAll("button")].find((button) => button.textContent === "Next");
            expect(next?.className.split(/\s+/)).toEqual(expect.arrayContaining(["bg-accent", LABEL_RING]));
        } finally {
            act(() => root.unmount());
            host.remove();
        }
    });

    it("turns the ring of a checked switch and a ticked checkmark white", () => {
        expect(classesOf(renderToString(<Switch checked aria-label="Sync" />))).toContain(
            "data-[state=checked]:focus-visible:ring-accent-fg",
        );
        const ticked = classesOf(renderToString(<Checkmark checked label="Done" />));
        expect(ticked).toContain("focus-visible:ring-accent-fg");
        expect(ticked).not.toContain("focus-visible:ring-border-focus");
        const empty = classesOf(renderToString(<Checkmark checked={false} label="Done" />));
        expect(empty).toContain("focus-visible:ring-border-focus");
        expect(empty).not.toContain("focus-visible:ring-accent-fg");
    });

    it("holds 3:1 against each fill and against the page, where the shared ring does not", () => {
        const sharedRing = cssToken("--accent-text");
        // `--action-label` is the filled label, at every size now that `text-base` sets no colour.
        for (const label of ["--action-label"]) {
            for (const fill of ["--accent", "--accent-hover", "--danger"]) {
                expect(contrastRatio(cssToken(label), cssToken(fill)), `${label} on ${fill}`).toBeGreaterThanOrEqual(3);
            }
            for (const surface of ["--surface-1", "--surface-2", "--surface-3"]) {
                expect(contrastRatio(cssToken(label), cssToken(surface)), `${label} on ${surface}`).toBeGreaterThanOrEqual(3);
            }
        }
        for (const fill of ["--accent", "--accent-hover", "--danger"]) {
            expect(contrastRatio(sharedRing, cssToken(fill)), fill).toBeLessThan(3);
        }
    });
});
