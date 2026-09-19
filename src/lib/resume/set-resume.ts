/**
 * Write seam for `set_resume` (agent-formatted resume upload) — same shape
 * convention as `base-resume.ts` (read) and `lib/pursuits/resume-version.ts`
 * (write): `uid` is supplied directly by the caller rather than resolved
 * from a cookie session, so the bearer-token MCP tool `set_resume`
 * (`lib/agent/tools.ts`) can write it without depending on
 * `getServerUser()`'s cookie-session mechanism.
 *
 * The agent (an LLM) formats the uploaded résumé into intervu's
 * `ResumeData` shape itself — this module NEVER calls an LLM or a résumé
 * parser of any kind. It only validates the structure the agent already
 * submitted and stores it.
 *
 * Every non-trivial decision (does the first-call baseline fire, what goes
 * in the new history entry, whether `resume_data` validates or gets
 * cleared, what `set_resume` reports back) lives in `planResumeUpload`
 * below — pure, zero I/O, unit-testable directly (same spirit as
 * `buildResumeVersionSnapshot` in `resume-version.ts`). `setBaseResumeForUser`
 * stays a thin wrapper: read the two bits of state the plan needs, hand them
 * to the planner, execute the plan.
 *
 * `resumeDataSchema` is the ONE strict shape/cap check for agent-submitted
 * `ResumeData` anywhere in the agent surface — the MCP wire schema
 * (`route.ts`'s `setResumeInput`) deliberately leaves `resume_data`
 * permissive so a structurally invalid payload never rejects the whole
 * call; this is where that structure is actually checked.
 *
 * Plain module (not "use server"): imports the Admin SDK directly, so it
 * must only ever be imported from server code.
 */
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { AGENT } from "@/lib/agent/config";
import { ALL_SECTIONS, type ResumeData } from "@/types/resume";
import type { ResumeVersionSnapshot } from "@/lib/pursuits/types";
import { canonicalizeBaseResume, getBaseResumeForUser, type BaseResume } from "@/lib/resume/base-resume";
import { z } from "zod";

/** One length cap for every free-text field in `ResumeData` that isn't a
 *  short label (experience descriptions, the generated summary) — smaller
 *  than `AGENT.RESUME_TEXT_MAX_CHARS` since it bounds ONE field of a
 *  résumé, not the whole document. Short labels (name, company, role, ...)
 *  use a plain 200-char cap inline, matching this codebase's existing
 *  convention (see `lib/validation.ts`'s `nonEmptyString(200)` call sites)
 *  rather than adding a second named constant for the same DoS-guard
 *  spirit. */
const TEXT_FIELD_MAX = AGENT.RESUME_DATA_FIELD_MAX_CHARS;
/** One array-length cap reused for every list in `ResumeData` (experience
 *  entries, competency categories, education entries, skills within a
 *  category) — a real résumé never has more than a handful of any of
 *  these, so one shared ceiling covers the whole shape rather than four
 *  bespoke ones. */
const LIST_MAX = AGENT.RESUME_DATA_ARRAY_MAX_ITEMS;

const cappedString = (max: number) => z.string().trim().max(max);

const resumeProfileSchema = z.object({
    name: cappedString(200),
    profession: cappedString(200),
    yearsOfExperience: z.number().int().min(0).max(80),
    location: cappedString(200),
    email: cappedString(200),
    phone: cappedString(50),
    linkedin: cappedString(300).optional(),
});

const resumeExperienceSchema = z.object({
    id: cappedString(100),
    company: cappedString(200),
    role: cappedString(200),
    dates: cappedString(100),
    description: cappedString(TEXT_FIELD_MAX),
});

const resumeCompetencyCategorySchema = z.object({
    category: cappedString(200),
    skills: z.array(cappedString(100)).max(LIST_MAX),
});

