/**
 * Résumé retention: a stored résumé and what is derived from it (RESUME_SUBSET, in the primary
 * and the mirror store) are deleted 90 days after the account's paid/granted time ends, but only
 * after a warning email was sent for that end and 7 days have passed since it. A later purchase
 * moves `end`, so the warning stamp (`retention_warned_for` = the `end` it was sent for) re-arms
 * by itself. Never deletes the account, tracker, saved jobs or anything that
 * is not résumé-derived.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";

import { eraseMirrorStore, type ProcessorStatus } from "@/lib/account/erase-account";
import { accessUntil } from "@/lib/billing/access";
import { runUserDataPlan, type FoundDoc } from "@/lib/db/user-data";
import { getAdminDb } from "@/lib/firebase/admin";
import { digestEmailForUid } from "@/lib/email/digest/send";
import { sendEmail } from "@/lib/email/send";
import { getSiteUrl } from "@/lib/seo/constants";

const DAY_MS = 86_400_000;
export const DELETE_AFTER_MS = 90 * DAY_MS;
export const WARN_AFTER_MS = 83 * DAY_MS;

export type RetentionAction = "none" | "warn" | "delete" | "anomaly";

export const WARN_GAP_MS = 7 * DAY_MS;

export interface RetentionState {
    /** accessUntil(profile), or retention_first_seen_at when the account never had access; 0 = neither. */
    end: number;
    now: number;
    warnedFor: unknown;
    warnedAt: unknown;
    /** Whether a warning can be delivered. An account with no address is deleted on schedule, unwarned. */
    hasEmail: boolean;
}

/**
 * Pure. Delete only after a warning was sent for THIS end and a full week has passed since it;
 * otherwise warn now and push deletion out. No address to warn = delete on the 90-day mark.
 */
export function retentionAction(s: RetentionState): RetentionAction {
    if (s.end <= 0) return "anomaly";
    const warned = s.warnedFor === s.end;
    if (s.now >= s.end + DELETE_AFTER_MS) {
        if (!s.hasEmail) return "delete";
        if (!warned) return "warn";
        return typeof s.warnedAt === "number" && s.now >= s.warnedAt + WARN_GAP_MS ? "delete" : "none";
    }
    if (s.now >= s.end + WARN_AFTER_MS && !warned && s.hasEmail) return "warn";
    return "none";
}

const formatDate = (ms: number) =>
    new Date(ms).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

/** Plain notice: the two dates and a pricing link, nothing else. */
export function buildRetentionWarning(end: number, siteUrl: string): { subject: string; text: string } {
    const deleteOn = formatDate(end + DELETE_AFTER_MS);
    return {
        subject: `Your saved résumé will be deleted on ${deleteOn}`,
        text: [
            `Your paid time on Velai ended on ${formatDate(end)}. We delete saved résumés 90 days after that.`,
            `Add a month before ${deleteOn} to keep it, or do nothing and it will be removed.`,
            `${siteUrl}/pricing`,
        ].join("\n\n"),
    };
}

const BATCH_LIMIT = 500; // Firestore's hard limit for one commit

/**
 * The résumé-derived part of the user-data manifest (lib/db/user-data.ts), by manifest table:
 * "doc" = the whole document is résumé-derived; a field list = only those fields are. Paths
 * come from the manifest's own plan (runUserDataPlan), the same one account erase uses.
 * `profiles` is last so a failure part-way leaves the base résumé in place and the next run retries.
 */
export const RESUME_SUBSET: Readonly<Record<string, "doc" | readonly string[]>> = {
    resume_history: "doc",
    tailored_resumes: "doc",
    job_analyses: "doc",
    applications: ["resume_versions", "applied_resume", "cover_letter"],
    interview_prep_cache: ["match_data", "resume_companies"],
    email_digest_state: ["dailyPicks.sentIds", "dailyPicks.sentKeys", "dailyPicks.latestIds"],
    profiles: ["resume_text", "resume_data", "resume_last_updated", "resume_import_source", "resume_import_confidence"],
};

export type ResumeOp = { path: string; fields: readonly string[] | null };

const hasField = (data: Record<string, unknown>, dotted: string): boolean => {
    let node: unknown = data;
    for (const key of dotted.split(".")) {
        if (!node || typeof node !== "object" || !(key in node)) return false;
        node = (node as Record<string, unknown>)[key];
    }
    return node !== undefined && node !== null;
};

/** Pure: the writes that remove the résumé subset from what runUserDataPlan found. Empty = nothing held. */
export function resumeOps(owned: Record<string, readonly FoundDoc[]>): ResumeOp[] {
    const ops: ResumeOp[] = [];
    for (const [table, kind] of Object.entries(RESUME_SUBSET)) {
        for (const doc of owned[table] ?? []) {
            if (kind === "doc") ops.push({ path: doc.path, fields: null });
            else {
                const present = kind.filter((f) => hasField(doc.data, f));
                if (present.length) ops.push({ path: doc.path, fields: present });
            }
        }
    }
    return ops;
}

