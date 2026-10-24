/**
 * Server-only reads and writes of a new account's setup (`profiles/<uid>.onboarding`,
 * state.ts). Its own file so the `"use server"` actions stay async exports
 * only, and so client code never pulls in the Admin SDK.
 */
import { getAdminDb } from "@/lib/firebase/admin";
import { hasPaidAccess } from "@/lib/billing/access";
import { shapeAgentPreferences } from "@/lib/agent/preferences";
import { ONBOARDING_FIELD } from "@/lib/auth/signup-event";
import { savedSearchesCollection } from "@/lib/jobs/saved-searches-store";
import { regionDisplayName } from "@/lib/jobs/location-default-preference";
import { migrateLegacyProfile } from "@/lib/resume/profile-migration";
import { resumeIsUsable } from "@/lib/resume/resume-usable";
import type { ResumeData } from "@/types/resume";
import {
    applyOnboardingPatch,
    parseOnboardingRecord,
    type OnboardingPatch,
    type OnboardingRecord,
    type SetupFacts,
} from "./state";

/** Everything setup shows, read in one go for an account whose setup is still open. */
export interface OnboardingView {
    record: OnboardingRecord;
    facts: SetupFacts;
    /** Read from the résumé on file, for step 1's roles and step 2's place. */
    resumeTitle: string | null;
    resumeLocation: string | null;
    resumeUpdatedAt: string | null;
    /** Settings › Preferences › Relocation, as typed. */
    relocation: string | null;
    /** The country this request comes from (db-ip), named; never stored. */
    connectionCountry: string | null;
}

function text(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Null for an account with no setup (made before it existed): one profile
 * read, and nothing else. A finished one comes back as it stands, with no
 * further reads, so Today still knows which steps were answered. An open one
 * adds a one-row saved-search read and the connection's country.
 */
export async function readOnboardingView(
    uid: string,
    connectionIso2: () => Promise<string | null>,
): Promise<OnboardingView | null> {
    const db = getAdminDb();
    const snap = await db.collection("profiles").doc(uid).get();
    const data = snap.exists ? snap.data() : undefined;
    const record = parseOnboardingRecord(data?.[ONBOARDING_FIELD]);
    if (!record) return null;
    const open = record.state === "open";

    const prefs = shapeAgentPreferences(data?.agent_preferences);
    // The stored résumé is the paid month's: without it setup reads the device
    // copy (client side), and a failed paid read answers unpaid.
    const paid = await hasPaidAccess(uid).catch(() => false);
    const stored = paid ? data : undefined;
    const resume = stored?.resume_data as ResumeData | undefined;
    const profile = resume?.profile ? migrateLegacyProfile(resume.profile) : null;
    const [searches, iso2] = open
        ? await Promise.all([savedSearchesCollection(uid).limit(1).get(), connectionIso2().catch(() => null)])
        : [null, null];

    return {
        record,
        facts: {
            resumeOnFile: resumeIsUsable(resume) || Boolean(text(stored?.resume_text)),
            roles: text(prefs.search.query),
            location: text(prefs.search.location),
            remoteOnly: prefs.search.remoteOnly === true,
            savedSearches: searches?.size ?? 0,
        },
        resumeTitle: text(profile?.profession),
        resumeLocation: text(profile?.location),
        resumeUpdatedAt: text(stored?.resume_last_updated),
        relocation: text(prefs.answers.relocation),
        connectionCountry: iso2 ? regionDisplayName(iso2) : null,
    };
}

/** Applies one write in a transaction; null when the account has no setup to change. */
export async function updateOnboarding(uid: string, patch: OnboardingPatch): Promise<OnboardingRecord | null> {
    const db = getAdminDb();
    const ref = db.collection("profiles").doc(uid);
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const record = parseOnboardingRecord(snap.get(ONBOARDING_FIELD));
        if (!record) return null;
        const next = applyOnboardingPatch(record, patch);
        tx.set(ref, { [ONBOARDING_FIELD]: next }, { merge: true });
        return next;
    });
}