const resumeEducationSchema = z.object({
    id: cappedString(100),
    degree: cappedString(200),
    institution: cappedString(200),
    year: cappedString(20).optional(),
    gpa: cappedString(20).optional(),
    honours: z.array(cappedString(200)).max(LIST_MAX).optional(),
    coursework: z.array(cappedString(200)).max(LIST_MAX).optional(),
    activities: z.array(cappedString(200)).max(LIST_MAX).optional(),
});

/**
 * The ONE strict `ResumeData` shape/cap check for agent-submitted resumes
 * (see module doc comment). Typed against `ResumeData` itself so a drift
 * between this schema and the real type is a compile error, not a silent
 * runtime mismatch.
 */
const resumeDataSchema: z.ZodType<ResumeData> = z.object({
    profile: resumeProfileSchema,
    experience: z.array(resumeExperienceSchema).max(LIST_MAX),
    projects: z.array(resumeExperienceSchema).max(LIST_MAX).optional(),
    competencies: z.array(resumeCompetencyCategorySchema).max(LIST_MAX),
    education: z.array(resumeEducationSchema).max(LIST_MAX),
    generatedSummary: cappedString(TEXT_FIELD_MAX),
    sectionOrder: z.array(z.enum(ALL_SECTIONS)).optional(),
});

export interface ResumeDataIssue {
    path: (string | number)[];
    message: string;
}

export type ResumeDataValidation =
    | { ok: true; data: ResumeData }
    | { ok: false; issues: ResumeDataIssue[] };

/**
 * Validates raw agent-submitted `resume_data` against the strict
 * `ResumeData` shape/caps above. Pure — no I/O — so it's unit-testable
 * without Firestore. `ok: false` is a normal, expected outcome (the caller
 * still stores `resume_text`; see `planResumeUpload`), never a throw.
 */
export function validateResumeData(data: unknown): ResumeDataValidation {
    const result = resumeDataSchema.safeParse(data);
    if (result.success) return { ok: true, data: result.data };
    return {
        ok: false,
        // zod's `issue.path` is `PropertyKey[]` (it allows symbol segments in
        // general); this schema never uses symbol keys, but the cast is
        // narrowed to a real string here rather than trusted blind, since
        // `issues` flows straight into a JSON tool response.
        issues: result.error.issues.map((issue) => ({
            path: issue.path.map((segment) => (typeof segment === "symbol" ? segment.toString() : segment)),
            message: issue.message,
        })),
    };
}

/** The one-time baseline snapshot's label — distinguishes it from every
 *  real upload's label in `resume_history` (see `planResumeUpload`). */
const BASELINE_HISTORY_LABEL = "pre-chat-upload baseline";
/** `set_resume`'s default label when the caller omits one — applied here
 *  (where the label is actually used), not in the MCP wire schema. */
const DEFAULT_UPLOAD_LABEL = "chat upload";

export type SetBaseResumeResult = BaseResume & {
    version_saved: true;
    normalized: boolean;
    issues?: ResumeDataIssue[];
};

export interface ResumeUploadPlan {
    /** The one-time snapshot of whatever resume existed before chat uploads
     *  started — `null` when the guard doesn't fire (no prior resume, or
     *  history already has an entry). */
    baselineEntry: ResumeVersionSnapshot | null;
    /** This upload's own history entry — always written. */
    historyEntry: ResumeVersionSnapshot;
    /** What to merge onto the profile doc. `resume_data: null` means "clear
     *  the field" — a Firestore-specific `FieldValue.delete()` sentinel is
     *  an I/O concern, kept out of this pure function; the caller
     *  (`setBaseResumeForUser`) translates `null` at the write site. */
    profileWrite: { resume_text: string; resume_last_updated: string; resume_data: ResumeData | null };
    result: SetBaseResumeResult;
}

/**
 * All of `set_resume`'s decision logic, pure: given the resume that existed
 * BEFORE this call and whether `resume_history` is still empty (both read
 * by `setBaseResumeForUser` below), decides what to write and what to
 * report back. Zero I/O — unit-testable directly without mocking Firestore.
 *
 * `nowIso` defaults to the real clock but takes an override (same idiom as
 * `buildResumeVersionSnapshot`'s `savedAtIso` param in `resume-version.ts`)
 * so tests get deterministic, comparable timestamps.
 */