/** The résumé subset one account holds in `db` (empty when none). */
export async function findResumeOps(uid: string, db: Firestore): Promise<ResumeOp[]> {
    return resumeOps(await runUserDataPlan(uid, db));
}

/** Deletes the résumé subset, in commit-sized batches, in manifest-subset order (profiles last). */
export async function deleteResumeData(uid: string, db: Firestore): Promise<void> {
    const ops = await findResumeOps(uid, db);
    for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
        const batch = db.batch();
        for (const op of ops.slice(i, i + BATCH_LIMIT)) {
            if (op.fields) batch.update(db.doc(op.path), Object.fromEntries(op.fields.map((f) => [f, FieldValue.delete()])));
            else batch.delete(db.doc(op.path));
        }
        await batch.commit();
    }
}

/**
 * Runs `use` against the other doc store (Firestore vs Postgres copy), chosen by the same rule account
 * erase uses (eraseMirrorStore). Returns that store's status; "not-applicable" = no mirror exists.
 */
export async function withMirrorStore(uid: string, use: (mirror: Firestore) => Promise<void>): Promise<ProcessorStatus> {
    return eraseMirrorStore(uid, null, undefined, (mirror) => ({
        stripeCustomerId: async () => null,
        emailPaths: async () => [],
        deletePaths: async () => {},
        ownedPaths: async () => {
            await use(mirror);
            return [];
        },
    }));
}

export interface RetentionCounts {
    scanned: number;
    warned: number;
    deleted: number;
    no_access_period: number;
    no_email: number;
    send_failed: number;
    mirror_unreachable: number;
    errors: number;
}

/** The I/O the run touches besides its own store; tests stand in for these. */
export interface RetentionDeps {
    db: Firestore;
    withMirror: typeof withMirrorStore;
    emailFor: (uid: string) => Promise<string | null>;
    send: (to: string, message: { subject: string; text: string }) => Promise<{ sent: boolean }>;
}

const realDeps = (): RetentionDeps => ({
    db: getAdminDb(),
    withMirror: withMirrorStore,
    emailFor: digestEmailForUid,
    send: (to, message) => sendEmail({ to, kind: "transactional", ...message }),
});

/** One pass over every profile. Counts only; `apply` false = dry run. */
export async function runResumeRetention(opts: { apply: boolean; now?: number; deps?: RetentionDeps }): Promise<RetentionCounts> {
    const now = opts.now ?? Date.now();
    const deps = opts.deps ?? realDeps();
    const { db } = deps;
    const counts: RetentionCounts = {
        scanned: 0, warned: 0, deleted: 0, no_access_period: 0, no_email: 0, send_failed: 0, mirror_unreachable: 0, errors: 0,
    };
    const snap = await db
        .collection("profiles")
        .select("access_until", "retention_warned_for", "retention_warned_at", "retention_first_seen_at")
        .get();

    for (const doc of snap.docs) {
        const profile = doc.data();
        try {
            let end = accessUntil(profile);
            const firstSeen = typeof profile.retention_first_seen_at === "number" ? profile.retention_first_seen_at : 0;
            if (end <= 0) end = firstSeen;
            // Nothing can be due before the warning mark, so skip the reads below until it is.
            if (end > 0 && now < end + WARN_AFTER_MS) continue;
            if (!(await findResumeOps(doc.id, db)).length && !(await mirrorHoldsResume(deps, doc.id))) continue;
            counts.scanned += 1;

            if (end <= 0) {
                // Never had access: the clock starts the first time we see the résumé.
                if (opts.apply) await doc.ref.set({ retention_first_seen_at: now }, { merge: true });
                counts.no_access_period += 1;
                continue;
            }
            const to = await deps.emailFor(doc.id);
            const action = retentionAction({ end, now, warnedFor: profile.retention_warned_for, warnedAt: profile.retention_warned_at, hasEmail: Boolean(to) });
            if (action === "delete") {
                if (!to) counts.no_email += 1;
                if (opts.apply) {
                    await deleteResumeData(doc.id, db);
                    if ((await deps.withMirror(doc.id, (mirror) => deleteResumeData(doc.id, mirror))) === "not-configured") counts.mirror_unreachable += 1;
                }
                counts.deleted += 1;
            } else if (action === "warn" && to) {
                if (opts.apply) {
                    const sent = await deps.send(to, buildRetentionWarning(end, getSiteUrl()));
                    if (!sent.sent) {
                        counts.send_failed += 1;
                        continue;
                    }
                    await doc.ref.set({ retention_warned_for: end, retention_warned_at: now }, { merge: true });
                }
                counts.warned += 1;
            }
        } catch (error) {
            // Never the uid, address or résumé text: the reason only.
            console.error("[retention] one account failed:", error instanceof Error ? error.message : "unknown");
            counts.errors += 1;
        }
    }
    return counts;
}

async function mirrorHoldsResume(deps: RetentionDeps, uid: string): Promise<boolean> {
    let holds = false;
    await deps.withMirror(uid, async (mirror) => {
        holds = (await findResumeOps(uid, mirror)).length > 0;
    });
    return holds;
}
