/**
 * The shared-key AI allowance as BOTH sides must see it: the user-facing
 * vocabulary, and the one switch that decides whether any of that vocabulary
 * is currently true.
 *
 * Deliberately a pure module with NO imports: `credit-gate.ts`, where the
 * amounts and the charge path live, pulls in firebase-admin, so a "use
 * client" surface like the sidebar balance can't read from there. Both the
 * client indicator and the server-rendered /pricing page import from here.
 *
 * Why the vocabulary is here: /pricing described the allowance in "coins"
 * while every surface a user actually sees — the sidebar balance, the
 * out-of-credits block, /terms — said "credits" (found 2026-08-18). The one
 * page whose job is explaining the economy used a word the product never
 * shows. One noun, one export, so the two can't disagree again.
 *
 * Why the switch is here too: it is the same class of bug one level up.
 * Metering and the copy describing it are two halves of one promise, and the
 * dangerous states are the mismatched ones — charging silently while the
 * page says "unlimited" is a lie, and advertising a limit nothing enforces is
 * the bug this file's history is made of. Both halves now read this one
 * boolean, so flipping it moves enforcement and disclosure together.
 */

export const CREDIT_UNIT = { one: "credit", many: "credits" } as const;

/** "1 credit" / "40 credits" — the only place the unit is pluralized. */
export function creditCount(n: number): string {
    return `${n} ${n === 1 ? CREDIT_UNIT.one : CREDIT_UNIT.many}`;
}

/**
 * Beta policy (product decision 2026-08-18): AI actions cost nothing.
 *
 * The ledger stays fully wired — balances, the welcome grant, the monthly
 * allowance and the atomic decrement are all still here and still correct —
 * but `chargeIfSharedKey` short-circuits above `consumeCredit`, so no action
 * draws against it. That is why this is a switch rather than a giant
 * `MONTHLY_FREE_CREDITS`: a fake balance would still tick down, and the
 * sidebar would still show a counter that means nothing.
 *
 * Flipping this to `false` turns metering back on AND flips /pricing's copy,
 * the meta description and the sidebar indicator back to the credit story in
 * the same commit. `tests/unit/pricing.test.ts` asserts both halves move
 * together and that `credit-gate.ts` reads this same constant, so a
 * copy-only or gate-only flip fails the build.
 */
// Annotated `boolean`, not left to infer the literal `true`: without it TS
// narrows every `if (BETA_UNLIMITED_CREDITS)` and picks one arm of every
// ternary, so the other arm — the metered copy that must still be correct
// the day this flips — stops being reachable to the type checker and tests.
export const BETA_UNLIMITED_CREDITS: boolean = true;

/** Sidebar tooltip while `BETA_UNLIMITED_CREDITS` is on — the balance shown
 *  is real but unspent, so the indicator explains why it never moves. */
export const BETA_UNLIMITED_NOTE = "Free while we're in beta — AI actions aren't metered.";
