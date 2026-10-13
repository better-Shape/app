/**
 * Problem reports (local).
 *
 * There is no report inbox any more, so a report is redacted, copied to the
 * clipboard and offered as a prefilled GitHub issue. Nothing leaves the machine
 * unless the user submits it themselves.
 */

import { commands } from "@/lib/backend";
import { REPO_URL } from "@/lib/errors/help-links";
import { redactChatForReport } from "@/lib/diagnostics/scrub";
import type { Conversation } from "@/lib/backend/types";

export const REPORT_CATEGORIES = [
  "Agent / AI",
  "Models & providers",
  "Plugins & Composio",
  "Web search",
  "MCPs & Skills",
  "Editor",
  "Git",
  "Terminal",
  "Performance",
  "Misc",
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

function buildReport(opts: {
  category: ReportCategory;
  message: string;
  conversation?: Conversation | null;
  version?: string;
}): string {
  const lines: string[] = [
    `## ${opts.category}`,
    "",
    opts.message.trim(),
    "",
    "### Environment",
    `- BetterShape: ${opts.version ?? "unknown"}`,
    `- Platform: ${typeof navigator !== "undefined" ? navigator.userAgent : "unknown"}`,
  ];
  if (opts.conversation) {
    const redacted = redactChatForReport(
      opts.conversation.history.map((m) => ({ role: m.role, content: m.content })),
    )
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");
    lines.push("", "### Chat context (redacted)", "```", redacted.slice(0, 4000), "```");
  }
  return lines.join("\n");
}

async function appVersion(): Promise<string> {
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return "unknown";
  }
}

/**
 * Copies the redacted report to the clipboard, then opens a prefilled GitHub
 * issue. Returns the issue URL so the caller can show it.
 */
export async function submitProblemReport(opts: {
  category: ReportCategory;
  message: string;
  conversation?: Conversation | null;
}): Promise<{ issueUrl: string }> {
  const body = buildReport({ ...opts, version: await appVersion() });
  try {
    await navigator.clipboard.writeText(body);
  } catch {
    /* clipboard is best-effort; the issue still opens with the text */
  }
  const issueUrl = `${REPO_URL}/issues/new?title=${encodeURIComponent(
    `[${opts.category}] `,
  )}&body=${encodeURIComponent(body.slice(0, 6000))}`;
  await commands.openUrlExternal(issueUrl);
  return { issueUrl };
}

export async function chatsInCurrentProject(projectPath: string | null): Promise<Conversation[]> {
  return commands.getConversations(projectPath ?? undefined);
}
