"use client";

import React from "react";
import {
  ArrowRight,
  ArrowUpRight,
} from "@phosphor-icons/react";
interface LandingMastheadProps {
  /**
   * The honest-market claim sentence (`marketingClaim()` in
   * lib/marketing-stats.ts — the sole owner of its wording). `null` while
   * the stats fetch is in flight or has failed; render nothing in that case
   * rather than a placeholder, per that function's own degrade contract.
   */
  claim?: string | null;
}

/**
 * The marketing statement alone — no controls, nothing focusable.
 *
 * Split out of the showcase below (2026-08-17, Vivek) because the two halves
 * now live on opposite sides of the search line: this states what the corpus
 * IS and sits ABOVE the search box on the pristine landing, while the
 * directory and shortcuts below are search entry points and stay next to the
 * results they seed. Reduced to eyebrow + h1 + one-line claim (2026-08-18):
 * the two-line "Updated every day / No recruiters, no reposts" rail is gone,
 * and the 3-column USP grid moved into `LandingMarketingShowcase` below the
 * directory and shortcuts — action before explanation. Eyebrow dropped
 * entirely (2026-08-21, item 1): it restated the H1's own claim in shoutier
 * type one line above it — one trust statement, not two copies of it.
 *
 * Deliberately free of buttons and links. `/jobs` keeps it MOUNTED and
 * collapses it once a search runs (see the `grid-rows-[0fr]` wrapper in
 * app/jobs/page.tsx) rather than unmounting it, and a collapsed block that
 * contained a tab stop would leave focus stranded in zero-height content.
 * Keep it non-interactive, or that wrapper needs `inert` instead.
 */
export function LandingMasthead({ claim }: LandingMastheadProps) {
  return (
    <div className="pb-4 sm:pb-6">
    <div className="border-b border-border py-5 sm:py-7">
      <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-foreground">
        Every job, straight from the employer.
      </h1>
      {claim ? (
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          {claim}
        </p>
      ) : null}
    </div>
    </div>
  );
}

interface LandingMarketingShowcaseProps {
  onSelectQuery: (q: string) => void;
  onSelectRemote: () => void;
  onSelectSalaryMin: (min: number) => void;
  onSelectBoard: (board: "elite") => void;
  /** When false, skips the field directory — desktop pristine renders USP via `LandingUspSection` instead. */
  showDirectory?: boolean;
}

/**
 * Single source of truth for the field directory below. Purely FIELD (what
 * work you do) — "how you want to work" (remote, pay, company tier) lives in
 * the three shortcut buttons instead, so the two don't get remixed into one
 * arbitrary pile again. Exported so the guard test in
 * tests/unit/landing-plain-copy.test.ts can assert against the real data
 * rather than a second copy of it.
 */
export const indexCategories = [
  {
    title: "Software and tech",
    desc: "Engineering, data, product, and design roles",
    q: "Software Engineer",
  },
  {
    title: "Nursing and patient care",
    desc: "Registered nurses, aides, technicians, and clinic staff",
    q: "Registered Nurse",
  },
  {
    title: "Driving and delivery",
    desc: "Truck, delivery, and transit roles, local and long haul",
    q: "Truck Driver",
  },
  {
    title: "Skilled trades",
    desc: "Electricians, plumbers, welders, machinists, and technicians",
    q: "Electrician",
  },
  {
    title: "Retail and customer service",
    desc: "Store, call centre, and front-of-house roles",
    q: "Customer Service",
  },
  {
    title: "Office and admin",
    desc: "Administrative, scheduling, reception, and support roles",
    q: "Administrative Assistant",
  },
];

/** The 3-column "Why these listings are different" block — shared by mobile
 *  showcase (below directory) and desktop pristine (compact, no directory). */
