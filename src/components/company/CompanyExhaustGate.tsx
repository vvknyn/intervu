import type { ReactNode } from "react";
import { LockSimple } from "@phosphor-icons/react/dist/ssr";
import { getServerUser } from "@/lib/auth/server-user";

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
 * Server-side gate for the "behind the gate" bands (listing integrity,
 * change history, hiring stack, filings) — signed-in only, no follow
 * requirement. This is a DIFFERENT gate from the client-side
 * `CompanyIntelGate` (follow + email-verified, blurred children): the
 * contract for these specific bands is a plain sign-in check with a real-
 * count teaser card, never blur. `getServerUser()` (lib/auth/server-user.ts)
 * is the repo's one place that answers "who is signed in" — reused here
 * rather than re-deriving a second session check.
 */
export async function CompanyExhaustGate({
  slug,
  displayName,
  teasers,
  children,
}: {
  slug: string;
  displayName: string;
  teasers: ExhaustGateTeaser[];
  children: ReactNode;
}) {
  const user = await getServerUser();
  if (user) return <>{children}</>;

  // A gate with nothing to tease is a gate with nothing to say — the design
  // rule that governs every other band here (no data, no band) applies to
  // the gate card too.
  if (teasers.length === 0) return null;

  const nextHref = `/login?next=${encodeURIComponent(`/co/${slug}`)}`;

  return (
    <section
      data-testid="company-exhaust-gate"
      className="border border-border-strong bg-card px-6 py-7 sm:px-8"
    >
      <h2 className="text-xs font-semibold text-muted-foreground">
        The full record
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-foreground">
        Sign in to open {displayName}&apos;s full hiring record — free.
      </p>
      <div className="mt-4 divide-y divide-border">
        {teasers.map((t) => (
          <div key={t.title} className="flex items-baseline justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{t.title}</p>
              <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{t.description}</p>
            </div>
            {t.count && (
              <span className="mono-data whitespace-nowrap text-xs text-muted-foreground">{t.count}</span>
            )}
          </div>
        ))}
      </div>
      <a
        href={nextHref}
        className="mt-5 inline-flex items-center gap-2 border border-border-strong bg-foreground px-4 py-2 text-xs font-semibold text-background"
      >
        Sign in to open the record
      </a>
      <div className="mt-4 flex items-center gap-2 border border-dashed border-border px-3 py-2">
        <LockSimple className="h-3.5 w-3.5 shrink-0 text-muted-foreground" weight="bold" aria-hidden />
        <span className="text-xs text-muted-foreground">Signed-in members only</span>
      </div>
    </section>
  );
}
