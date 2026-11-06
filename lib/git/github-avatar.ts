/** GitHub avatar URLs for commit authors whose email is a GitHub noreply address. */

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

/** Parse GitHub noreply addresses into a login. */
export function githubLoginFromEmail(email: string | null | undefined): string | null {
    if (!email) return null;
    const e = normalizeEmail(email);
    // 123456+login@users.noreply.github.com or login@users.noreply.github.com
    const m = e.match(
        /^(?:\d+\+)?([a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38})@users\.noreply\.github\.com$/i,
    );
    if (m) return m[1];
    return null;
}

export function githubAvatarUrlForLogin(login: string, size = 64): string {
    return `https://github.com/${encodeURIComponent(login)}.png?size=${size}`;
}

/**
 * Resolve a GitHub avatar URL from a commit author's GitHub noreply email, the one address that
 * names a GitHub account for certain. A display name is not used: "alex" would draw the picture of
 * whoever owns the github.com/alex account. Callers draw it only while the user has turned
 * avatars on, since it loads from github.com.
 */
export function resolveGithubAvatarUrl(email: string | null | undefined, size = 64): string | null {
    const login = githubLoginFromEmail(email);
    return login ? githubAvatarUrlForLogin(login, size) : null;
}