export function LandingUspSection() {
  return (
    <div>
      <div className="border-b border-foreground pb-2 text-sm font-semibold text-foreground">
        <span>Why these listings are different</span>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-3 text-xs leading-relaxed">
        <div className="space-y-1.5 sm:border-r sm:border-border/80 sm:pr-6">
          <div className="font-bold text-foreground">
            Straight from the company
          </div>
          <p className="text-muted-foreground">
            We read openings from each company&apos;s own careers page and hiring system. Nothing here comes from a recruiter, an agency, or a job board reselling someone else&apos;s listing.
          </p>
        </div>

        <div className="space-y-1.5 sm:border-r sm:border-border/80 sm:pr-6">
          <div className="font-bold text-foreground">
            Checked before you apply
          </div>
          <p className="text-muted-foreground">
            We look at how old a posting is, how often it has been relisted, and whether the company&apos;s system still shows it open — so you can tell an active job from one that has probably already gone.
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="font-bold text-foreground">
            Real pay, not estimates
          </div>
          <p className="text-muted-foreground">
            When a company publishes a salary range, that range is what you see. We never guess a number or borrow a crowd-sourced one.
          </p>
        </div>
      </div>
    </div>
  );
}

export function LandingMarketingShowcase({
  onSelectQuery,
  onSelectRemote,
  onSelectSalaryMin,
  onSelectBoard,
  showDirectory = true,
}: LandingMarketingShowcaseProps) {
  return (
    <div className="w-full space-y-8 pt-8 pb-2 sm:pt-10">

      {showDirectory ? (
      <div>
        <div className="flex items-center justify-between border-b border-foreground pb-2 text-sm font-semibold text-foreground">
          <span>Browse by field</span>
          <span className="text-xs font-normal text-muted-foreground">Pick one to start searching</span>
        </div>

        <div className="divide-y divide-border border-b border-border">
          {indexCategories.map((cat) => (
            <button
              key={cat.q}
              type="button"
              onClick={() => onSelectQuery(cat.q)}
              className="group flex w-full items-center justify-between gap-3 px-3 py-4 text-left transition-all duration-100 hover:bg-foreground hover:text-background"
            >
              {/* `min-w-0` is load-bearing: `truncate` on the description needs
                  an ancestor allowed to shrink below content width. */}
              <div className="min-w-0 flex-1">
                <h3 className="font-bold text-sm tracking-tight text-foreground group-hover:text-background">
                  {cat.title}
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground group-hover:text-background/80 truncate max-w-xl">
                  {cat.desc}
                </p>
              </div>

              <ArrowRight className="h-4 w-4 shrink-0 text-foreground transition-transform group-hover:translate-x-1 group-hover:text-background" />
            </button>
          ))}
        </div>
      </div>
      ) : null}

      {/* Direct Filter Shortcuts */}
      <div>
        <div className="border-b border-foreground pb-2 text-sm font-semibold text-foreground">
          <span>Or start with a filter</span>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3 text-xs">
          <button
            type="button"
            onClick={() => onSelectBoard("elite")}
            className="flex items-center justify-between border border-border p-4 text-left transition-colors hover:border-foreground hover:bg-muted/30"
          >
            <div>
              <div className="text-xs text-muted-foreground">Companies</div>
              <div className="mt-1 font-bold text-foreground">Top companies</div>
            </div>
            <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
          </button>

          <button
            type="button"
            onClick={onSelectRemote}
            className="flex items-center justify-between border border-border p-4 text-left transition-colors hover:border-foreground hover:bg-muted/30"
          >
            <div>
              <div className="text-xs text-muted-foreground">Location</div>
              <div className="mt-1 font-bold text-foreground">Remote jobs only</div>
            </div>
            <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
          </button>

          <button
            type="button"
            onClick={() => onSelectSalaryMin(150000)}
            className="flex items-center justify-between border border-border p-4 text-left transition-colors hover:border-foreground hover:bg-muted/30"
          >
            <div>
              <div className="text-xs text-muted-foreground">Pay</div>
              <div className="mt-1 font-bold text-foreground">Pays $150k or more</div>
            </div>
            <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      <LandingUspSection />
    </div>
  );
}
