/**
 * One normalization rule for every email-domain lookup key — suppression
 * doc ids, unsubscribe tokens, and preference reads all have to derive the
 * SAME key from the same address or a lookup silently misses (e.g. a
 * suppression written for "Foo@x.com" that a later check for "foo@x.com"
 * never finds). Mirrors the trim().toLowerCase() every existing email
 * schema already applies (waitlist.ts, connect-waitlist.ts) — same rule,
 * one place, so a new caller can't drift from it.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
