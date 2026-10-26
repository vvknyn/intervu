/**
 * Résumé retention: a stored résumé and what is derived from it (RESUME_SUBSET, in the primary
 * and the mirror store) are deleted when the account's paid/granted time ends (the rule is in
 * retention/rules.ts). One warning email goes out in the 7 days before; it is a courtesy, never a gate.
 * Just before deleting, access is recomputed from Stripe, so a renewal the webhook has not delivered
 * yet keeps the résumé. A later purchase moves `end`, so the warning stamp (`retention_warned_for` =
 * the `end` it was sent for) re-arms by itself. Never deletes the account, tracker, saved jobs or anything that
 * is not résumé-derived.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";

import { eraseMirrorStore, type ProcessorStatus } from "@/lib/account/erase-account";
import { accessUntil } from "@/lib/billing/access";
import { recomputeAccess } from "@/lib/billing/recompute";
import { DELETED_WHEN, WARN_BEFORE_MS } from "@/lib/retention/rules";
import { runUserDataPlan, type FoundDoc } from "@/lib/db/user-data";
import { getAdminDb } from "@/lib/firebase/admin";
import { isReachableEmail } from "@/lib/auth/minted-email";
import { workosEmailForUid } from "@/lib/email/digest/send";
import { sendEmail } from "@/lib/email/send";
import { getSiteUrl } from "@/lib/seo/constants";

export type RetentionAction = "none" | "warn" | "delete" | "anomaly";

export interface RetentionState {
    /** accessUntil(profile), or retention_first_seen_at when the account never had access; 0 = neither. */
    end: number;
    now: number;
    warnedFor: unknown;
    /** Whether a warning can be delivered. Only gates the warning; deletion never waits on it. */
    hasEmail: boolean;
}

/**
 * Pure. Delete once the end has passed, warned or not. Before it, warn once per end in the last
 * WARN_BEFORE_MS if an address exists.
 */
export function retentionAction(s: RetentionState): RetentionAction {
    if (s.end <= 0) return "anomaly";
    if (s.now >= s.end) return "delete";
    if (s.now >= s.end - WARN_BEFORE_MS && s.warnedFor !== s.end && s.hasEmail) return "warn";
    return "none";
}

const formatDate = (ms: number) =>
    new Date(ms).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

/** Plain notice: the end date, what happens then, and a pricing link. */
export function buildRetentionWarning(end: number, siteUrl: string): { subject: string; text: string } {
    return {
        subject: `Your saved résumé will be deleted on ${formatDate(end)}`,
        text: [
            `Your paid time on Velai ends on ${formatDate(end)}. A résumé saved on Velai is deleted ${DELETED_WHEN}.`,
            `Add a month before then to keep it, or do nothing and it will be removed.`,
            `${siteUrl}/pricing`,
        ].join("\n\n"),
    };
}

/** When the clock starts: the end of paid time, or the first time we saw a résumé on an account that never had access. 0 = neither. */
const retentionEnd = (profile: Record<string, unknown>): number =>
    accessUntil(profile) || (typeof profile.retention_first_seen_at === "number" ? profile.retention_first_seen_at : 0);

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
    /** Re-derives access_until from Stripe and stores it; throws on failure. */
    recompute: (uid: string) => Promise<number>;
}

/**
 * The address a warning can reach, or null = positively none (no WorkOS account, no email, or a minted
 * address that cannot receive mail). THROWS when WorkOS cannot say: the account's catch then skips it,
 * so an outage never reads as "no address" and deletes unwarned.
 */
export async function retentionEmailForUid(uid: string, userManagement?: Parameters<typeof workosEmailForUid>[1]): Promise<string | null> {
    const email = await workosEmailForUid(uid, userManagement);
    return isReachableEmail(email) ? email : null;
}

const realDeps = (): RetentionDeps => ({
    db: getAdminDb(),
    withMirror: withMirrorStore,
    emailFor: retentionEmailForUid,
    send: (to, message) => sendEmail({ to, kind: "transactional", ...message }),
    recompute: (uid) => recomputeAccess(uid),
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
            const end = retentionEnd(profile);
            // Nothing can be due before the warning window, so skip the reads below until it opens.
            if (end > 0 && now < end - WARN_BEFORE_MS) continue;
            if (!(await findResumeOps(doc.id, db)).length && !(await mirrorHoldsResume(deps, doc.id))) continue;
            counts.scanned += 1;

            if (end <= 0) {
                // Never had access: the clock starts the first time we see the résumé; that stamp is the end.
                if (opts.apply) await doc.ref.set({ retention_first_seen_at: now }, { merge: true });
                counts.no_access_period += 1;
                continue;
            }
            // The address only matters for the warning; a lookup outage must not hold up a due deletion.
            const to = now < end ? await deps.emailFor(doc.id) : null;
            if (now < end && !to) counts.no_email += 1;
            const action = retentionAction({ end, now, warnedFor: profile.retention_warned_for, hasEmail: Boolean(to) });
            if (action === "delete") {
                if (opts.apply) {
                    // A renewal Stripe holds may not have reached the profile yet (webhook lag): recompute first.
                    // A throw lands in the catch below: counted, nothing deleted.
                    await deps.recompute(doc.id);
                    // The snapshot is old by now: re-read the live doc and decide again.
                    const live = (await doc.ref.get()).data() ?? {};
                    if (retentionAction({ end: retentionEnd(live), now, warnedFor: live.retention_warned_for, hasEmail: false }) !== "delete") continue;
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
