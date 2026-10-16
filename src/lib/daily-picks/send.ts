/**
 * The daily picks email for one account. `previewDailyPicksForUser` does
 * everything up to "here's the exact email" without sending or recording
 * anything, so a dry run is the real path; `sendDailyPicksForUser` sends it
 * and records the roles as sent.
 *
 * Nothing goes out unless the person turned daily picks on, has an address
 * mail reaches, hasn't unsubscribed from it (checked again by `sendEmail`),
 * and has at least one role they haven't been sent. An empty email is never
 * sent: a day with no new picks is a day with no email.
 *
 * Plain module, server code only.
 */
import { isMintedLoginEmail } from "@/lib/auth/username-email";
import { getAgentPreferences } from "@/lib/agent/preferences";
import { searchAsTheSite } from "@/lib/agent/search-as-the-site";
import { digestEmailForUid } from "@/lib/email/digest/send";
import { sendEmail, type SendEmailResult } from "@/lib/email/send";
import { buildDailyPicksEmail, type DailyPickItem } from "@/lib/email/templates/daily-picks";
import { signUnsubscribeToken } from "@/lib/email/unsubscribe-token";
import type { TodayRole } from "@/lib/jobs/for-you/today";
import { jobPath } from "@/lib/jobs/job-slug";
import { LOCATION_UNKNOWN_TEXT } from "@/lib/jobs/presentation";
import { explainMatch } from "@/lib/match/explain";
import { matchLabel } from "@/lib/match/score";
import { presentJob } from "@/lib/presentation";
import { listPursuitsForUser } from "@/lib/pursuits/list";
import { getBaseResumeForUser } from "@/lib/resume/base-resume";
import { getSiteUrl } from "@/lib/seo/constants";
import { collectDailyPicks, type DailyPicksDeps, type DailyPicksNoResume } from "./collect";
import { DAILY_PICKS_MIN_GAP_MS } from "./pick";
import { getDailyPicksState, recordDailyPicksSent, type DailyPicksState } from "./state";

/** The run's own reads, the same ones the MCP tools use (route.ts). */
export const DAILY_PICKS_SERVER_DEPS: DailyPicksDeps = {
    getBaseResume: getBaseResumeForUser,
    getPreferences: getAgentPreferences,
    search: searchAsTheSite,
    listApplications: listPursuitsForUser,
};

export type DailyPicksSkipReason =
    | "off"
    | "sent-recently"
    | "no-email"
    | "no-mailbox"
    | "missing-unsubscribe-url"
    | `no-resume-${DailyPicksNoResume}`
    | "search-unavailable"
    | "no-new-picks";

export interface DailyPicksPreview {
    email: string;
    subject: string;
    html: string;
    text: string;
    unsubscribeUrl: string;
    picks: TodayRole[];
    state: DailyPicksState;
}

export type DailyPicksPreviewResult = DailyPicksPreview | { skipped: DailyPicksSkipReason };

/** One pick as the email words it: the row the site shows, its fit word and the reason behind it. */
export function dailyPickItem(role: TodayRole, siteUrl: string): DailyPickItem {
    const presented = presentJob(role.job);
    const placeKnown = role.job.work_type === "remote" || presented.location !== LOCATION_UNKNOWN_TEXT;
    return {
        title: presented.title,
        employer: presented.company.name,
        location: placeKnown ? presented.location : null,
        salary: presented.salary,
        fit: matchLabel(role.score),
        why: explainMatch(role.score),
        href: `${siteUrl}${jobPath(role.job)}`,
    };
}

export async function previewDailyPicksForUser(
    uid: string,
    opts: { nowMs: number; deps?: DailyPicksDeps },
): Promise<DailyPicksPreviewResult> {
    const state = await getDailyPicksState(uid);
    if (!state.on) return { skipped: "off" };
    const lastMs = state.lastSentAt ? Date.parse(state.lastSentAt) : NaN;
    if (!Number.isNaN(lastMs) && opts.nowMs - lastMs < DAILY_PICKS_MIN_GAP_MS) return { skipped: "sent-recently" };

    const email = await digestEmailForUid(uid);
    if (!email) return { skipped: "no-email" };
    if (isMintedLoginEmail(email)) return { skipped: "no-mailbox" };
    const token = signUnsubscribeToken(email, "daily_picks");
    if (!token) return { skipped: "missing-unsubscribe-url" };
    const siteUrl = getSiteUrl();
    const unsubscribeUrl = `${siteUrl}/unsubscribe?token=${encodeURIComponent(token)}`;

    const result = await collectDailyPicks(uid, opts.deps ?? DAILY_PICKS_SERVER_DEPS, { nowMs: opts.nowMs, sent: state.sent });
    if (result.kind === "no-resume") return { skipped: `no-resume-${result.reason}` };
    if (result.kind === "unavailable") return { skipped: "search-unavailable" };
    if (result.picks.length === 0) return { skipped: "no-new-picks" };

    const built = buildDailyPicksEmail({
        siteUrl,
        unsubscribeUrl,
        picks: result.picks.map((role) => dailyPickItem(role, siteUrl)),
        languages: result.signals.languages?.value ?? undefined,
        languagesLeftOut: result.languagesLeftOut,
    });
    return { email, unsubscribeUrl, picks: result.picks, state, ...built };
}

export type DailyPicksSendResult = SendEmailResult | { sent: false; reason: DailyPicksSkipReason };

export async function sendDailyPicksForUser(uid: string, opts: { nowMs: number }): Promise<DailyPicksSendResult> {
    const preview = await previewDailyPicksForUser(uid, opts);
    if ("skipped" in preview) return { sent: false, reason: preview.skipped };

    const result = await sendEmail({
        to: preview.email,
        subject: preview.subject,
        html: preview.html,
        text: preview.text,
        kind: "daily_picks",
        unsubscribeUrl: preview.unsubscribeUrl,
    });
    if (result.sent) {
        await recordDailyPicksSent(
            uid,
            preview.state.sent,
            preview.picks.map((r) => r.job),
            new Date(opts.nowMs).toISOString(),
        );
    }
    return result;
}
