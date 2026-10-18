/**
 * Privacy filter for user-visible text: problem reports, copied logs, and any
 * transcript snippet the app hands to the user.
 *
 * BetterShape ships no analytics and no error-reporting backend, so this runs on
 * content that stays on the machine.
 *
 * This is the only scrubber. A second one existed at lib/secret-scrub.ts with a
 * narrower secret pattern -- it missed PEM private key blocks, Stripe (`whsec_`),
 * and PingFederate/Okta (`pk_`/`rk_`) keys -- so anyone who reached for the
 * wrong one would have shipped credentials into a copied log. The extra rule it
 * had, shortening deep filesystem paths, is folded in below.
 */

const EMAIL_RE = /(?<![a-zA-Z0-9._%+-])[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const HOME_PATH_RE =
  /(?:[A-Z]:\\Users\\[^\\]+|\/Users\/[^/]+|\/home\/[^/]+|C:\\Users\\[^\\]+)/gi;
const SECRET_RE =
  /(?:(?:sk|pk|rk|whsec|api)[_-](?:live|test)?[_-]?[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+|-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----)/gi;
const SECRET_KV_RE =
  /\b([a-z0-9_-]*(?:password|passwd|pwd|token|secret|api[_-]?key))(["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s"',}]+)/gi;

export function redactText(input: string, max = 2000): string {
  return input
    .replace(EMAIL_RE, "[email]")
    .replace(HOME_PATH_RE, "~")
    .replace(SECRET_RE, "[redacted]")
    .replace(SECRET_KV_RE, "$1$2[redacted]")
    .replace(/\/[^\s'"]+\/[^\s'"]+\/[^\s'"]+/g, (m) => {
      const parts = m.split("/");
      return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : m;
    })
    .slice(0, max);
}

export function redactChatForReport(
  messages: { role?: string; content?: string }[],
  maxMessages = 40,
  maxChars = 12000,
): { role: string; content: string }[] {
  const out: { role: string; content: string }[] = [];
  let used = 0;
  for (const msg of messages.slice(-maxMessages)) {
    const role = msg.role === "assistant" ? "assistant" : "user";
    let content = redactText(String(msg.content ?? ""), 800);
    if (used + content.length > maxChars) {
      content = content.slice(0, Math.max(0, maxChars - used));
    }
    if (!content) continue;
    out.push({ role, content });
    used += content.length;
    if (used >= maxChars) break;
  }
  return out;
}
