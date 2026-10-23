import type { Metadata } from "next";
import { ExhaustGateSignInCard, type ExhaustGateTeaser } from "@/components/company/CompanyExhaustGate";
import { CompanyIntelLockCard } from "@/components/company/CompanyIntelGate";
import { companyUnlockStep } from "@/lib/company/unlock-step";

export const metadata: Metadata = {
  title: "Company unlock-card mock",
};

/**
 * Preview harness for the /co/[slug] "one ask" fix — real card components
 * (`CompanyIntelLockCard`, `ExhaustGateSignInCard`), driven by
 * `companyUnlockStep` for a given `?state=`, standing in for real
 * signed-in/following session state that this repo has no way to fake
 * without a live account (see `unlock-step.ts`).
 */
const SCENARIOS: Record<string, { label: string; signedIn: boolean; following: boolean }> = {
  anonymous: { label: "Anonymous visitor", signedIn: false, following: false },
  "non-follower": { label: "Signed in, not following", signedIn: true, following: false },
  follower: { label: "Signed in and following", signedIn: true, following: true },
};

const FIXTURE_TEASERS: ExhaustGateTeaser[] = [
  {
    title: "Listing integrity",
    description: "How honest their postings are: reposts, resurrections, how roles actually close.",
    count: "12 closings on record",
  },
  {
    title: "Hiring infrastructure",
    description: "What their site runs on, and how it's built.",
    count: null,
  },
];

export default async function CompanyCardsMockPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;
  const scenario = SCENARIOS[state ?? "anonymous"] ?? SCENARIOS.anonymous;
  const step = companyUnlockStep(scenario);

  return (
    <div className="min-h-dvh bg-background px-4 py-8 sm:px-8">
      <p className="mb-6 text-xs font-semibold text-muted-foreground">
        {scenario.label} — companyUnlockStep = {step ?? "null (no card)"}
      </p>

      {/* Stands in for the main column's "company-secondary" block on
          /co/[slug]: hiring changes + intelligence grid, gated by
          CompanyIntelGate. */}
      <div className="space-y-8">
        <div className="rounded-panel border border-dashed border-border p-4 text-xs text-muted-foreground">
          Hiring changes + intelligence grid — real content once unlocked
        </div>
        {step === "follow" && (
          <CompanyIntelLockCard domain="acme.com" slug="acme" displayName="Acme" />
        )}
      </div>

      {/* Stands in for the page's exhaust-gated bands lower down (listing
          integrity, hiring infrastructure, filings), gated by
          CompanyExhaustGate. */}
      <div className="mt-10">
        {step === "sign-in" ? (
          <ExhaustGateSignInCard slug="acme" displayName="Acme" teasers={FIXTURE_TEASERS} />
        ) : (
          <div className="rounded-panel border border-dashed border-border p-4 text-xs text-muted-foreground">
            Listing integrity, hiring infrastructure, filings — real content once unlocked
          </div>
        )}
      </div>
    </div>
  );
}
