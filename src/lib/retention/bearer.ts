import { timingSafeEqual } from "node:crypto";

/** Constant-time check of an `Authorization: Bearer <secret>` header. */
export function bearerMatches(header: string | null, secret: string): boolean {
    if (!secret) return false;
    const given = Buffer.from(header ?? "");
    const expected = Buffer.from(`Bearer ${secret}`);
    return given.length === expected.length && timingSafeEqual(given, expected);
}
