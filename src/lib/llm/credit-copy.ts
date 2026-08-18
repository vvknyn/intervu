/**
 * User-facing vocabulary for the shared-key AI allowance.
 *
 * Deliberately a pure copy module with NO imports: `credit-gate.ts`, where
 * the amounts live, pulls in firebase-admin, so a "use client" surface like
 * the sidebar balance can't read the noun from there. Both the client
 * indicator and the server-rendered /pricing page import it from here.
 *
 * Why it exists: /pricing described the allowance in "coins" while every
 * surface a user actually sees — the sidebar balance, the out-of-credits
 * block, /terms — said "credits" (found 2026-08-18). The one page whose job
 * is explaining the economy used a word the product never shows. One noun,
 * one export, so the two can't disagree again.
 */

export const CREDIT_UNIT = { one: "credit", many: "credits" } as const;

/** "1 credit" / "40 credits" — the only place the unit is pluralized. */
export function creditCount(n: number): string {
    return `${n} ${n === 1 ? CREDIT_UNIT.one : CREDIT_UNIT.many}`;
}
