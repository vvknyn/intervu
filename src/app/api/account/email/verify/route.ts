/**
 * GET /api/account/email/verify?token=... — the confirm half of "attach a
 * reachable address to this account".
 *
 * The token is the sole authority, deliberately: it is bound to both the uid
 * and the address, expires in 24h, and was delivered TO the address being
 * attached, which is the thing being proven. Requiring a session on top would
 * break the ordinary case of opening the mail on a phone that isn't signed in,
 * without adding a guarantee the token doesn't already carry.
 *
 * Every failure lands on the same redirect with no detail, matching
 * /api/follow-email/verify: expired, tampered, already-used and
 * address-taken are indistinguishable to the caller, because telling an
 * unauthenticated visitor which one it was is free information about both
 * the token format and who holds which address.
 */
import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { createAdminClient } from "@/lib/supabase/server";
import { getAppUser } from "@/lib/auth/user-directory";
import { APP_INTERVU } from "@/lib/auth/app-tag";
import { verifyAccountEmailToken } from "@/lib/email/account-email-token";
import { relativeRedirect } from "@/lib/http/relative-redirect";

const FAILURE_PATH = "/settings?email_confirmed=0";
const SUCCESS_PATH = "/settings?email_confirmed=1";

export async function GET(request: Request): Promise<NextResponse> {
    const token = new URL(request.url).searchParams.get("token");
    const claim = verifyAccountEmailToken(token, Date.now());
    if (!claim) return relativeRedirect(FAILURE_PATH);

    // `claim.uid` is whichever id the app held when the token was minted, so
    // for a migrated account it is the legacy Firebase uid, which is NOT the
    // row's primary key. `getAppUser` resolves either spelling and fails
    // closed on the app tag, so a subspace-only account can't be edited
    // through intervu's confirmation link.
    const user = await getAppUser(claim.uid, APP_INTERVU).catch(() => null);
    if (!user) return relativeRedirect(FAILURE_PATH);

    try {
        // email_confirm: the person just proved control of this mailbox by
        // opening a link only it received. Leaving it unconfirmed would make
        // GoTrue treat a confirmed address as unconfirmed, and it refuses to
        // link an OAuth identity onto an unconfirmed account — so skipping
        // this would break their next Google sign-in.
        const admin = await createAdminClient();
        const { error } = await admin.auth.admin.updateUserById(user.id, {
            email: claim.email,
            email_confirm: true,
        });
        if (error) throw new Error(error.message);
    } catch (e) {
        // The common real failure is the address already belonging to another
        // account. Nothing the visitor can fix here, and the pending value
        // stays put so the settings page keeps showing the attempt rather
        // than silently forgetting it.
        console.error("[account-email] verify failed:", e instanceof Error ? e.message : e);
        return relativeRedirect(FAILURE_PATH);
    }

    // Clearing is best-effort and deliberately AFTER the auth write: the
    // address is attached either way, and a stale pending value only affects
    // a label, whereas failing the whole flow on a cleanup error would lose
    // a confirmation the person already completed.
    //
    // Keyed on `legacyUid`, not `claim.uid`: Firestore documents are keyed by
    // the pre-migration id, and the token may carry either spelling.
    try {
        await getAdminDb().collection("profiles").doc(user.legacyUid).set(
            { pending_email: null, pending_email_at: null },
            { merge: true },
        );
    } catch (e) {
        console.error("[account-email] pending clear failed:", e instanceof Error ? e.message : e);
    }

    return relativeRedirect(SUCCESS_PATH);
}
