import { minutesLabel } from "@/lib/shield/rate-limit";

/**
 * What /auth/verify-email says (email-code-pending.ts explains why the step
 * exists). Its own module because a "use server" file may export only async
 * functions, and the journey spec reads the same strings.
 */

export const EMAIL_CODE_HEADLINE = "Check your email";

/** Pure: the line under the heading. Names the inbox when WorkOS said which one. */
export function emailCodeBody(email: string | null): string {
    return email
        ? `One last step to finish signing in: enter the 6-digit code we just sent to ${email}.`
        : "One last step to finish signing in: enter the 6-digit code we just emailed you.";
}

export const EMAIL_CODE_FIELD_LABEL = "6-digit code";
export const EMAIL_CODE_SUBMIT_LABEL = "Finish signing in";
export const EMAIL_CODE_RESEND_PROMPT = "No email after a minute? Check spam, or";
/** Restarts Continue with Google, which makes WorkOS email a fresh code and come back here. */
export const EMAIL_CODE_RESEND_LABEL = "send a new code";

export const EMAIL_CODE_FORMAT_MESSAGE = "Enter the 6 digits from the email.";
export const EMAIL_CODE_WRONG_MESSAGE =
    "That code didn't work. Check the newest email from us and type its code, or send a new code.";

/** Pure: what a per-IP refusal of the code step says. */
export function emailCodeRateLimitMessage(retryAfterMs: number): string {
    return `Too many codes tried from your network just now. Try again in ${minutesLabel(retryAfterMs)}.`;
}

export const EMAIL_CODE_EXPIRED_HEADLINE = "That code has expired";
export const EMAIL_CODE_EXPIRED_BODY =
    "Codes from the email work for 10 minutes. Start again and we'll send a new one, then bring you back to where you were.";
export const EMAIL_CODE_EXPIRED_BUTTON_LABEL = "Start again";
