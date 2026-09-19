/**
 * The single "next step" ask a /co/[slug] visitor sees across every gate on
 * the page. Two independent gates each guard their own content —
 * `CompanyExhaustGate` (server-side, sign-in only) for the full record, and
 * `CompanyIntelGate` (client-side, follow-confirmed) for hiring history —
 * and each used to render its own lock card whenever ITS OWN condition was
 * unmet. An anonymous visitor fails both conditions at once, so the page
 * stacked two near-duplicate cards. This function is the shared seam: it
 * picks ONE next step so a call site can show exactly one card instead of
 * one per gate. Neither gate's own content-guarding logic changes — only
 * which card (if any) a call site renders does.
 */
export type CompanyUnlockStep = "sign-in" | "follow" | null;

export function companyUnlockStep(input: { signedIn: boolean; following: boolean }): CompanyUnlockStep {
  if (input.following) return null;
  return input.signedIn ? "follow" : "sign-in";
}
