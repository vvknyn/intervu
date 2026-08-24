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
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { verifyAccountEmailToken } from "@/lib/email/account-email-token";
import { relativeRedirect } from "@/lib/http/relative-redirect";

const FAILURE_PATH = "/settings?email_confirmed=0";
const SUCCESS_PATH = "/settings?email_confirmed=1";

export async function GET(request: Request): Promise<NextResponse> {
    const token = new URL(request.url).searchParams.get("token");
    const claim = verifyAccountEmailToken(token, Date.now());
    if (!claim) return relativeRedirect(FAILURE_PATH);

    try {
        // emailVerified: the person just proved control of this mailbox by
        // opening a link only it received. Leaving it false would make
        // Firebase treat a confirmed address as unconfirmed, and any later
        // provider linking would refuse it.
        await getAdminAuth().updateUser(claim.uid, {
            email: claim.email,
            emailVerified: true,
        });
    } catch (e) {
        // The common real failure is `auth/email-already-exists` — the
        // address belongs to another account. Nothing the visitor can fix
        // here, and the pending value stays put so the settings page keeps
        // showing the attempt rather than silently forgetting it.
        console.error("[account-email] verify failed:", e instanceof Error ? e.message : e);
        return relativeRedirect(FAILURE_PATH);
    }

    // Clearing is best-effort and deliberately AFTER the auth write: the
    // address is attached either way, and a stale pending value only affects
    // a label, whereas failing the whole flow on a cleanup error would lose
    // a confirmation the person already completed.
    try {
        await getAdminDb().collection("profiles").doc(claim.uid).set(
            { pending_email: null, pending_email_at: null },
            { merge: true },
        );
    } catch (e) {
        console.error("[account-email] pending clear failed:", e instanceof Error ? e.message : e);
    }

    return relativeRedirect(SUCCESS_PATH);
}