export function planResumeUpload(
    prior: BaseResume,
    historyIsEmpty: boolean,
    input: { text: string; data?: unknown; label?: string },
    nowIso: string = new Date().toISOString(),
): ResumeUploadPlan {
    const label = input.label?.trim() || DEFAULT_UPLOAD_LABEL;

    // First-call baseline: only when the caller already had a real resume
    // AND history is still empty — the empty-subcollection check is what
    // keeps this from ever firing twice. JSON.stringify covers the
    // structured-only case, since ResumeVersionSnapshot.content is a plain
    // string field.
    const baselineEntry: ResumeVersionSnapshot | null =
        prior.source !== "none" && historyIsEmpty
            ? {
                  content: prior.source === "resume_text" ? prior.resume_text : JSON.stringify(prior.resume_data),
                  label: BASELINE_HISTORY_LABEL,
                  saved_at: nowIso,
              }
            : null;

    const historyEntry: ResumeVersionSnapshot = { content: input.text, label, saved_at: nowIso };

    const validation = input.data !== undefined ? validateResumeData(input.data) : undefined;
    const validData = validation?.ok ? validation.data : undefined;

    return {
        baselineEntry,
        historyEntry,
        profileWrite: { resume_text: input.text, resume_last_updated: nowIso, resume_data: validData ?? null },
        result: {
            ...canonicalizeBaseResume(validData, input.text),
            version_saved: true,
            normalized: validData !== undefined,
            ...(validation && !validation.ok ? { issues: validation.issues } : {}),
        },
    };
}

/**
 * Sets the caller's own base résumé from an agent-formatted chat upload.
 * Reads the two bits of state `planResumeUpload` needs (the resume that
 * existed before this call, and whether `resume_history` is still empty),
 * then executes its plan: baseline entry (if any), this upload's history
 * entry, then the profile write.
 *
 * `resume_history` is a subcollection (`profiles/<uid>/resume_history`),
 * never an array field on the profile doc — unlike a pursuit's small,
 * bounded `resume_versions` array, this is unbounded profile-level history
 * (many uploads over months, each up to `AGENT.RESUME_TEXT_MAX_CHARS`
 * chars), which risks the 1 MiB Firestore document limit as an array.
 */
export async function setBaseResumeForUser(
    uid: string,
    input: { text: string; data?: unknown; label?: string },
): Promise<SetBaseResumeResult> {
    const db = getAdminDb();
    const profileRef = db.collection("profiles").doc(uid);
    const historyRef = profileRef.collection("resume_history");

    const prior = await getBaseResumeForUser(uid);
    const historySnap = await historyRef.limit(1).get();
    const plan = planResumeUpload(prior, historySnap.empty, input);

    if (plan.baselineEntry) await historyRef.doc().set(plan.baselineEntry);
    await historyRef.doc().set(plan.historyEntry);
    await profileRef.set(
        {
            resume_text: plan.profileWrite.resume_text,
            resume_last_updated: plan.profileWrite.resume_last_updated,
            // A missing/invalid resume_data must never leave a STALE prior
            // value shadowing the fresh text: canonicalizeBaseResume prefers
            // resume_data whenever it has real content, so an old value here
            // would silently outrank the text this call just submitted.
            resume_data: plan.profileWrite.resume_data ?? FieldValue.delete(),
        },
        { merge: true },
    );

    return plan.result;
}

/**
 * Clears the caller's CURRENT base résumé (`resume_text`/`resume_data`/
 * `resume_last_updated` on the profile doc) — the account "Resume"
 * section's Delete action (R1, 2026-08-09 user report). Never touches
 * `resume_history`: a deletion removes what's current, not what happened —
 * every prior upload (including the auto-baseline `setBaseResumeForUser`
 * snapshots) stays on file, same as it does after any ordinary re-upload.
 */
