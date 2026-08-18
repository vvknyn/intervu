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
            [ DIRECT ATS INGESTION ENGINE ]
          </span>
          <h1 className="mt-1 text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight text-foreground">
            The Unfiltered Corpus.
          </h1>
        </div>
        <div className="text-xs text-muted-foreground sm:text-right uppercase tracking-wider space-y-0.5">
          <p className="font-bold text-foreground">EDITION 2026.08</p>
          <p>100% Direct from Employer ATS</p>
        </div>
      </div>

      {/* 3-Column Swiss Editorial Statement */}
      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-3 text-xs leading-relaxed">
        <div className="space-y-1.5 sm:border-r sm:border-border/80 sm:pr-6">
          <div className="font-bold text-foreground uppercase tracking-wider">
            01 / DIRECT SCRAPING
          </div>
          <p className="text-muted-foreground">
            Continuous live crawlers indexing directly from Greenhouse, Lever, Ashby, and Workday. Bypassing recruiter spam and middleman job boards.
          </p>
        </div>

        <div className="space-y-1.5 sm:border-r sm:border-border/80 sm:pr-6">
          <div className="font-bold text-foreground uppercase tracking-wider">
            02 / GHOST DETECTION
          </div>
          <p className="text-muted-foreground">
            Automated heuristics evaluate posting age, relist cycles, and ATS heartbeat signals to flag phantom or stale roles before you apply.
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="font-bold text-foreground uppercase tracking-wider">
            03 / RAW COMPENSATION
          </div>
          <p className="text-muted-foreground">
            Direct extraction of official compensation bands from ATS structured metadata. No guessing or crowd-sourced estimates.
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

export function LandingMarketingShowcase({
  onSelectQuery,
  onSelectRemote,
  onSelectSalaryMin,
  onSelectBoard,
}: LandingMarketingShowcaseProps) {
  const indexCategories = [
    {
      num: "001",
      domain: "ENGINEERING",
      title: "Distributed Systems & Cloud",
      desc: "Full Stack, Backend Platforms, Go, Rust, Distributed Infrastructure",
      q: "Software Engineer",
      metric: "HIGH VELOCITY",
    },
    {
      num: "002",
      domain: "AI & ML",
      title: "Foundation Models & Inference",
      desc: "LLM Infrastructure, Applied ML, PyTorch, Model Optimization",
      q: "Machine Learning AI",
      metric: "TOP DEMAND",
    },
    {
      num: "003",
      domain: "PRODUCT",
      title: "Technical Product & Strategy",
      desc: "Technical PMs, Systems Architecture, Engineering Leadership",
      q: "Product Manager",
      metric: "TIER-1 OPENINGS",
    },
    {
      num: "004",
      domain: "DESIGN",
      title: "Design Systems & UI Engineering",
      desc: "Product Design, Interface Architecture, Design Systems",
      q: "Product Designer UI UX",
      metric: "VERIFIED SALARY",
    },
    {
      num: "005",
      domain: "JURISDICTION",
      title: "Canada Remote Corridor",
      desc: "Verified remote roles with compliant Canadian employment & payroll",
      q: "Canada",
      isRemote: true,
      metric: "DIRECT ATS",
    },
    {
      num: "006",
      domain: "COMPANIES",
      title: "Tier-1 Venture & Core Tech",
      desc: "Anthropic, Stripe, OpenAI, Google, Linear, Figma, Vercel",
      isElite: true,
      metric: "NO RECRUITERS",
    },
  ];

  return (
    <div className="w-full space-y-8 py-2">

      {/* Swiss Index Ledger Directory */}
      <div>
        <div className="flex items-center justify-between border-b border-foreground pb-2 text-xs font-bold uppercase tracking-widest text-foreground">
          <span>[ MARKET SECTOR DIRECTORY ]</span>
          <span className="text-muted-foreground hidden sm:inline">SELECT DOMAIN TO QUERY</span>
        </div>

        <div className="divide-y divide-border border-b border-border">
          {indexCategories.map((cat) => (
            <button
              key={cat.num}
              type="button"
              onClick={() => {
                if (cat.isElite) {
                  onSelectBoard("elite");
                } else if (cat.isRemote) {
                  onSelectQuery(cat.q || "");
                  onSelectRemote();
                } else if (cat.q) {
                  onSelectQuery(cat.q);
                }
              }}
              className="group flex w-full flex-col gap-3 py-4 text-left transition-all duration-100 hover:bg-foreground hover:text-background sm:flex-row sm:items-center sm:justify-between px-3"
            >
              <div className="flex items-start sm:items-center gap-4 min-w-0">
                <span className="text-sm font-bold text-muted-foreground group-hover:text-background/70 shrink-0">
                  {cat.num}
                </span>
                <div>
                  <div className="flex items-center gap-2">
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
                <span className="rounded-none border border-border group-hover:border-background/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground group-hover:text-background">
                  {cat.metric}
                </span>
                <ArrowRight className="h-4 w-4 text-foreground group-hover:text-background transition-transform group-hover:translate-x-1" />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Direct Filter Shortcuts */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 text-xs">
        <button
          type="button"
          onClick={() => onSelectBoard("elite")}
          className="flex items-center justify-between border border-border p-4 text-left transition-colors hover:border-foreground hover:bg-muted/30"
        >
          <div>
            <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">FILTER_01</div>
            <div className="mt-1 font-bold text-foreground">TIER-1 TECH & STARTUPS</div>
          </div>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
        </button>

        <button
          type="button"
          onClick={onSelectRemote}
          className="flex items-center justify-between border border-border p-4 text-left transition-colors hover:border-foreground hover:bg-muted/30"
        >
          <div>
            <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">FILTER_02</div>
            <div className="mt-1 font-bold text-foreground">100% VERIFIED REMOTE</div>
          </div>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
        </button>

        <button
          type="button"
          onClick={() => onSelectSalaryMin(150000)}
          className="flex items-center justify-between border border-border p-4 text-left transition-colors hover:border-foreground hover:bg-muted/30"
        >
          <div>
            <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">FILTER_03</div>
            <div className="mt-1 font-bold text-foreground">$150K+ TRANSPARENT SALARY</div>
          </div>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}
