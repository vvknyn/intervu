/**
 * The tailored-résumé draft every no-model path gets: the rules rewrite,
 * grounded, ordered for the role, with projects the posting asks nothing about
 * offered to leave out.
 *
 * It lives apart from tailor-with-engine.ts, which also loads the browser's
 * sealed-AI client, so the callers that never run a model (the MCP tool and
 * the Chrome extension) take this without bundling that client.
 * `tailorWithRules` (tailor-with-engine.ts) is this function.
 */
import { groundDraft } from "./tailor-ground";
import { withLeaveOuts } from "./tailor-asks";
import { heuristicTailorResume, resumeFullText, withRoleOrder, type TailorDraft, type TailorJobInput } from "./tailor-resume";
import type { ResumeData } from "@/types/resume";

export function rulesTailorDraft(resume: ResumeData, job: TailorJobInput): TailorDraft {
    return withLeaveOuts(withRoleOrder(groundDraft(resumeFullText(resume), heuristicTailorResume(resume, job)), job), job);
}