export async function clearBaseResumeForUser(uid: string): Promise<void> {
    const db = getAdminDb();
    await db.collection("profiles").doc(uid).set(
        {
            resume_text: FieldValue.delete(),
            resume_data: FieldValue.delete(),
            resume_last_updated: FieldValue.delete(),
        },
        { merge: true },
    );
}

/** One length cap for the account "Resume" section's web upload path — the
 *  SAME `RESUME_TEXT_MAX_CHARS` the MCP `set_resume` tool's wire schema
 *  uses (route.ts's `setResumeInput`), so a web upload can never write
 *  something the agent surface itself would have rejected. */
export type ResumeUploadTextValidation = { ok: true; text: string } | { ok: false; error: string };

/**
 * Pure: validates+normalizes web-submitted résumé upload text before it
 * reaches `setBaseResumeForUser`. Zero I/O — unit-testable directly.
 */
export function validateResumeUploadText(raw: string): ResumeUploadTextValidation {
    const text = raw.trim();
    if (!text) return { ok: false, error: "Paste your resume text or choose a file — nothing came through." };
    if (text.length > AGENT.RESUME_TEXT_MAX_CHARS) {
        return { ok: false, error: `Resume text is too long (max ${AGENT.RESUME_TEXT_MAX_CHARS.toLocaleString()} characters).` };
    }
    return { ok: true, text };
}

export interface SavedResumeVersion {
    id: string;
    content: string;
    label: string;
    saved_at: string;
    structuredData?: ResumeData | null;
}

/**
 * Fetch all saved resume versions and history snapshots for a user, latest first.
 */
export async function getResumeHistoryForUser(uid: string): Promise<SavedResumeVersion[]> {
    const db = getAdminDb();
    const snap = await db
        .collection("profiles")
        .doc(uid)
        .collection("resume_history")
        .orderBy("saved_at", "desc")
        .get();

    return snap.docs.map((doc) => {
        const d = doc.data();
        let structuredData: ResumeData | null = null;
        if (d.content && typeof d.content === "string") {
            const trimmed = d.content.trim();
            if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
                try {
                    const parsed = JSON.parse(trimmed);
                    const val = validateResumeData(parsed);
                    if (val.ok) structuredData = val.data;
                } catch {
                    // Ignore non-JSON content
                }
            }
        }
        return {
            id: doc.id,
            content: d.content || "",
            label: d.label || "Saved version",
            saved_at: d.saved_at || "",
            structuredData,
        };
    });
}

/**
 * Save a named resume version snapshot explicitly for a user.
 */
/**
 * Pure: is this a bare Firestore document id?
 *
 * Firestore treats a slash in `.doc()` as a path separator, so an id like
 * `x/resume_history/y` would walk back out of the subcollection a delete is
 * scoped to. The uid in the path already confines a caller to their own
 * history; this closes the one way a crafted id could leave it.
 */
export function isBareDocumentId(id: string): boolean {
    return /^[A-Za-z0-9_-]{1,1500}$/.test(id);
}

/**
 * Delete one saved snapshot from a user's resume history. The path is built
 * from the session uid, so a caller can only ever reach their own versions.
 */
export async function deleteResumeVersionForUser(uid: string, versionId: string): Promise<void> {
    if (!isBareDocumentId(versionId)) throw new Error("Invalid version id");
    const db = getAdminDb();
    await db.collection("profiles").doc(uid).collection("resume_history").doc(versionId).delete();
}

export async function saveNamedResumeVersion(
    uid: string,
    input: { data: ResumeData; label: string },
): Promise<SavedResumeVersion> {
    const db = getAdminDb();
    const historyRef = db.collection("profiles").doc(uid).collection("resume_history");
    const jsonStr = JSON.stringify(input.data);
    const entry = {
        content: jsonStr,
        label: input.label?.trim() || "Saved Version",
        saved_at: new Date().toISOString(),
    };
    const docRef = await historyRef.add(entry);
    return {
        id: docRef.id,
        content: entry.content,
        label: entry.label,
        saved_at: entry.saved_at,
        structuredData: input.data,
    };
}

