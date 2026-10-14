/**
 * Secret and PII scrubbing for text that stays on the machine: copied logs,
 * diagnostics dumps, anything rendered back to the user. There is no analytics
 * backend to protect here — this exists so secrets never reach the user.
 */

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const HOME_PATH_RE =
  /(?:[A-Z]:\\Users\\[^\\]+|\/Users\/[^/]+|\/home\/[^/]+|C:\\Users\\[^\\]+)/gi;

export function redactSecrets(input: string, max = 8000): string {
  return input
    .replace(EMAIL_RE, "[email]")
    .replace(HOME_PATH_RE, "~")
    .replace(/sk-[a-zA-Z0-9_-]{10,}/g, "[key]")
    .replace(/ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/g, "[key]")
    .replace(/AKIA[0-9A-Z]{16}/g, "[key]")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[token]")
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [token]")
    .replace(
      /\b([a-z0-9_-]*(?:password|passwd|pwd|token|secret|api[_-]?key))(["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s"',}]+)/gi,
      "$1$2[redacted]",
    )
    .replace(/\/[^\s'"]+\/[^\s'"]+\/[^\s'"]+/g, (m) => {
      const parts = m.split("/");
      return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : m;
    })
    .slice(0, max);
}
