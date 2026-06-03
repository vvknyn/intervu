import { initializeApp, getApps, cert, App } from "firebase-admin/app";
import { getAuth, Auth } from "firebase-admin/auth";
import { getFirestore, Firestore } from "firebase-admin/firestore";

let adminApp: App;
let adminAuth: Auth;
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

export function getAdminAuth(): Auth {
    if (!adminAuth) {
        adminAuth = getAuth(getAdminApp());
    }
    return adminAuth;
}

export function getAdminDb(): Firestore {
    if (!adminDb) {
        adminDb = getFirestore(getAdminApp());
    }
    return adminDb;
}
