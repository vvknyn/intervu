"use client";

import React from "react";
import { chipVariants } from "@/components/ui/chip";
import { cn } from "@/lib/utils";

interface LandingMarketingShowcaseProps {
  onSelectQuery: (q: string) => void;
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
}: LandingMarketingShowcaseProps) {
  return (
    <div className="w-full space-y-4 pt-2 pb-1">

      <div>
        {/* Mobile (A1): no heading, chips scroll horizontally in one row.
            Desktop (lg+): unchanged heading + wrapping grid. */}
        <div className="hidden items-center justify-between border-b border-foreground pb-1.5 text-sm font-semibold text-foreground lg:flex">
          <span>Browse by field</span>
          <span className="text-xs font-normal text-muted-foreground">Pick one to start searching</span>
        </div>

        <div className="flex flex-nowrap gap-2 overflow-x-auto overscroll-x-contain lg:mt-2 lg:flex-wrap lg:overflow-visible">
          {indexCategories.map((cat) => (
            <button
              key={cat.q}
              type="button"
              onClick={() => onSelectQuery(cat.q)}
              className={cn(chipVariants({ active: false, interactive: true }), "h-auto min-h-7 shrink-0 px-2.5 py-1 text-foreground")}
            >
              {cat.title}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
