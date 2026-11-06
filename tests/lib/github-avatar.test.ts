import { describe, expect, it } from "vitest";
import { resolveGithubAvatarUrl } from "@/lib/git/github-avatar";
import { getSettings, resetSettings } from "@/lib/settings";

describe("commit author avatars", () => {
    it("resolves only a GitHub noreply address, the one that names an account for certain", () => {
        expect(resolveGithubAvatarUrl("12345+octo-cat@users.noreply.github.com", 40)).toBe(
            "https://github.com/octo-cat.png?size=40",
        );
        expect(resolveGithubAvatarUrl("octo-cat@users.noreply.github.com", 32)).toBe(
            "https://github.com/octo-cat.png?size=32",
        );
        // A personal address names no GitHub account, and nothing guesses one.
        expect(resolveGithubAvatarUrl("alex@example.com", 40)).toBeNull();
        expect(resolveGithubAvatarUrl(undefined, 40)).toBeNull();
    });

    it("waits for the user to turn avatars on, since they load from github.com", () => {
        resetSettings();
        expect(getSettings().git.graphAvatars).toBe(false);
    });
});
