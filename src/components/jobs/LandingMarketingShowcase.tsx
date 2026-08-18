"use client";

import React from "react";
import {
  ArrowRight,
  ArrowUpRight,
  ShieldCheck,
  GlobeHemisphereWest,
  CurrencyDollar,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/**
 * The marketing statement alone — no controls, nothing focusable.
 *
 * Split out of the showcase below (2026-08-17, Vivek) because the two halves
 * now live on opposite sides of the search line: this states what the corpus
 * IS and sits ABOVE the search box on the pristine landing, while the
 * directory and shortcuts below are search entry points and stay next to the
 * results they seed.
 *
 * Deliberately free of buttons and links. `/jobs` keeps it MOUNTED and
 * collapses it once a search runs (see the `grid-rows-[0fr]` wrapper in
 * app/jobs/page.tsx) rather than unmounting it, and a collapsed block that
 * contained a tab stop would leave focus stranded in zero-height content.
 * Keep it non-interactive, or that wrapper needs `inert` instead.
 */
export function LandingMasthead() {
  return (
    <div className="pb-4 sm:pb-6">
    <div className="border-t-2 border-b-2 border-foreground py-6 sm:py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-border/80 pb-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-brand">
            Jobs posted by the companies themselves
          </span>
          <h1 className="mt-1 text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight text-foreground">
            Every job, straight from the employer.
          </h1>
        </div>
        <div className="text-xs text-muted-foreground sm:text-right uppercase tracking-wider space-y-0.5">
          <p className="font-bold text-foreground">Updated every day</p>
          <p>No recruiters, no reposts</p>
        </div>
      </div>

      {/* 3-Column Swiss Editorial Statement */}
      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-3 text-xs leading-relaxed">
        <div className="space-y-1.5 sm:border-r sm:border-border/80 sm:pr-6">
          <div className="font-bold text-foreground uppercase tracking-wider">
            Straight from the company
          </div>
          <p className="text-muted-foreground">
            We read openings from each company&apos;s own careers page and hiring system. Nothing here comes from a recruiter, an agency, or a job board reselling someone else&apos;s listing.
          </p>
        </div>

        <div className="space-y-1.5 sm:border-r sm:border-border/80 sm:pr-6">
          <div className="font-bold text-foreground uppercase tracking-wider">
            Checked before you apply
          </div>
          <p className="text-muted-foreground">
            We look at how old a posting is, how often it has been relisted, and whether the company&apos;s system still shows it open — so you can tell an active job from one that has probably already gone.
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="font-bold text-foreground uppercase tracking-wider">
            Real pay, not estimates
          </div>
          <p className="text-muted-foreground">
            When a company publishes a salary range, that range is what you see. We never guess a number or borrow a crowd-sourced one.
          </p>
        </div>
      </div>
    </div>
    </div>
  );
}

interface LandingMarketingShowcaseProps {
  onSelectQuery: (q: string) => void;
  onSelectRemote: () => void;
  onSelectSalaryMin: (min: number) => void;
  onSelectBoard: (board: "elite") => void;
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
    num: "001",
    domain: "HEALTHCARE",
    title: "Nursing and patient care",
    desc: "Registered nurses, aides, technicians, and clinic staff",
    q: "Registered Nurse",
  },
  {
    num: "002",
    domain: "DRIVING",
    title: "Driving and delivery",
    desc: "Truck, delivery, and transit roles, local and long haul",
    q: "Truck Driver",
  },
  {
    num: "003",
    domain: "TRADES",
    title: "Skilled trades",
    desc: "Electricians, plumbers, welders, machinists, and technicians",
    q: "Electrician",
  },
  {
    num: "004",
    domain: "RETAIL",
    title: "Retail and customer service",
    desc: "Store, call centre, and front-of-house roles",
    q: "Customer Service",
  },
  {
    num: "005",
    domain: "OFFICE",
    title: "Office and admin",
    desc: "Administrative, scheduling, reception, and support roles",
    q: "Administrative Assistant",
  },
  {
    num: "006",
    domain: "TECHNOLOGY",
    title: "Software and tech",
    desc: "Engineering, data, product, and design roles",
    q: "Software Engineer",
  },
];

export function LandingMarketingShowcase({
  onSelectQuery,
  onSelectRemote,
  onSelectSalaryMin,
  onSelectBoard,
}: LandingMarketingShowcaseProps) {
  return (
    <div className="w-full space-y-8 py-2">

      {/* Swiss Index Ledger Directory */}
      <div>
        <div className="flex items-center justify-between border-b border-foreground pb-2 text-xs font-bold uppercase tracking-widest text-foreground">
          <span>Browse by field</span>
          <span className="text-muted-foreground">Pick one to start searching</span>
        </div>

        <div className="divide-y divide-border border-b border-border">
          {indexCategories.map((cat) => (
            <button
              key={cat.num}
              type="button"
              onClick={() => onSelectQuery(cat.q)}
              className="group flex w-full flex-col gap-3 py-4 text-left transition-all duration-100 hover:bg-foreground hover:text-background sm:flex-row sm:items-center sm:justify-between px-3"
            >
              <div className="flex items-start sm:items-center gap-4 min-w-0">
                <span className="text-sm font-bold text-muted-foreground group-hover:text-background/70 shrink-0">
                  {cat.num}
                </span>
                {/* `min-w-0` is load-bearing, not tidiness. A flex item's
                    default `min-width: auto` refuses to shrink below its
                    content, and the description below sets `truncate` — which
                    is `white-space: nowrap`, so its min-content width is the
                    WHOLE line. Without this the column demanded ~380px inside
                    a ~330px slot, the row pushed the document to 450px at a
                    390px viewport, and the entire page scrolled sideways:
                    row numbers and metric chips ran off the left edge while
                    descriptions ran off the right. `truncate` cannot truncate
                    anything until an ancestor is allowed to be narrower than
                    the text. */}
                <div className="min-w-0 flex-1">
                  {/* Wraps rather than truncates: the sector name is the
                      thing being chosen from, so it may take two lines on a
                      narrow screen. Only the description gets clipped. */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-brand group-hover:text-background">
                      [{cat.domain}]
                    </span>
                    <h3 className="font-bold text-sm tracking-tight text-foreground group-hover:text-background">
                      {cat.title}
                    </h3>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground group-hover:text-background/80 truncate max-w-xl">
                    {cat.desc}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4 shrink-0 text-xs">
                <ArrowRight className="h-4 w-4 text-foreground group-hover:text-background transition-transform group-hover:translate-x-1" />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Direct Filter Shortcuts */}
      <div>
        <div className="border-b border-foreground pb-2 text-xs font-bold uppercase tracking-widest text-foreground">
          <span>Or start with a filter</span>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3 text-xs">
          <button
            type="button"
            onClick={() => onSelectBoard("elite")}
            className="flex items-center justify-between border border-border p-4 text-left transition-colors hover:border-foreground hover:bg-muted/30"
          >
            <div>
              <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Companies</div>
              <div className="mt-1 font-bold text-foreground">Top tech companies</div>
            </div>
            <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
          </button>

          <button
            type="button"
            onClick={onSelectRemote}
            className="flex items-center justify-between border border-border p-4 text-left transition-colors hover:border-foreground hover:bg-muted/30"
          >
            <div>
              <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Location</div>
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
              <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Pay</div>
              <div className="mt-1 font-bold text-foreground">Pays $150k or more</div>
            </div>
            <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      </div>
    </div>
  );
}
