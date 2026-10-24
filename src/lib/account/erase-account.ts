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
 *  - The Firebase Authentication record from before sign-in moved to WorkOS.
 *
 * Order matters only where a step needs something an earlier one removes:
 * everything keyed by uid or email goes before the WorkOS sign-in record.
 * Kept on purpose: the email suppression entry (so we never mail the
 * address again) and anonymous search logs, which carry no account id.
 */
import type { Firestore } from "firebase-admin/firestore";

import { getStripe } from "@/lib/billing/stripe-client";
import { getPgDocDb } from "@/lib/db/docstore/pg-docstore";
import { runUserDataPlan } from "@/lib/db/user-data";
import { getFirestoreDb, usesPostgresStore } from "@/lib/firebase/admin";

/** What happened at one place Velai put the person's data. */
export type ProcessorStatus = "deleted" | "not-found" | "not-configured" | "not-applicable" | "failed";
export interface ProcessorResult {
    processor: string;
    status: ProcessorStatus;
}

/** A processor in one of these states still holds (or may hold) the data. */
export const isSkipped = (status: ProcessorStatus): boolean => status === "not-configured" || status === "failed";

export interface EraseAccountDeps {
    /** Paths of every user-owned document in the migration manifest. */
    ownedPaths(uid: string): Promise<string[]>;
    /** Paths of records kept under this email (or reserved by this uid). */
    emailPaths(email: string, uid: string): Promise<string[]>;
    deletePaths(paths: string[]): Promise<void>;
    /** The Stripe customer id on the profile; read before the profile goes. */
    stripeCustomerId(uid: string): Promise<string | null>;
    deleteStripeCustomer(customerId: string): Promise<ProcessorStatus>;
    /** The same erase against the other doc store (Firestore vs Postgres copy). */
    eraseMirrorStore(uid: string, email: string | null): Promise<ProcessorStatus>;
    /** Every uid-keyed table in PG_USER_KEYED_TABLES. */
    deletePgRows(uid: string): Promise<ProcessorStatus>;
    /** Behavioural-ledger rows stamped with this uid. */
    deleteTelemetry(uid: string): Promise<ProcessorStatus>;
    /** PostHog person, events and replays for this distinct id. */
    deleteAnalyticsPerson(uid: string): Promise<ProcessorStatus>;
    /** The pre-WorkOS Firebase Authentication record, if one is left. */
    deleteLegacySignIn(uid: string): Promise<boolean>;
    /** The WorkOS sign-in record. */
    deleteSignIn(uid: string): Promise<void>;
    /** Suppression, then the email-follow identity store. */
    forgetEmail(email: string): Promise<void>;
    logError(message: string): void;
}

export interface EraseAccountInput {
    uid: string;
    /** The real sign-in email, or null for a username-only account. */
    email: string | null;
}

export async function eraseAccount(input: EraseAccountInput, deps: EraseAccountDeps): Promise<ProcessorResult[]> {
    const results: ProcessorResult[] = [];
    // Stable, greppable tag; a skipped processor is never silent. No secrets:
    // only the processor name, status and (for Stripe) the customer id.
    const report = (processor: string, status: ProcessorStatus, detail = "") => {
        results.push({ processor, status });
        if (isSkipped(status)) deps.logError(`[erase] processor=${processor} status=${status}${detail ? ` ${detail}` : ""}`);
    };
    // Third parties with their own outages: failing to reach one must not
    // leave the account half deleted, so it is reported rather than thrown.
    const attempt = async (processor: string, run: () => Promise<ProcessorStatus | boolean>, detail = "") => {
        try {
            const outcome = await run();
            report(processor, typeof outcome === "boolean" ? (outcome ? "deleted" : "not-found") : outcome, detail);
        } catch (error) {
            report(processor, "failed", `${detail} reason=${error instanceof Error ? error.message : "unknown"}`.trim());
        }
    };

    const customerId = await deps.stripeCustomerId(input.uid);
    const paths = await deps.ownedPaths(input.uid);
    if (input.email) paths.push(...(await deps.emailPaths(input.email, input.uid)));
    await deps.deletePaths([...new Set(paths)]);

    report("pg-rows", await deps.deletePgRows(input.uid));
    report("telemetry", await deps.deleteTelemetry(input.uid));

    if (customerId) await attempt("stripe", () => deps.deleteStripeCustomer(customerId), `customer=${customerId}`);
    else report("stripe", "not-applicable");
    await attempt("mirror-store", () => deps.eraseMirrorStore(input.uid, input.email));
    await attempt("posthog", () => deps.deleteAnalyticsPerson(input.uid));
    await attempt("firebase-auth", () => deps.deleteLegacySignIn(input.uid));

    await deps.deleteSignIn(input.uid);
    if (input.email) await deps.forgetEmail(input.email);
    return results;
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

export function storeEraseDeps(db: Firestore): Pick<EraseAccountDeps, "ownedPaths" | "emailPaths" | "deletePaths" | "stripeCustomerId"> {
    return {
        stripeCustomerId: (uid) => readStripeCustomerId(db, uid),
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

/** The customer id on `profiles/{uid}`; must be read before that doc is deleted. */
export async function readStripeCustomerId(db: Firestore, uid: string): Promise<string | null> {
    const id = (await db.collection("profiles").doc(uid).get()).data()?.stripe_customer_id;
    return typeof id === "string" && id.length > 0 ? id : null;
}

/** Deletes the Stripe customer (and with it their saved cards and subscriptions). */
export async function deleteStripeCustomer(
    customerId: string,
    stripe: Pick<NonNullable<ReturnType<typeof getStripe>>, "customers"> | null = getStripe(),
): Promise<ProcessorStatus> {
    if (!stripe) return "not-configured";
    try {
        await stripe.customers.del(customerId);
        return "deleted";
    } catch (error) {
        if ((error as { code?: unknown }).code === "resource_missing") return "not-found";
        throw error;
    }
}

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

/**
 * The other doc store. Firestore and the sealed Postgres copy are filled by
 * scripts/firestore-to-postgres.ts (a one-off copy, re-run after the
 * DATA_STORE flip) and flipping DATA_STORE back is the documented rollback
 * until Firestore is wiped, so whichever store is not primary still holds a
 * full copy of the person. Erases from it with the same manifest sweep.
 * Firestore primary with no DATA_PG_URL means no Postgres copy exists.
 */
export async function eraseMirrorStore(uid: string, email: string | null): Promise<ProcessorStatus> {
    let mirror: Firestore;
    if (usesPostgresStore()) mirror = getFirestoreDb();
    else if (process.env.DATA_PG_URL?.trim()) mirror = getPgDocDb() as unknown as Firestore;
    else return "not-applicable";
    const store = storeEraseDeps(mirror);
    const paths = await store.ownedPaths(uid);
    if (email) paths.push(...(await store.emailPaths(email, uid)));
    await store.deletePaths([...new Set(paths)]);
    return "deleted";
}
