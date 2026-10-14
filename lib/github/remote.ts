export type GitHubRepo = { owner: string; repo: string };

/** Only github.com remotes can be sent to the public GitHub API proxy. */
export function parseGitHubRemote(remote: string | null | undefined): GitHubRepo | null {
    if (!remote) return null;
    const value = remote.trim();
    let pathname: string;
    const scp = value.match(/^(?:[^@\s]+@)?github\.com:([^\s]+)$/i);
    if (scp) pathname = scp[1];
    else {
        try {
            const url = new URL(value);
            if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol)) return null;
            const github = url.hostname === "github.com";
            const sshGateway = url.protocol === "ssh:" && url.hostname === "ssh.github.com";
            if ((!github && !sshGateway) || url.search || url.hash) return null;
            pathname = url.pathname;
        } catch { return null; }
    }
    const match = pathname.replace(/^\//, "").replace(/\/$/, "").match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
    if (!match) return null;
    const [, owner, rawRepo] = match;
    const repo = rawRepo.replace(/\.git$/, "");
    if (!owner || !repo || [owner, repo].some((part) => part === "." || part === "..")) return null;
    return { owner, repo };
}
