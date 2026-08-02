"use client";

import Link from "next/link";
import { ProofBand } from "./ProofBand";

/**
 * Self-contained marketing sections mounted below the landing search box
 * (see docs handoff — mounted by a parallel agent's page.tsx edit, not this
 * file). Zero props: every live number sources itself via `ProofBand`; every
 * other band is static copy. Exactly 3 bands, in order: how MCP pairing
 * works, the verification story (`ProofBand`, degrades to nothing without
 * live stats), a one-line pricing teaser.
 */
export function LandingMarketing() {
  return (
    <div data-testid="landing-marketing">
      <section aria-label="How pairing works" className="py-16">
        <div className="mx-auto w-full max-w-[1280px] px-4 lg:px-8">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
            How pairing works
          </p>
          <div className="mt-8 flex max-w-2xl flex-col gap-8">
            <div>
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                Step 1 · Connect
              </span>
              <p className="mt-1.5 text-base text-foreground">
                Paste{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em]">
                  https://intervu.cc/api/mcp
                </code>{" "}
                into your AI&apos;s connector settings.
              </p>
            </div>
            <div>
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                Step 2 · Approve
              </span>
              <p className="mt-1.5 text-base text-foreground">
                One click. It can search for you and file to your tracker — it can never apply without you.
              </p>
            </div>
            <div>
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                Step 3 · Ask
              </span>
              <p className="mt-1.5 text-base italic text-foreground">
                &ldquo;What&apos;s the next job I should apply to?&rdquo;
              </p>
            </div>
          </div>
        </div>
      </section>

      <ProofBand />

      <section aria-label="Pricing" className="border-t border-border py-14">
        <div className="mx-auto flex w-full max-w-[1280px] flex-col items-center px-4 text-center lg:px-8">
          <p className="max-w-xl text-sm text-muted-foreground">
            No subscription. Intelligence is free — it&apos;s your AI. We charge only for corpus truth.{" "}
            <Link href="/pricing" className="font-medium text-foreground underline underline-offset-2 hover:text-brand">
              See pricing
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
