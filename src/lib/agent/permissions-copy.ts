import type { McpToolName } from "@/lib/agent/mcp-tool-specs";

/**
 * What a connected AI can do with an account, in the words the OAuth consent
 * card and /connect show before anyone connects one. Each line names the MCP
 * tools it covers, and tests/unit/agent-permissions-copy.test.ts fails when a
 * tool has no line, so a new tool can't ship behind a claim that it isn't
 * there. The earlier copy said the agent "cannot read your resume" and that
 * access was "read-only search" while `get_resume`, `set_resume`, `save_job`,
 * `mark_applied` and `set_preferences` were live.
 */
export const AGENT_PERMISSIONS: readonly { text: string; tools: readonly McpToolName[] }[] = [
    {
        text: "Search jobs and company records",
        tools: ["search_jobs", "for_you", "get_job", "get_company", "get_company_timeline", "search_companies"],
    },
    {
        text: "Read your résumé and replace it (earlier versions stay in your history)",
        tools: ["get_resume", "set_resume"],
    },
    {
        text: "Read and update your tracker: save jobs, mark them applied, and file tailored résumés",
        tools: ["get_applications", "save_job", "mark_applied", "save_resume_variant", "get_resume_variant"],
    },
    {
        text: "Read and change your search preferences and saved application answers",
        tools: ["get_preferences", "set_preferences"],
    },
];

/** What it can't do. Only claims no tool contradicts. */
export const AGENT_PERMISSIONS_LIMITS = "It can't submit an application for you or see anyone else's data.";
