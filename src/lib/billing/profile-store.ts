/**
 * Billing fields on `profiles/{uid}` — server-only.
 *   stripe_customer_id: string          set once by checkout
 *   grants: {id, at, days}[]            dated free-access entries, appended by addGrant
 *   access_until: number (epoch ms)     the ONE access field, written only by recompute
 */
import type { Firestore } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";

let db: () => Firestore = getAdminDb;
/** Tests stand in for the profile store; no argument restores it. */
export function useBillingDb(stand?: Firestore): void {
    db = stand ? () => stand : getAdminDb;
}
const profiles = () => db().collection("profiles");

/** Profile fields only the server may write; firestore.rules denies them to clients (tested against that file). */
export const SERVER_ONLY_PROFILE_FIELDS: readonly string[] = [
    "stripe_customer_id",
    "access_until",
    "grants",
    "billing_updated_at",
    "retention_warned_for",
    "retention_warned_at",
    "retention_first_seen_at",
    // Pre-redesign billing fields: no longer written, but a client must still never set them.
    "paid_until",
    "granted_until",
    "stripe_subscription_id",
    "stripe_subscription_status",
    "stripe_current_period_end",
    "billing_entitled",
    "billing_event_created",
    "stripe_last_payment_failed_at",
];

export interface Grant {
    id: string;
    at: number;
    days: number;
}

export async function findUidByStripeCustomerId(customerId: string): Promise<string | null> {
    const snap = await profiles().where("stripe_customer_id", "==", customerId).limit(1).get();
    return snap.empty ? null : (snap.docs[0]?.id ?? null);
}

export interface ProfileBilling {
    stripeCustomerId: string | null;
    grants: Grant[];
}

const isGrant = (g: unknown): g is Grant =>
    !!g && typeof g === "object" && typeof (g as Grant).id === "string" && Number.isFinite((g as Grant).at) && Number.isFinite((g as Grant).days);

export function shapeProfileBilling(data: Record<string, unknown> | undefined): ProfileBilling {
    return {
        stripeCustomerId: typeof data?.stripe_customer_id === "string" && data.stripe_customer_id ? data.stripe_customer_id : null,
        grants: Array.isArray(data?.grants) ? data.grants.filter(isGrant) : [],
    };
}

/** The raw profile document (undefined when none); a read error throws. */
export async function readProfile(uid: string): Promise<Record<string, unknown> | undefined> {
    return (await profiles().doc(uid).get()).data();
}

export async function readProfileBilling(uid: string): Promise<ProfileBilling> {
    return shapeProfileBilling(await readProfile(uid));
}

export async function writeStripeCustomerId(uid: string, customerId: string): Promise<void> {
    await profiles().doc(uid).set({ stripe_customer_id: customerId }, { merge: true });
}

export async function writeAccessUntil(uid: string, accessUntil: number, customerId: string | null): Promise<void> {
    await profiles().doc(uid).set(
        {
            access_until: accessUntil,
            ...(customerId ? { stripe_customer_id: customerId } : {}),
            billing_updated_at: new Date().toISOString(),
        },
        { merge: true },
    );
}

/** Appends the grant unless one with this id exists, in the same transaction. True when it was added. */
export async function appendGrantOnce(uid: string, grant: Grant): Promise<boolean> {
    const ref = profiles().doc(uid);
    return db().runTransaction(async (tx) => {
        const { grants } = shapeProfileBilling((await tx.get(ref)).data());
        if (grants.some((g) => g.id === grant.id)) return false;
        tx.set(ref, { grants: [...grants, grant] }, { merge: true });
        return true;
    });
}
