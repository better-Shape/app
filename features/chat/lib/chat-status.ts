/** Runtime phases supplied by native chat events. */
export type TurnPhase =
    | "idle"
    | "thinking"
    | "tool"
    | "awaiting_approval"
    | "awaiting_input"
    | "waiting"
    | "running_command"
    | "editing"
    | "completed"
    | "failed"
    | "cancelled";

const TOOL_LABELS = new Map<string, string>([
    ["read_file", "Reading file"],
    ["list_dir", "Listing directory"],
    ["grep", "Searching"],
    ["search_files", "Finding files"],
    ["search_codebase", "Searching codebase"],
    ["codebase_overview", "Mapping codebase"],
    ["read_terminal", "Reading terminal"],
    ["list_terminals", "Listing terminals"],
    ["inspect_runtime", "Inspecting page"],
    ["render_design_previews", "Creating preview"],
    ["update_todos", "Updating todos"],
    ["save_plan", "Saving plan"],
]);

const TOOL_PHASES = new Map<string, TurnPhase>([
    ["ask_user", "awaiting_input"],
    ["wait", "waiting"],
    ["run_terminal", "running_command"],
    ["edit_file", "editing"],
    ["create_file", "editing"],
]);

const PHASE_LABELS: Partial<Record<TurnPhase, string>> = {
    awaiting_input: "Waiting for your answers",
    waiting: "Waiting",
    thinking: "Thinking",
    awaiting_approval: "Waiting for approval",
    running_command: "Running command",
    editing: "Editing file",
};

type RuntimeStatus = { phase?: string; tool?: string; label?: string };

function phaseForStatus({ phase, tool, label }: RuntimeStatus): TurnPhase | null {
    switch (phase) {
        case "approval":
            return label === "Waiting for your answers" ? "awaiting_input" : "awaiting_approval";
        case "model":
            return "thinking";
        case "tool":
            return TOOL_PHASES.get(tool ?? "") ?? "tool";
        default:
            return null;
    }
}

function labelForTool(tool?: string): string {
    if (!tool) return "Working";
    const pretty = TOOL_LABELS.get(tool) ?? tool.replace(/_/g, " ");
    return pretty.charAt(0).toUpperCase() + pretty.slice(1);
}

function labelForStatus(phase: TurnPhase | null, { tool, label }: RuntimeStatus): string | null {
    const explicit = label?.trim();
    if (explicit) return explicit;
    const standard = PHASE_LABELS[phase ?? "idle"];
    if (standard) return standard;
    return phase === "tool" ? labelForTool(tool) : null;
}

/** Interpret runtime status without granting conversation or turn ownership. */
export function parseChatStatus(status: RuntimeStatus): { phase: TurnPhase | null; label: string | null } | null {
    const phase = phaseForStatus(status);
    const label = labelForStatus(phase, status);
    if (!phase && !label) return null;
    return { phase, label };
}
