import type { ReactNode } from "react";
import { SignupGate } from "@/components/auth/SignupGate";

/**
 * One locked-band teaser row. `count` is a real, cheap aggregate computed
 * from the same exhaust module the unlocked band renders from — never a
 * placeholder and never blurred fake content (design call DC3). Omit the
 * row's count line entirely (pass `null`) when its own count query failed;
 * do not fabricate a number to fill the gap.
 */
export interface ExhaustGateTeaser {
  title: string;
  description: string;
  count: string | null;
}

/**
 * The gate's sign-in card: the site's one signed-out gate (`SignupGate`,
 * "Create free account" plus "Sign in"), with the real per-band counts as
 * what the account opens. Exported so a mock/preview harness renders the
 * exact markup a signed-out visitor sees. It is also the page's single ask
 * for an anonymous visitor (see `companyUnlockStep`), so it names what
 * following adds on top (hiring history, gated by `CompanyIntelGate`).
 */
export function ExhaustGateSignInCard({
  slug,
  displayName,
  teasers,
}: {
  slug: string;
  displayName: string;
  teasers: ExhaustGateTeaser[];
}) {
  return (
    <div data-testid="company-exhaust-gate">
      <SignupGate reason="company" returnTo={`/co/${slug}`} originSurface="company_page" className="p-6">
        <ul className="mt-4 divide-y divide-border border-y border-border">
          {teasers.map((t) => (
            <li key={t.title} className="flex items-baseline justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{t.title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{t.description}</p>
              </div>
              {t.count && <span className="mono-data whitespace-nowrap text-xs text-muted-foreground">{t.count}</span>}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted-foreground">
          Following {displayName} also shows its hiring history: changes, funding, tech stack and news.
        </p>
      </SignupGate>
    </div>
  );
}

/**
 * Server-side gate for the "behind the gate" bands (listing integrity,
 * change history, hiring stack, filings) — signed-in only, no follow
 * requirement. This is a DIFFERENT gate from the client-side
 * `CompanyIntelGate` (follow + email-verified, blurred children): the
 * contract for these specific bands is a plain sign-in check with a real-
 * count teaser card, never blur. `signedIn` is the route's one
 * `getServerUser()` read (lib/auth/server-user.ts), the same answer that
 * picks the page's other gate card, so the two can never disagree; it also
 * lets /mock/company-page show the signed-in bands.
 */
export function CompanyExhaustGate({
  slug,
  displayName,
  teasers,
  signedIn,
  children,
}: {
  slug: string;
  displayName: string;
  teasers: ExhaustGateTeaser[];
  signedIn: boolean;
  children: ReactNode;
}) {
  if (signedIn) return <>{children}</>;

  // A gate with nothing to tease is a gate with nothing to say — the design
  // rule that governs every other band here (no data, no band) applies to
  // the gate card too.
  if (teasers.length === 0) return null;

  return <ExhaustGateSignInCard slug={slug} displayName={displayName} teasers={teasers} />;
}
