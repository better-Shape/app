/**
 * What a window can ask its titlebar to be.
 *
 * There is no back control here: the two callers are the chat window in focus mode and a
 * settings window that names itself, and neither has anywhere to go back to.
 */
export type TitlebarProps = {
    onboarding?: boolean;
    settings?: boolean;
    focus?: boolean;
    title?: string;
};

export type MenuActionContext = {
    projectPath: string | null;
    activeFile: string | null;
    openFiles: { path: string; is_dirty: boolean }[];
    readLatestContent: (path: string) => Promise<string>;
    closeWindow: () => void;
};
