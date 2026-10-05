import { sealData, unsealData } from "iron-session";
import { authCookiePassword } from "@/lib/auth/authkit-state";
import { validateNextParam } from "@/lib/auth/product-routes";

/**
 * The "enter the code we emailed you" step a Google sign-in can need.
 *
 * WorkOS sometimes holds a Google sign-in until the person proves they own
 * the address: `authenticateWithCode` answers `email_verification_required`
 * (an `AuthenticationException` carrying a `pendingAuthenticationToken`),
 * WorkOS emails a six-digit code, and sign-in finishes only when the app
 * sends that code back with `authenticateWithEmailVerification`. AuthKit's
 * hosted page runs that step itself, but Continue with Google skips the hosted
 * page (`withAuthProvider`, authkit-url.ts), so the step lands on us. Before
 * this, /auth/callback treated it as a failed exchange: "We couldn't finish
 * signing you in", and Start again sent another code and failed the same way
 * (2026-10-04 replay: a dietitian applying from a phone; PostHog
 * `auth_callback_failed` code=email_verification_required).
 *
 * The pending token rides in a sealed, httpOnly cookie scoped to /auth, never
 * in a URL, and lives as long as WorkOS's own pending token and code.
 */
export const EMAIL_CODE_PATH = "/auth/verify-email";
export const EMAIL_CODE_COOKIE_NAME = "intervu_email_code";
/** WorkOS's pending token and the emailed code both expire after 10 minutes. */
export const EMAIL_CODE_TTL_SECONDS = 10 * 60;

export interface PendingEmailCode {
    pendingAuthenticationToken: string;
    /** The address WorkOS sent the code to, shown so the person knows which inbox to open. */
    email: string | null;
    /** Validated return path from the sign-in's `state`; null falls back to the default landing. */
    next: string | null;
}

/** Pure: the held sign-in inside a WorkOS `email_verification_required` error, else null. */
export function pendingEmailCodeFromError(error: unknown): Omit<PendingEmailCode, "next"> | null {
    const e = error as { code?: unknown; pendingAuthenticationToken?: unknown; rawData?: { email?: unknown } } | null;
    if (!e || typeof e !== "object" || e.code !== "email_verification_required") return null;
    if (typeof e.pendingAuthenticationToken !== "string" || e.pendingAuthenticationToken === "") return null;
    const email = typeof e.rawData?.email === "string" && e.rawData.email !== "" ? e.rawData.email : null;
    return { pendingAuthenticationToken: e.pendingAuthenticationToken, email };
}

/** Pure: the six digits someone typed or pasted ("123456", "123 456", "123-456"), else null. */
export function normalizeEmailCode(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const digits = raw.replace(/[\s-]/g, "");
    return /^\d{6}$/.test(digits) ? digits : null;
}

export async function sealPendingEmailCode(pending: PendingEmailCode): Promise<string> {
    return sealData(pending, { password: authCookiePassword(), ttl: EMAIL_CODE_TTL_SECONDS });
}

/** The pending sign-in from the cookie, or null when it is missing, expired, tampered with or malformed. */
export async function unsealPendingEmailCode(sealed: string | null | undefined): Promise<PendingEmailCode | null> {
    if (!sealed) return null;
    try {
        const data = await unsealData<Partial<Record<keyof PendingEmailCode, unknown>>>(sealed, {
            password: authCookiePassword(),
            ttl: EMAIL_CODE_TTL_SECONDS,
        });
        if (typeof data.pendingAuthenticationToken !== "string" || data.pendingAuthenticationToken === "") return null;
        return {
            pendingAuthenticationToken: data.pendingAuthenticationToken,
            email: typeof data.email === "string" ? data.email : null,
            next: typeof data.next === "string" ? validateNextParam(data.next) : null,
        };
    } catch {
        return null;
    }
}

export function emailCodeCookieOptions() {
    return {
        path: "/auth",
        maxAge: EMAIL_CODE_TTL_SECONDS,
        httpOnly: true,
        sameSite: "lax" as const,
        secure: process.env.NODE_ENV === "production",
    };
}

/**
 * Pure: where "send a new code" and "Start again" go — Continue with Google
 * again, back to the same place. A code can't be re-sent on its own: WorkOS
 * mails one each time it holds a sign-in, so restarting the sign-in is what
 * brings a fresh code (and a fresh pending token) back to this step.
 */
export function emailCodeRestartHref(next: string | null): string {
    const params = new URLSearchParams({ provider: "GoogleOAuth" });
    const safeNext = validateNextParam(next);
    if (safeNext) params.set("next", safeNext);
    return `/auth/start?${params.toString()}`;
}
