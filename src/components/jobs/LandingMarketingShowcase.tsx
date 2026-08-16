"use client";

import React from "react";
import {
  ShieldCheck,
  CurrencyDollar,
  GlobeHemisphereWest,
  Sparkle,
  Code,
  Brain,
  Kanban,
  PaintBrush,
  Buildings,
  MapPin,
  ArrowRight,
  CheckCircle,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

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
  const trendingCategories = [
    {
      title: "Remote Engineering",
      desc: "Software Engineer, Full Stack, Backend, Frontend",
      icon: Code,
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-50 dark:bg-blue-950/40",
      border: "border-blue-200/80 dark:border-blue-800/60",
      q: "Software Engineer",
    },
    {
      title: "AI & Machine Learning",
      desc: "AI Engineer, LLMs, ML Specialist, Data Science",
      icon: Brain,
      color: "text-purple-600 dark:text-purple-400",
      bg: "bg-purple-50 dark:bg-purple-950/40",
      border: "border-purple-200/80 dark:border-purple-800/60",
      q: "Machine Learning AI",
    },
    {
      title: "Product & Strategy",
      desc: "Product Manager, Technical Program Manager",
      icon: Kanban,
      color: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-50 dark:bg-amber-950/40",
      border: "border-amber-200/80 dark:border-amber-800/60",
      q: "Product Manager",
    },
    {
      title: "Design & UX",
      desc: "Product Designer, UI/UX Specialist, Design Systems",
      icon: PaintBrush,
      color: "text-pink-600 dark:text-pink-400",
      bg: "bg-pink-50 dark:bg-pink-950/40",
      border: "border-pink-200/80 dark:border-pink-800/60",
      q: "Product Designer UI UX",
    },
    {
      title: "Canada Remote Jobs",
      desc: "Top remote opportunities across Canada & Ontario",
      icon: MapPin,
      color: "text-red-600 dark:text-red-400",
      bg: "bg-red-50 dark:bg-red-950/40",
      border: "border-red-200/80 dark:border-red-800/60",
      q: "Canada",
      isRemote: true,
    },
    {
      title: "Tier-1 Tech & Startups",
      desc: "Anthropic, Stripe, OpenAI, Google, Linear, Figma",
      icon: Buildings,
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-50 dark:bg-emerald-950/40",
      border: "border-emerald-200/80 dark:border-emerald-800/60",
      isElite: true,
    },
  ];

  return (
    <div className="w-full py-2 sm:py-4 transition-all duration-300">
      {/* Hero Headline Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br from-slate-50 via-white to-emerald-50/30 p-6 sm:p-8 shadow-xs dark:border-slate-800 dark:from-slate-900 dark:via-slate-900/90 dark:to-emerald-950/20">
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-100/60 px-3 py-1 text-xs font-semibold text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-950/70 dark:text-emerald-300 mb-3.5">
            <Sparkle className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Direct ATS Ingestion · 100% Verified Career Pages</span>
          </div>

          <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight text-slate-900 dark:text-white leading-snug">
            Find Real Jobs at Companies That Are <span className="text-emerald-600 dark:text-emerald-400">Actually Hiring</span>
          </h2>

          <p className="mt-2.5 text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed">
            Screened directly from employer career portals (Greenhouse, Lever, Ashby, Workday).
            Zero recruiter spam, 100% verified salary ranges, and live ghost-job detection.
          </p>

          {/* Value Highlights */}
          <div className="mt-5 flex flex-wrap gap-4 text-xs font-medium text-slate-700 dark:text-slate-300">
            <div className="flex items-center gap-1.5">
              <CheckCircle weight="fill" className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span>Direct ATS Postings</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle weight="fill" className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span>Ghost-Job Screened</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle weight="fill" className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span>Salary Transparency</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle weight="fill" className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span>Free for Seekers</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3 Core Value Pillars */}
      <div className="mt-6 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        {/* Pillar 1: Ghost Radar */}
        <div
          onClick={() => onSelectBoard("elite")}
          className="group relative cursor-pointer rounded-xl border border-slate-200/80 bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow-md dark:border-slate-800 dark:hover:border-emerald-500"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100/70 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
                Ghost Job Radar
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Stale listings flagged before you apply
              </p>
            </div>
          </div>
        </div>

        {/* Pillar 2: Remote Work */}
        <div
          onClick={onSelectRemote}
          className="group relative cursor-pointer rounded-xl border border-slate-200/80 bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-blue-400 hover:shadow-md dark:border-slate-800 dark:hover:border-blue-500"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100/70 text-blue-700 dark:bg-blue-950/70 dark:text-blue-300">
              <GlobeHemisphereWest className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400">
                Verified Remote
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Work-from-home roles across CA & US
              </p>
            </div>
          </div>
        </div>

        {/* Pillar 3: Salary Transparency */}
        <div
          onClick={() => onSelectSalaryMin(150000)}
          className="group relative cursor-pointer rounded-xl border border-slate-200/80 bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-amber-400 hover:shadow-md dark:border-slate-800 dark:hover:border-amber-500"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100/70 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300">
              <CurrencyDollar className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white group-hover:text-amber-600 dark:group-hover:text-amber-400">
                $150k+ Verified Pay
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Explicit compensation bands
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Trending Categories Section */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-3.5">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 dark:text-white">
              Trending Categories
            </h3>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              Google Trends
            </span>
          </div>
          <span className="text-xs text-muted-foreground">Click to search</span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {trendingCategories.map((cat) => {
            const Icon = cat.icon;
            return (
              <button
                key={cat.title}
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
                className={cn(
                  "group flex flex-col text-left rounded-xl border p-4 transition-all hover:-translate-y-0.5 hover:shadow-md",
                  cat.border,
                  cat.bg
                )}
              >
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2.5">
                    <div className={cn("p-2 rounded-lg bg-white/80 dark:bg-slate-900/80 shadow-2xs", cat.color)}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="font-semibold text-sm text-slate-900 dark:text-white group-hover:underline underline-offset-2">
                      {cat.title}
                    </span>
                  </div>
                  <ArrowRight className="h-4 w-4 text-slate-400 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                </div>
                <p className="mt-2.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {cat.desc}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
