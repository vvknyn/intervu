import { initializeApp, getApps, cert, App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Firestore } from "firebase-admin/firestore";

import { getPgDocDb } from "@/lib/db/docstore/pg-docstore";

let adminApp: App;
let adminDb: Firestore;

function getAdminApp(): App {
    if (!adminApp) {
        if (getApps().length === 0) {
            const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
            if (serviceAccount) {
                adminApp = initializeApp({
                    credential: cert(JSON.parse(serviceAccount)),
                });
            } else {
                // Fallback: use individual env vars
                adminApp = initializeApp({
                    credential: cert({
                        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
                        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
                    }),
                });
            }
        } else {
            adminApp = getApps()[0];
        }
    }
    return adminApp;
}

/**
 * Where account data lives. DATA_STORE=postgres serves every caller from our
 * own Postgres with each document sealed (src/lib/db/docstore/pg-docstore.ts),
 * through the same Firestore-shaped calls, so no call site changes. Unset, or
 * anything else, is Firestore, which is how this ships: the switch flips only
 * after the copy (scripts/firestore-to-postgres.ts) has run and checked out,
 * and flipping it back is the rollback until Firestore is wiped.
 */
export function usesPostgresStore(): boolean {
    return process.env.DATA_STORE?.trim().toLowerCase() === "postgres";
}

export function getAdminDb(): Firestore {
    if (usesPostgresStore()) {
        // The pool and the data key are only touched here, so a Firestore
        // deploy never connects to Postgres or needs DATA_ENCRYPTION_KEY.
        return getPgDocDb() as unknown as Firestore;
    }
    return getFirestoreDb();
}

/** Firestore itself, whatever DATA_STORE says: only the copy and wipe
 *  scripts (scripts/firestore-to-postgres.ts, scripts/firestore-wipe.ts)
 *  need this; app code reads account data through getAdminDb(). */
export function getFirestoreDb(): Firestore {
    if (!adminDb) {
        adminDb = getFirestore(getAdminApp());
    }
    return adminDb;
}

/**
 * Deletes the Firebase Authentication record left from before sign-in moved
 * to WorkOS: scripts/migrate-firebase-to-workos.ts copied each account and
 * never removed the original, which still holds the email. The uid is the
 * same one WorkOS keeps as externalId. False when there is none.
 */
export async function deleteLegacyFirebaseUser(uid: string): Promise<boolean> {
    try {
        await getAuth(getAdminApp()).deleteUser(uid);
        return true;
    } catch (error) {
        if ((error as { code?: unknown }).code === "auth/user-not-found") return false;
        throw error;
    }
}
