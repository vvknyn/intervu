/**
 * draft_screening_answer: the Velai Chrome extension's "Draft an answer" for a
 * connected AI. Given one free-text question from an application form and the
 * posting (job_id), it says whether Velai drafts that question or leaves it to
 * the person (work authorisation, pay, demographics, start date, relocation,
 * background checks, consents, where they heard about the job, their history
 * with the employer, a cover letter) and why, and otherwise returns the résumé
 * lines that bear on it, with where on the résumé each is, and the rules draft
 * made of them (`rulesAnswer`). The lines carry no name, email, phone or link.
 *
 * It never calls sealed AI: the assistant asking is the model, and writes the
 * answer from `lines` under the same no-invention rule. It saves and submits
 * nothing. The classification, the lines and the rules draft are the
 * extension's own (src/lib/screening/), so both say the same thing.
 */
import { rulesAnswer } from "../screening/answer";
import { screeningEvidence, type EvidenceLine } from "../screening/evidence";
import { classifyQuestion, questionText } from "../screening/question";
import { lookupJobById, resumeNeededError, type ToolDeps } from "./tools";

export interface ScreeningLineOut {
    text: string;
    /** "Role · Company", "Summary" or "Skills": where on the résumé the line is. */
    where: string;
}

export type DraftScreeningAnswerOut =
    | { job_id: string; drafts: false; reason: string; note: string }
    | { job_id: string; drafts: true; lines: ScreeningLineOut[]; draft: string; note: string };

const LEFT_TO_YOU_NOTE = "Velai leaves this question to the person: the answer is a fact about them or a choice only they make. Ask them.";
const DRAFT_NOTE =
    "A draft only. Write the answer from `lines` alone, as the person, with no employer, title, date, number, tool or skill they don't state, " +
    "and tell them to check every claim before they use it. Nothing is saved or submitted.";

const lineOut = ({ text, where }: EvidenceLine): ScreeningLineOut => ({ text, where });

export async function toolDraftScreeningAnswer(
    deps: ToolDeps,
    input: { job_id: string; question: string },
): Promise<DraftScreeningAnswerOut | { error: string }> {
    const question = questionText(input.question);
    const verdict = classifyQuestion(question);
    // A question that is the person's to answer reads no record and costs no budget.
    if (!verdict.draft) return { job_id: input.job_id, drafts: false, reason: verdict.reason, note: LEFT_TO_YOU_NOTE };
    const base = await deps.getBaseResume(deps.uid);
    if (base.source !== "resume_data") return { error: resumeNeededError(base, "draft_screening_answer", "drafts from") };
    const lookup = await lookupJobById(deps, input.job_id);
    if (lookup.kind === "unavailable") return { error: "search backend unavailable" };
    if (lookup.kind === "not_found") return { error: "job not found" };
    // The posting is read, so it counts like a get_job.
    const budget = await deps.consumeRecordBudget(1);
    if (!budget.ok) return { error: budget.error };
    const lines = screeningEvidence(base.resume_data, question, { title: lookup.job.title });
    if (lines.length === 0) {
        return { job_id: lookup.job.id, drafts: false, reason: "no line on your résumé speaks to it", note: LEFT_TO_YOU_NOTE };
    }
    return { job_id: lookup.job.id, drafts: true, lines: lines.map(lineOut), draft: rulesAnswer(lines), note: DRAFT_NOTE };
}
