/**
 * Signup asks for an email and a password only; the username (profile key,
 * `metadata.username`) is derived from the email local part. Pure over the
 * injected `isTaken`, so the uniqueness source stays at the caller.
 */
const MIN_LENGTH = 3; // same floor the signup form used to enforce
const FALLBACK_BASE = "user";
const MAX_ATTEMPTS = 20;

function baseFrom(email: string): string {
    const local = email.slice(0, email.lastIndexOf("@")).split("+")[0];
    const base = local.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
    return base.length >= MIN_LENGTH ? base : FALLBACK_BASE;
}

export async function deriveUsername(email: string, isTaken: (username: string) => Promise<boolean>): Promise<string> {
    const base = baseFrom(email);
    for (let n = 1; n <= MAX_ATTEMPTS; n++) {
        const candidate = n === 1 ? base : `${base}${n}`;
        if (!(await isTaken(candidate))) return candidate;
    }
    throw new Error("no free username derived from email");
}
