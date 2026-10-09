/**
 * Everything "Delete account" erases, in one place.
 *
 * Before this, `deleteAccount` (actions/auth.ts) missed three things:
 *  - Behavioural-ledger rows. forgetIdentity() looked the WorkOS user up by
 *    email to find the uid those rows carry, but ran after the WorkOS user had
 *    been deleted, so the lookup found nobody and nothing was removed. The
 *    ledger's user_id IS the account's uid, so it is now deleted by uid, for
 *    username-only accounts too.
 *  - Records kept under the sign-in email rather than the uid: contact-form
 *    messages, the connect, founding-seat and credit-pack waitlists.
 *  - PostHog: the person, their events and their replays.
 *
 * Order matters only where a step needs something an earlier one removes:
 * everything keyed by uid or email goes before the WorkOS sign-in record.
 * Kept on purpose: the email suppression entry (so we never mail the
 * address again) and anonymous search logs, which carry no account id.
 */
import type { Firestore } from "firebase-admin/firestore";

import { runUserDataPlan } from "@/lib/db/user-data";

export interface EraseAccountDeps {
    /** Paths of every user-owned document in the migration manifest. */
    ownedPaths(uid: string): Promise<string[]>;
    /** Paths of records kept under this email (or reserved by this uid). */
    emailPaths(email: string, uid: string): Promise<string[]>;
    deletePaths(paths: string[]): Promise<void>;
    /** Behavioural-ledger rows stamped with this uid. */
    deleteTelemetry(uid: string): Promise<unknown>;
    /** PostHog person, events and replays for this distinct id. */
    deleteAnalyticsPerson(uid: string): Promise<unknown>;
    /** The WorkOS sign-in record. */
    deleteSignIn(uid: string): Promise<void>;
    /** Suppression, then the email-follow identity store. */
    forgetEmail(email: string): Promise<void>;
    logError(message: string, error: unknown): void;
}

export interface EraseAccountInput {
    uid: string;
    /** The real sign-in email, or null for a username-only account. */
    email: string | null;
}

export async function eraseAccount(input: EraseAccountInput, deps: EraseAccountDeps): Promise<void> {
    const paths = await deps.ownedPaths(input.uid);
    if (input.email) paths.push(...(await deps.emailPaths(input.email, input.uid)));
    await deps.deletePaths([...new Set(paths)]);

    await deps.deleteTelemetry(input.uid);

    // PostHog is a third party with its own outages; failing to reach it must
    // not leave the account half deleted, so it is logged rather than thrown.
    try {
        await deps.deleteAnalyticsPerson(input.uid);
    } catch (error) {
        deps.logError("[Auth] PostHog person delete failed", error);
    }

    await deps.deleteSignIn(input.uid);
    if (input.email) await deps.forgetEmail(input.email);
}

/** Collections whose records carry the address in an `email` field. */
export const EMAIL_FIELD_COLLECTIONS = ["contact_messages", "connect_waitlist", "founding_waitlist", "waitlist"] as const;

/** Collections whose document id is the normalised (trimmed, lower-case) address. */
export const EMAIL_ID_COLLECTIONS = ["connect_waitlist", "founding_waitlist"] as const;

export async function emailKeyedPaths(db: Firestore, email: string, uid: string): Promise<string[]> {
    const variants = [...new Set([email, email.trim(), email.trim().toLowerCase()])];
    const paths: string[] = [];
    for (const collection of EMAIL_FIELD_COLLECTIONS) {
        const snap = await db.collection(collection).where("email", "in", variants).get();
        paths.push(...snap.docs.map((d) => d.ref.path));
    }
    for (const collection of EMAIL_ID_COLLECTIONS) {
        const doc = await db.collection(collection).doc(email.trim().toLowerCase()).get();
        if (doc.exists) paths.push(doc.ref.path);
    }
    // A signed-in founding-seat reservation records the uid too, whatever
    // address was typed into the form.
    const reserved = await db.collection("founding_waitlist").where("uid", "==", uid).get();
    paths.push(...reserved.docs.map((d) => d.ref.path));
    return paths;
}

export function storeEraseDeps(db: Firestore): Pick<EraseAccountDeps, "ownedPaths" | "emailPaths" | "deletePaths"> {
    return {
        async ownedPaths(uid) {
            const owned = await runUserDataPlan(uid, db);
            return Object.values(owned).flatMap((docs) => docs.map((d) => d.path));
        },
        emailPaths: (email, uid) => emailKeyedPaths(db, email, uid),
        async deletePaths(paths) {
            // 500 writes is Firestore's hard limit for one commit.
            for (let i = 0; i < paths.length; i += 500) {
                const batch = db.batch();
                for (const path of paths.slice(i, i + 500)) batch.delete(db.doc(path));
                await batch.commit();
            }
        },
    };
}

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string> }) => Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
}>;

/**
 * Deletes the PostHog person for this distinct id with their events and
 * session recordings (`delete_events=true&delete_recordings=true`, PostHog's
 * persons API). Needs a personal API key with person:write scope in
 * POSTHOG_PERSONAL_API_KEY and the project id in POSTHOG_PROJECT_ID; without
 * them it does nothing and says so.
 *
 * Only a person whose own distinct_ids include this id is deleted, so a
 * lookup that came back unfiltered can never delete anyone else.
 */
export async function deletePosthogPerson(
    distinctId: string,
    env: Record<string, string | undefined> = process.env,
    fetchImpl: FetchLike = fetch,
): Promise<"deleted" | "not-found" | "not-configured"> {
    const key = env.POSTHOG_PERSONAL_API_KEY?.trim();
    const project = env.POSTHOG_PROJECT_ID?.trim();
    if (!key || !project) return "not-configured";
    const host = (env.POSTHOG_API_HOST?.trim() || "https://us.posthog.com").replace(/\/+$/, "");
    const base = `${host}/api/projects/${encodeURIComponent(project)}/persons`;
    const headers = { Authorization: `Bearer ${key}` };

    const found = await fetchImpl(`${base}/?distinct_id=${encodeURIComponent(distinctId)}`, { headers });
    if (!found.ok) throw new Error(`PostHog person lookup answered ${found.status}`);
    const body = (await found.json()) as { results?: { id?: unknown; distinct_ids?: unknown }[] };
    const ids = (body.results ?? [])
        .filter((p) => Array.isArray(p.distinct_ids) && p.distinct_ids.includes(distinctId))
        .map((p) => p.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (!ids.length) return "not-found";

    for (const id of ids) {
        const res = await fetchImpl(`${base}/${encodeURIComponent(id)}/?delete_events=true&delete_recordings=true`, {
            method: "DELETE",
            headers,
        });
        if (!res.ok && res.status !== 404) throw new Error(`PostHog person delete answered ${res.status}`);
    }
    return "deleted";
}
