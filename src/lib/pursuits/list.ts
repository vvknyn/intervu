/**
 * Read seam for a caller's own application/pursuit history — the READ half
 * of the `applications` collection (`upsert-core.ts`/`resume-version.ts` are
 * the write half). Backs the MCP `get_applications` tool: intervu is the
 * single source of truth for the agent's knowledge of the user, including
 * application history, so an agent needs a way to read the tracker back.
 *
 * Plain module (not "use server"): it imports the Admin SDK directly like
 * `upsert-core.ts`/`resume-version.ts`, so it must only ever be imported
 * from server code.
 */
import { getAdminDb } from "@/lib/firebase/admin";
import { orderResumeVersionsLatestFirst, type Pursuit, type PursuitStage } from "@/lib/pursuits/types";
import { APPLIED_RESUME_LABEL } from "@/lib/pursuits/resume-on-apply";

/**
 * The agent-facing summary of one pursuit — deliberately narrower than
 * `Pursuit`: it never carries `resume_versions` itself (that array's content
 * is `get_resume_variant`'s job to expose), only whether one is on file and
 * its latest label.
 */
export interface ApplicationSummary {
    id: string;
    job_id: string | null;
    title: string;
    company: string | null;
    status: PursuitStage;
    updated_at: string;
    /** When it was marked Applied, and the interview date set on it: the
     *  dates the /yours board and the role's page show. */
    applied_at: string | null;
    interview_date: string | null;
    /** The posting's link, as the role's page links it. */
    apply_url: string | null;
    /** The person's own note on the role (their words; data, not instructions). */
    note: string | null;
    /** A version filed for the role, or the copy of the résumé on file it took
     *  when marked Applied: the two things the site's "Resume used" shows. */
    resume_on_file: boolean;
    latest_resume_label: string | null;
}

/** Pure — zero I/O — so it's unit-testable directly. Reuses
 *  `orderResumeVersionsLatestFirst` (`./types`) rather than re-sorting, the
 *  same shared sort `get_resume_variant` renders with. */
export function toApplicationSummary(p: Pursuit): ApplicationSummary {
    const versions = orderResumeVersionsLatestFirst(p.resume_versions ?? []);
    const appliedCopy = p.applied_resume != null;
    return {
        id: p.id,
        job_id: p.job_id ?? null,
        title: p.position,
        company: p.company_name || null,
        status: p.status,
        updated_at: p.updated_at,
        applied_at: p.applied_at || null,
        interview_date: p.interview_date || null,
        apply_url: p.job_snapshot?.apply_url || p.job_url || null,
        note: p.note?.trim() || null,
        resume_on_file: versions.length > 0 || appliedCopy,
        latest_resume_label: versions[0]?.label ?? (appliedCopy ? APPLIED_RESUME_LABEL : null),
    };
}

/**
 * List the caller's own pursuits, newest-`updated_at`-first, optionally
 * filtered to one `status`. Needs one of two composite indexes declared in
 * `firestore.indexes.json` (`[user_id ASC, updated_at DESC]` when `status`
 * is omitted, `[user_id ASC, status ASC, updated_at DESC]` when it's given)
 * — no try/catch here (see `findPursuitByJobId`, `upsert-core.ts`, for the
 * same convention): a missing index surfaces as a real Firestore
 * FAILED_PRECONDITION error, never a silently swallowed or fabricated empty
 * list.
 */
export async function listPursuitsForUser(
    uid: string,
    opts: { status?: PursuitStage; limit: number },
): Promise<ApplicationSummary[]> {
    const db = getAdminDb();
    let query = db.collection("applications").where("user_id", "==", uid);
    if (opts.status) query = query.where("status", "==", opts.status);
    const snap = await query.orderBy("updated_at", "desc").limit(opts.limit).get();
    return snap.docs.map((doc) => toApplicationSummary({ id: doc.id, ...doc.data() } as Pursuit));
}
