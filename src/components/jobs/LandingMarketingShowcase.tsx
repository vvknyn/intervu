"use client";

import React from "react";
import {
  ArrowRight,
  ArrowUpRight,
} from "@phosphor-icons/react";

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

export function LandingMarketingShowcase({
  onSelectQuery,
  onSelectRemote,
  onSelectSalaryMin,
  onSelectBoard,
}: LandingMarketingShowcaseProps) {
  return (
    <div className="w-full space-y-8 pt-3 pb-2">

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
    </div>
  );
}
