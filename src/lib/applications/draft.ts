/** Minimal application draft shape — legacy wizard removed; MCP + tracker own apply flow. */
export interface ApplicationDraft {
    jobUrl?: string;
    jobAnalysis?: {
        companyName?: string;
        positionTitle?: string;
    };
}
