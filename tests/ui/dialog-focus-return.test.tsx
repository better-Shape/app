import * as Dialog from "@radix-ui/react-dialog";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDialogFocusReturn } from "@/lib/ui/use-dialog-focus-return";

let host: HTMLDivElement;
let root: Root;

/** More rows than the focus history holds, as a long palette list has. */
const ROWS = Array.from({ length: 24 }, (_, index) => `Row ${index + 1}`);

/** A dialog opened from state, as a shortcut or menu event opens one: there is no `Dialog.Trigger`. */
const TriggerlessDialog = ({ open }: { open: boolean }) => {
    const returnFocus = useDialogFocusReturn();
    return (
        <>
            <button type="button">Opener</button>
            <button type="button">Elsewhere</button>
            <Dialog.Root open={open}>
                <Dialog.Portal>
                    <Dialog.Content aria-describedby={undefined} onCloseAutoFocus={returnFocus}>
                        <Dialog.Title>Picker</Dialog.Title>
                        <input aria-label="Filter" />
                        {ROWS.map((row) => (
                            <button key={row} type="button">
                                {row}
                            </button>
                        ))}
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>
        </>
    );
};

const button = (name: string) =>
    [...host.querySelectorAll("button")].find((element) => element.textContent === name) as HTMLButtonElement;

/** Radix moves focus after the dialog unmounts, from a zero-delay timer. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

const renderDialog = (open: boolean) => act(async () => root.render(<TriggerlessDialog open={open} />));

const openDialog = async () => {
    await renderDialog(true);
    await settle();
};

const closeDialog = () => renderDialog(false);

beforeEach(async () => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await renderDialog(false);
});

afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
});

describe("dialog focus return", () => {
    it("puts focus back on the control that had it when the dialog opened", async () => {
        button("Opener").focus();
        await openDialog();
        expect(document.activeElement?.getAttribute("aria-label")).toBe("Filter");

        await closeDialog();
        await settle();
        expect(document.activeElement).toBe(button("Opener"));
    });

    it("steps back to the menu button when the menu item that opened the dialog has gone", async () => {
        button("Opener").focus();
        const item = document.createElement("div");
        item.tabIndex = -1;
        item.textContent = "Open folder";
        document.body.append(item);
        item.focus();
        await openDialog();
        item.remove();

        await closeDialog();
        await settle();
        expect(document.activeElement).toBe(button("Opener"));
    });

    it("keeps the opener however many rows inside the dialog took focus", async () => {
        button("Opener").focus();
        await openDialog();
        for (const row of document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')) row.focus();

        await closeDialog();
        await settle();
        expect(document.activeElement).toBe(button("Opener"));
    });

    it("leaves focus where the dialog's action moved it", async () => {
        button("Opener").focus();
        await openDialog();

        await closeDialog();
        button("Elsewhere").focus();
        await settle();
        expect(document.activeElement).toBe(button("Elsewhere"));
    });

    it("keeps listening while any dialog host is mounted and stops with the last one", async () => {
        const removeListener = vi.spyOn(document, "removeEventListener");
        const otherHost = document.createElement("div");
        document.body.append(otherHost);
        const otherRoot = createRoot(otherHost);
        await act(async () => otherRoot.render(<TriggerlessDialog open={false} />));
        await act(async () => otherRoot.unmount());
        otherHost.remove();
        expect(removeListener).not.toHaveBeenCalledWith("focusin", expect.any(Function), true);

        button("Opener").focus();
        await openDialog();
        await closeDialog();
        await settle();
        expect(document.activeElement).toBe(button("Opener"));

        await act(async () => root.unmount());
        expect(removeListener).toHaveBeenCalledWith("focusin", expect.any(Function), true);
        removeListener.mockRestore();
        root = createRoot(host);
    });
});
