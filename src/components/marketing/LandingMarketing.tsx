"use client";

import Link from "next/link";
import { OpenclawWaitlistForm } from "./OpenclawWaitlistForm";
import {
  WHILE_YOU_SLEPT_STEPS,
  WHAT_IT_WONT_DO_ITEMS,
  RUNS_ON_YOUR_MACHINE,
  SETUP_STEPS,
} from "./openclaw-content";

/**
 * Self-contained marketing sections mounted below the landing search box
 * (see docs handoff — mounted by a parallel agent's page.tsx edit, not this
 * file). Zero props. Condensed OpenClaw pitch: while-you-slept, what-it-
 * won't-do, runs-on-your-machine, and setup, each reading a shorter slice of
 * the same `openclaw-content.ts` arrays the full story at /openclaw reads in
 * full — never a hand-copied duplicate of that copy. Closes with the shared
 * waitlist form and a link to the full story.
 */
export function LandingMarketing() {
  return (
    <div data-testid="landing-marketing" className="openclaw bg-background">
      <section aria-labelledby="landing-slept-heading" className="py-16">
        <div className="mx-auto w-full max-w-[1280px] px-4 lg:px-8">
          <h2
            id="landing-slept-heading"
            className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgb(var(--oc-coral))]"
          >
            While you slept
          </h2>
          <ol className="mt-6 flex flex-wrap gap-x-8 gap-y-2">
            {WHILE_YOU_SLEPT_STEPS.map((step, i) => (
              <li key={step.title} className="flex items-center gap-2 text-sm text-foreground">
                <span className="font-mono text-[11px] text-muted-foreground">{i + 1}</span>
                {step.title}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="landing-wont-heading" className="border-t border-border py-14">
        <div className="mx-auto w-full max-w-[1280px] px-4 lg:px-8">
          <h2
            id="landing-wont-heading"
            className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgb(var(--oc-coral))]"
          >
            What it won&apos;t do
          </h2>
          <ul className="mt-6 flex flex-wrap gap-x-8 gap-y-2">
            {WHAT_IT_WONT_DO_ITEMS.map((item) => (
              <li key={item.title} className="text-sm text-foreground">
                {item.title}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-label="Runs on your machine" className="border-t border-border py-14">
        <div className="mx-auto w-full max-w-[1280px] px-4 lg:px-8">
          <p className="max-w-xl text-sm text-muted-foreground">{RUNS_ON_YOUR_MACHINE.short}</p>
        </div>
      </section>

      <section aria-labelledby="landing-setup-heading" className="border-t border-border py-14">
        <div className="mx-auto w-full max-w-[1280px] px-4 lg:px-8">
          <h2
            id="landing-setup-heading"
            className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgb(var(--oc-coral))]"
          >
            Setup in 3 steps
          </h2>
          <ol className="mt-6 flex flex-wrap gap-x-8 gap-y-2">
            {SETUP_STEPS.map((step, i) => (
              <li key={step.title} className="flex items-center gap-2 text-sm text-foreground">
                <span className="font-mono text-[11px] text-muted-foreground">{i + 1}</span>
                {step.title}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-label="Join the OpenClaw waitlist" className="border-t border-border py-14">
        <div className="mx-auto flex w-full max-w-[1280px] flex-col items-center px-4 text-center lg:px-8">
          <OpenclawWaitlistForm className="w-full max-w-sm" />
          <p className="mt-4 text-sm text-muted-foreground">
            <Link href="/openclaw" className="font-medium text-foreground underline underline-offset-2 hover:text-brand">
              See how it works
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
