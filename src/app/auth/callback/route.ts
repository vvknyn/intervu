import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { relativeRedirect } from "@/lib/http/relative-redirect";
import { validateNextParam } from "@/lib/auth/product-routes";
import { ensureAppMembership } from "@/lib/auth/ensure-app-membership";
import { APP_INTERVU, resolveLegacyUid } from "@/lib/auth/app-tag";
import { sendWelcomeEmailOnce } from "@/lib/email/welcome";
import { grantWelcomeCredits } from "@/lib/llm/credit-gate";

/**
 * Supabase OAuth code-exchange callback — the ONE place a Google sign-in
 * ever touches the server, since GoTrue completes the whole redirect dance
 * itself. This is also where a Google-authenticated user gets tagged for
 * intervu (see ensureAppMembership's doc): a database trigger on
 * `auth.users` can't do it, because an INSERT there carries no signal about
 * which product the person was signing into.
 *
 * Uses `relativeRedirect` (not an absolute `${origin}${path}` URL) — behind
 * this app's reverse proxy, `request.url`'s origin is the container's own
 * bind address, not the public host, so an absolute redirect built from it
 * strands the browser there.
 *
 * Consolidated from the Firebase-era stub that used to live at this exact
 * path (kept only to avoid 404s from old links — see git history) and
 * `auth/supabase-callback`, where phase 1 parked this route to avoid
 * overwriting that stub before it was wired in. This is the conventional
 * path and the one registered as an authorized redirect URL in the
 * Supabase dashboard.
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    // Preserving the stub's contract: never throw, never surface a raw error
    // page — a request with no `code` (an old bookmark, a replay) bounces to
    // the sign-in entry, same as the stub's unconditional redirect to "/".
    if (!code) {
        return relativeRedirect("/login");
    }

    const next = validateNextParam(searchParams.get("next")) ?? "/";

    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.user) {
        return relativeRedirect("/login");
    }
    const user = data.user;

    // Tag membership before the redirect, so no subsequent request can ever
    // observe an authenticated-but-untagged intervu session.
    const { added } = await ensureAppMembership(user.id, APP_INTERVU);

    // Only fire the welcome email / credit grant the moment this user is
    // NEW to intervu (first tag write) — this route otherwise runs on every
    // Google sign-in, and re-sending a "welcome" + re-granting credits to a
    // returning user on every login would be wrong, unlike signUp
    // (actions/auth.ts), which only ever runs once per account by
    // construction. Deferred to `after()` so the redirect isn't held up on
    // Resend/Firestore, mirroring the pattern this replaces
    // (api/auth/session/route.ts, now deleted — its only callers were the
    // client-side session-cookie sync this SSR client makes unnecessary).
    if (added) {
        const uid = resolveLegacyUid(user);
        const email = user.email;
        after(async () => {
            await sendWelcomeEmailOnce(uid, email);
            await grantWelcomeCredits(uid).catch((err) =>
                console.error("[auth/callback] welcome credit grant failed:", err),
            );
        });
    }

    return relativeRedirect(next);
}
