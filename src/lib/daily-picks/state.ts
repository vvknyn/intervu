/**
 * Where an account's daily picks setting and history live: the `dailyPicks`
 * map on its own `email_digest_state/<uid>` record, beside the weekly
 * digest's cursor. That record is account data like the rest (sealed with
 * the account store's key, erased with the account), so the daily picks add
 * no new place a person's data is kept.
 *
 *   dailyPicks: {
 *     on: boolean,              // they turned the email on (it is off until they do)
 *     changedAt: string,        // when they last turned it on or off
 *     sentIds, sentKeys,        // roles already emailed (pick.ts `DailyPicksSent`)
 *     lastSentAt: string,       // the last email
 *     latestIds: string[],      // that email's roles, in its order: Today pins these
 *   }
 *
 * Writes merge into the map, so the digest's `lastSentAt` beside it, and a
 * field this file doesn't write, are never touched.
 *
 * Plain module (not "use server"): imports the Admin SDK, server code only.
 */
import { getAdminDb } from "@/lib/firebase/admin";
import type { PublicJob } from "@/lib/jobs/types";
import { NOTHING_SENT, rememberSent, type DailyPicksSent } from "./pick";

const COLLECTION = "email_digest_state";

export interface DailyPicksState {
    on: boolean;
    changedAt: string | null;
    sent: DailyPicksSent;
    lastSentAt: string | null;
    /** The last email's roles, in its order. */
    latestIds: string[];
}

export const DAILY_PICKS_OFF: DailyPicksState = { on: false, changedAt: null, sent: NOTHING_SENT, lastSentAt: null, latestIds: [] };

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
const isoOrNull = (value: unknown): string | null =>
    typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;

/** Pure: the stored map as a state, with anything missing or malformed read as never set. */
export function parseDailyPicksState(raw: unknown): DailyPicksState {
    if (!raw || typeof raw !== "object") return DAILY_PICKS_OFF;
    const m = raw as Record<string, unknown>;
    return {
        on: m.on === true,
        changedAt: isoOrNull(m.changedAt),
        sent: { ids: strings(m.sentIds), keys: strings(m.sentKeys) },
        lastSentAt: isoOrNull(m.lastSentAt),
        latestIds: strings(m.latestIds),
    };
}

export async function getDailyPicksState(uid: string): Promise<DailyPicksState> {
    const snap = await getAdminDb().collection(COLLECTION).doc(uid).get();
    return parseDailyPicksState(snap.data()?.dailyPicks);
}

export async function setDailyPicksOn(uid: string, on: boolean, nowIso: string = new Date().toISOString()): Promise<void> {
    await getAdminDb()
        .collection(COLLECTION)
        .doc(uid)
        .set({ dailyPicks: { on, changedAt: nowIso } }, { merge: true });
}

/** After an email went out: remember its roles as sent, and as the ones Today pins. */
export async function recordDailyPicksSent(
    uid: string,
    sentBefore: DailyPicksSent,
    jobs: readonly PublicJob[],
    nowIso: string,
): Promise<void> {
    const sent = rememberSent(sentBefore, jobs);
    await getAdminDb()
        .collection(COLLECTION)
        .doc(uid)
        .set(
            {
                dailyPicks: {
                    sentIds: [...sent.ids],
                    sentKeys: [...sent.keys],
                    lastSentAt: nowIso,
                    latestIds: jobs.map((job) => job.id),
                },
            },
            { merge: true },
        );
}

/** Every account with the daily picks email turned on. */
export async function listDailyPicksUids(): Promise<string[]> {
    const snap = await getAdminDb().collection(COLLECTION).where("dailyPicks.on", "==", true).get();
    return snap.docs.map((doc) => doc.id);
}
