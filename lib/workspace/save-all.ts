export interface SaveAllRequestDetail {
    waitUntil: (save: Promise<void>) => void;
}

/** Closing needs save acknowledgements, not a delay after dispatching an event. */
export function requestSaveAll(): Promise<boolean> {
    return new Promise((resolve) => {
        const finish = (saved: boolean) => { clearTimeout(timer); resolve(saved); };
        const timer = setTimeout(() => finish(false), 60_000);
        const saves: Promise<void>[] = [];
        const detail: SaveAllRequestDetail = { waitUntil: (save) => { saves.push(save); } };
        window.dispatchEvent(new CustomEvent("save-all-request", { detail }));
        if (saves.length === 0) { finish(false); return; }
        void Promise.all(saves).then(() => finish(true), () => finish(false));
    });
}
