import { describe, expect, it } from "vitest";
import { parseGitHubRemote } from "@/lib/github/remote";
describe("GitHub remote parsing", () => {
    it.each([
        "https://github.com/owner/repo.git", "git@github.com:owner/repo.git",
        "ssh://git@github.com/owner/repo.git", "ssh://git@ssh.github.com:443/owner/repo.git",
        "https://github.com/owner/repo/", "git://github.com/owner/repo.git",
    ])("recognizes %s", (remote) => expect(parseGitHubRemote(remote)).toEqual({ owner: "owner", repo: "repo" }));
    it.each([
        "https://gitlab.com/owner/repo.git", "git@gitlab.com:owner/repo.git",
        "https://notgithub.com/owner/repo.git", "https://github.com.evil.test/owner/repo.git",
        "file:///owner/repo.git", "C:\\owner\\repo.git", "/owner/repo.git",
        "https://github.com/owner/repo/pulls", "https://github.com/owner/repo?query=yes",
        "https://github.com/owner/repo#fragment", "https://github.com/owner/%2e%2e", null,
    ])("does not route %s to the public GitHub API", (remote) => expect(parseGitHubRemote(remote)).toBeNull());
});
