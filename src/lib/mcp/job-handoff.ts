export type McpHandoffClient = "claude" | "chatgpt";

export type JobHandoffInput = {
    id: string;
    title: string;
    company: string;
    location?: string | null;
};

const HANDOFF_CLIENT_KEY = "intervu.mcp-handoff-client";

function jobLabel(job: JobHandoffInput): string {
    const loc = job.location?.trim();
    return loc ? `"${job.title}" at ${job.company}, ${loc}` : `"${job.title}" at ${job.company}`;
}

/** Prompt that tells a paired MCP client to use intervu tools on this job. */
export function buildJobMcpHandoffPrompt(job: JobHandoffInput): string {
    return `Using my velai MCP connection, pull job_id ${job.id} (${jobLabel(job)}). Tell me if I'm a fit, what gaps to close, and whether to save it.`;
}

/** Deep link with prefilled prompt for the chosen AI client. */
export function buildHandoffUrl(client: McpHandoffClient, job: JobHandoffInput): string {
    const q = encodeURIComponent(buildJobMcpHandoffPrompt(job));
    return client === "claude" ? `https://claude.ai/new?q=${q}` : `https://chatgpt.com/?q=${q}`;
}

export function getSavedHandoffClient(): McpHandoffClient | null {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(HANDOFF_CLIENT_KEY);
    return raw === "claude" || raw === "chatgpt" ? raw : null;
}

export function saveHandoffClient(client: McpHandoffClient): void {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(HANDOFF_CLIENT_KEY, client);
}

export function clearHandoffClient(): void {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(HANDOFF_CLIENT_KEY);
}

/** Connect tab ids that map to a handoff client — open/closed at the capability. */
export function handoffClientFromConnectTab(id: string): McpHandoffClient | null {
    return id === "claude" || id === "chatgpt" ? id : null;
}
