import fs from "node:fs";
import path from "node:path";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationProvider } from "@/components/ui/notification";
import { TerminalDock } from "@/features/agent/terminal-dock";
import { ChatEmptyState } from "@/features/chat/ui/shell/empty";
import { shouldComposerBreakAll } from "@/features/chat/ui/composer/input";
import { notificationStore, notify } from "@/features/notifications";

vi.mock("@/features/terminal/ui/terminal", () => ({
    default: ({ isOpen }: { isOpen?: boolean }) => (
        <div data-testid="mock-xterm" data-open={String(Boolean(isOpen))} />
    ),
    refitAllTerminals: vi.fn(),
}));

vi.mock("@/lib/backend/project-state", () => ({
    useProjectState: () => ({ project_path: "/repo" }),
}));

vi.mock("@/lib/backend", () => ({
    commands: {
        openUrlExternal: vi.fn(),
    },
    getProjectPath: () => null,
}));

function mount(node: React.ReactNode): { host: HTMLDivElement; root: Root } {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
        root.render(node);
    });
    return { host, root };
}

function unmount(root: Root, host: HTMLDivElement) {
    act(() => {
        root.unmount();
    });
    host.remove();
}

describe("Composer leading-space wrapping guard (shouldComposerBreakAll)", () => {
    it("enables break-all when a line starts with space(s) followed by a long unbroken token", () => {
        expect(
            shouldComposerBreakAll(
                " ccfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            ),
        ).toBe(true);
        expect(
            shouldComposerBreakAll(
                "   https://github.com/better-Shape/app/pull/52/commits/7d073ac",
            ),
        ).toBe(true);
        expect(shouldComposerBreakAll("            indentedToken")).toBe(true);
    });

    it("preserves normal word-boundary wrapping for ordinary prose, even alongside indented lines", () => {
        expect(shouldComposerBreakAll("")).toBe(false);
        expect(
            shouldComposerBreakAll(
                "Map out a clean implementation plan for authentication and session recovery",
            ),
        ).toBe(false);
        expect(
            shouldComposerBreakAll(
                "Normal first line that wraps at word boundaries\n aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            ),
        ).toBe(false);
        expect(shouldComposerBreakAll(" hello world how are you")).toBe(false);
    });
});

describe("Empty-state animated mark (main-branch fidelity)", () => {
    it("renders /logos/logo_animated.svg cleanly without starter-marquee clutter", () => {
        const { host, root } = mount(<ChatEmptyState />);
        try {
            const img = host.querySelector<HTMLImageElement>("img[src='/logos/logo_animated.svg']");
            expect(img).toBeTruthy();
            expect(host.querySelector("img[src*='logo-mono']")).toBeNull();
            expect(host.querySelectorAll("button")).toHaveLength(0);
        } finally {
            unmount(root, host);
        }
    });

    it("logo_animated.svg keeps top and bottom masonry courses fixed and slides only Vector_3..Vector_6 inside clip0_68_233", () => {
        const svg = fs.readFileSync(
            path.join(process.cwd(), "public/logos/logo_animated.svg"),
            "utf8",
        );
        expect(svg).toContain('clipPath id="clip0_68_233"');
        expect(svg).toContain('id="Vector"');
        expect(svg).toContain('id="Vector_2"');
        expect(svg).toContain('id="Vector_7"');
        expect(svg).toContain("#Vector_3");
        expect(svg).toContain("#Vector_4");
        expect(svg).toContain("#Vector_5");
        expect(svg).toContain("#Vector_6");
        expect(svg).not.toMatch(/#Vector\s*\{/);
        expect(svg).not.toMatch(/#Vector_2\s*\{/);
        expect(svg).not.toMatch(/#Vector_7\s*\{/);
        expect(svg).not.toContain("<circle");
        expect(svg).toContain("prefers-reduced-motion: reduce");
    });
});

describe("Global action toasts: unclipped wrapping, inline actions, and hover-pause", () => {
    beforeEach(() => {
        notificationStore.clearAll();
    });

    afterEach(() => {
        notificationStore.clearAll();
    });

    it("renders long titles, multi-line descriptions, and action buttons without single-line truncate", () => {
        const onAction = vi.fn();
        const { host, root } = mount(
            <NotificationProvider>
                <div />
            </NotificationProvider>,
        );
        try {
            act(() => {
                notify.info(
                    "Pasted as attachment instead of flooding the inline composer",
                    "142 lines (5.4k chars) attached to keep the composer tidy.\nClick Insert inline to expand directly.",
                    {
                        action: {
                            label: "Insert inline",
                            onClick: onAction,
                        },
                    },
                );
            });

            const status = document.querySelector<HTMLElement>(
                "[data-toast-stack] [role='status']",
            );
            expect(status).toBeTruthy();
            const titleP = status?.querySelector("p");
            expect(titleP?.className).not.toContain("truncate");
            expect(titleP?.textContent).toBe(
                "Pasted as attachment instead of flooding the inline composer",
            );
            expect(status?.textContent).toContain("142 lines (5.4k chars)");

            const actionBtn = Array.from(status?.querySelectorAll("button") ?? []).find(
                (btn) => btn.textContent?.trim() === "Insert inline",
            );
            expect(actionBtn).toBeTruthy();

            act(() => {
                actionBtn?.click();
            });
            expect(onAction).toHaveBeenCalledTimes(1);
        } finally {
            unmount(root, host);
        }
    });

    it("pauses countdown animation while hovering the toast stack", () => {
        const { host, root } = mount(
            <NotificationProvider>
                <div />
            </NotificationProvider>,
        );
        try {
            act(() => {
                notify.success("Saved changes", "Updated composer curves.");
            });

            const stack = document.querySelector<HTMLElement>("[data-toast-stack]");
            expect(stack).toBeTruthy();
            const bar = stack?.querySelector<HTMLElement>(
                "[style*='bettershape-toast-countdown']",
            );
            expect(bar?.style.animationPlayState).toBe("running");

            act(() => {
                stack?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
            });
            expect(bar?.style.animationPlayState).toBe("paused");

            act(() => {
                stack?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
            });
            expect(bar?.style.animationPlayState).toBe("running");
        } finally {
            unmount(root, host);
        }
    });
});

describe("TerminalDock overlay suppression (Settings / overlay overlap guard)", () => {
    beforeEach(() => {
        localStorage.setItem("bettershape-agent-terminal-open", "true");
    });

    afterEach(() => {
        localStorage.removeItem("bettershape-agent-terminal-open");
    });

    it("collapses and hides TerminalDock when suppressed by Settings overlay, then restores cleanly", async () => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        const root = createRoot(host);
        await act(async () => {
            root.render(<TerminalDock suppressed={false} />);
        });
        try {
            const dock = host.querySelector<HTMLElement>("[data-terminal-dock]");
            expect(dock).toBeTruthy();
            expect(dock?.getAttribute("data-terminal-open")).toBe("true");
            expect(dock?.style.height).not.toBe("0px");

            // Opening Settings sets `suppressed={true}` while preserving the mounted terminal session
            await act(async () => {
                root.render(<TerminalDock suppressed />);
            });
            expect(dock?.getAttribute("data-terminal-open")).toBe("false");
            expect(dock?.getAttribute("aria-hidden")).toBe("true");
            expect(dock?.style.height).toBe("0px");
            expect(dock?.className).toContain("invisible");
            expect(dock?.className).toContain("pointer-events-none");
            expect(dock?.querySelector("[role='separator']")).toBeNull();

            // Closing Settings (`suppressed={false}`) restores the open terminal dock
            await act(async () => {
                root.render(<TerminalDock suppressed={false} />);
            });
            expect(dock?.getAttribute("data-terminal-open")).toBe("true");
            expect(dock?.getAttribute("aria-hidden")).toBe("false");
            expect(dock?.style.height).not.toBe("0px");
        } finally {
            unmount(root, host);
        }
    });
});
