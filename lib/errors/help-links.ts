/**
 * Help links. There is no hosted docs site any more — everything points at
 * the public repository so the app stays usable offline and self-built.
 */

export const REPO_URL = "https://github.com/Owie6789/Shape";

export const HELP_LINKS = {
  documentation: `${REPO_URL}#readme`,
  changelog: `${REPO_URL}/releases`,
  reportIssue: `${REPO_URL}/issues/new`,
  license: `${REPO_URL}/blob/main/LICENSE`,
  privacy: `${REPO_URL}/blob/main/docs/privacy.md`,
  download: `${REPO_URL}/releases`,
} as const;
