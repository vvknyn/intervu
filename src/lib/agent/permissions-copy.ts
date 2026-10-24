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
        tools: ["search_jobs", "get_job", "get_company", "get_company_timeline", "search_companies"],
    },
    {
        text: "Read your résumé, rank jobs by fit against it, tailor it to a job, draft answers to application questions from it, and replace it (earlier versions stay in your history). Needs a paid month",
        tools: ["get_resume", "for_you", "tailor_resume", "draft_screening_answer", "set_resume"],
    },
    {
        text: "Read and update your tracker: save jobs, mark them applied, and file tailored résumés (filing needs a paid month)",
        tools: ["get_applications", "save_job", "mark_applied", "save_resume_variant", "get_resume_variant"],
    },
    {
        text: "Read and change your search preferences and saved application answers",
        tools: ["get_preferences", "set_preferences"],
    },
    {
        text: "List today's picks for your résumé, and turn the daily picks email on or off (needs a paid month)",
        tools: ["daily_picks"],
    },
];

/** What it can't do. Only claims no tool contradicts. */
export const AGENT_PERMISSIONS_LIMITS = "It can't submit an application for you or see anyone else's data.";

/**
 * /connect's sample prompts, each with the tools that answer it, so
 * tests/unit/agent-permissions-copy.test.ts fails when a prompt asks for
 * something no tool returns. The earlier list asked for "interview insights"
 * and "verified salary", which no tool has, so an assistant could only make
 * them up.
 */
export const CONNECT_SAMPLE_PROMPTS: readonly { text: string; tools: readonly McpToolName[] }[] = [
    { text: "Find senior product manager roles in Berlin paying over €100k, posted this week", tools: ["search_jobs"] },
    { text: "Rank jobs by fit against my résumé on Velai and save the top 3 to my tracker", tools: ["for_you", "save_job"] },
    { text: "What are today's picks for me on Velai? Turn on the daily picks email too", tools: ["daily_picks"] },
    { text: "Is this job posting still open, or does it look stale?", tools: ["get_job"] },
    { text: "Tailor my résumé for this role, file it on Velai and give me the PDF link", tools: ["tailor_resume", "save_resume_variant"] },
    { text: "What is Stripe hiring for, and what has changed there lately?", tools: ["get_company", "get_company_timeline"] },
];
