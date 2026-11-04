/**
 * Shared scaffolding for mounting the real CodeMirror editor in jsdom.
 *
 * Every editor test needs the same three things: a host element, a root that
 * survives a re-render with new content, and the refs the viewer passes down.
 * Keeping that here means a test only writes the behaviour it is about.
 */
import { act, Suspense } from "react";
import { EditorView } from "@codemirror/view";
import { createRoot, type Root } from "react-dom/client";
import { CodeMirrorEditor } from "@/features/editor/ui/codemirror/editor";

export type EditorRefs = {
    saved: { current: string };
    dirty: { current: boolean };
    version: { current: number };
};

export type EditorHarness = {
    readonly host: HTMLDivElement;
    readonly refs: EditorRefs;
    /** Renders the editor with `content` on screen and `diskContent` in the baseline. */
    render: (content: string, diskContent?: string) => Promise<void>;
    /** Renders, waits for the mount work, and focuses the view. */
    mount: (content: string, diskContent?: string) => Promise<EditorView>;
    view: () => EditorView;
    unmount: () => void;
};

export function createEditorHarness(path = "/repo/file.txt"): EditorHarness {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    const refs: EditorRefs = { saved: { current: "" }, dirty: { current: false }, version: { current: 0 } };

    const render = async (content: string, diskContent = "") => {
        refs.saved.current = diskContent;
        await act(async () => {
            root.render(
                <Suspense fallback={null}>
                    <CodeMirrorEditor
                        path={path}
                        content={content}
                        setContent={() => undefined}
                        savedContentRef={refs.saved}
                        isDirtyRef={refs.dirty}
                        bufferVersionRef={refs.version}
                    />
                </Suspense>,
            );
        });
    };

    const view = () => {
        const element = host.querySelector(".cm-editor");
        if (!(element instanceof HTMLElement)) throw new Error("Editor did not mount");
        const found = EditorView.findFromDOM(element);
        if (!found) throw new Error("Editor view is missing");
        return found;
    };

    const mount = async (content: string, diskContent = "") => {
        await render(content, diskContent);
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
        });
        const mounted = view();
        await act(async () => {
            mounted.dom.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        });
        return mounted;
    };

    const unmount = () => {
        act(() => root.unmount());
        host.remove();
    };

    return { host, refs, render, mount, view, unmount };
}
