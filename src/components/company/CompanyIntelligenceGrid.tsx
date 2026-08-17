import React from "react";
import type { CompanyIntelligence } from "@/lib/companies/types";
import {
  CurrencyDollar,
  GlobeHemisphereWest,
  Code,
  Sparkle,
  Buildings,
  CheckCircle,
  Newspaper,
  ArrowUpRight,
  ShieldCheck,
  ShieldWarning,
} from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";

interface CompanyIntelligenceGridProps {
  intelligence?: CompanyIntelligence | null;
  companyName: string;
  className?: string;
}

export function CompanyIntelligenceGrid({
  intelligence,
  companyName,
  className,
}: CompanyIntelligenceGridProps) {
  if (!intelligence) return null;
  const { funding, visa, techStack, workModes, layoffs, signals, news } = intelligence;

  // If no intelligence data is available at all, return null gracefully
  const hasAnyData = Boolean(
    funding || visa || techStack || workModes || layoffs || signals.length > 0 || (news && news.length > 0),
  );
  if (!hasAnyData) return null;

  return (
    <section aria-label="Company Intelligence Suite" className={cn("mb-10 space-y-5", className)}>
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2.5 font-display text-[20px] sm:text-[22px] font-semibold text-foreground">
          <Sparkle className="h-5 w-5 text-brand" weight="fill" />
          Company Intelligence & Insights
        </h2>
        <span className="font-mono text-[11.5px] uppercase tracking-wider text-muted-foreground">
          Verified Signals
        </span>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {/* CARD 1: Capital & Financial Strength */}
        <div className="flex flex-col justify-between rounded-2xl border border-border bg-card p-6 sm:p-7 shadow-xs transition-colors hover:border-border-strong">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <CurrencyDollar className="h-4 w-4 text-emerald-500" weight="bold" />
                Capital & Stage
              </span>
              {funding?.stage && (
                <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[10.5px] font-medium text-emerald-600 dark:text-emerald-400">
                  {funding.stage}
                </span>
              )}
            </div>

            <div className="mt-4">
              {funding?.totalRaisedText ? (
                <div className="font-display text-[24px] sm:text-[26px] font-bold tracking-tight text-foreground">
                  {funding.totalRaisedText}
                </div>
              ) : (
                <div className="font-display text-[20px] font-semibold text-foreground">
                  {funding?.stage || "Verified Employer"}
                </div>
              )}

            {funding?.valuationText && (
                <div className="mt-1.5 font-mono text-[13px] font-medium text-muted-foreground">
                  {funding.valuationText}
                </div>
              )}

              {layoffs && (
                <div className="mt-3.5 flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[11.5px] text-emerald-600 dark:text-emerald-400">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500" weight="fill" />
                  <span className="font-mono font-medium">
                    {layoffs.warnNoticeCount === 0
                      ? "Zero WARN Notices Filed · Low Layoff Risk"
                      : `${layoffs.warnNoticeCount} Layoff Filings Recorded`}
                  </span>
                </div>
              )}
            </div>

            {funding?.investors && funding.investors.length > 0 && (
              <div className="mt-5 border-t border-border pt-4">
                <div className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
                  Notable Backers
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {funding.investors.map((inv) => (
                    <span
                      key={inv}
                      className="inline-flex items-center rounded-md border border-border bg-chip px-2.5 py-1 font-mono text-[11.5px] text-foreground"
                    >
                      {inv}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="mt-5 pt-2 text-[11.5px] text-muted-foreground">
            {layoffs?.summary || (funding?.investors?.length
              ? "Verified venture & institutional backing"
              : "Financial health screened via career activity")}
          </div>
        </div>

        {/* CARD 2: Visa & H-1B Sponsorship Transparency */}
        <div className="flex flex-col justify-between rounded-2xl border border-border bg-card p-6 sm:p-7 shadow-xs transition-colors hover:border-border-strong">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <GlobeHemisphereWest className="h-4 w-4 text-brand" weight="bold" />
                Visa & Immigration
              </span>
              {visa?.permSponsored && (
                <span className="rounded-full border border-brand/20 bg-brand/10 px-2.5 py-0.5 font-mono text-[10.5px] font-medium text-brand">
                  PERM Sponsor
                </span>
              )}
            </div>

            <div className="mt-4">
              {visa?.h1bFilingsCount ? (
                <div>
                  <div className="font-display text-[24px] sm:text-[26px] font-bold tracking-tight text-foreground">
                    {visa.h1bFilingsCount} LCAs Filed
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[13px] text-muted-foreground">
                    <CheckCircle className="h-4 w-4 text-brand" weight="fill" />
                    <span>{visa.approvalRatePct}% US DOL Certified</span>
                  </div>
                </div>
              ) : visa?.sponsoredRolesRatioPct ? (
                <div>
                  <div className="font-display text-[24px] sm:text-[26px] font-bold tracking-tight text-foreground">
                    {visa.sponsoredRolesRatioPct}% Roles Sponsored
                  </div>
                  <div className="mt-1.5 font-mono text-[13px] text-muted-foreground">
                    Active visa sponsorship on career page
                  </div>
                </div>
              ) : (
                <div>
                  <div className="font-display text-[20px] font-semibold text-foreground">
                    Sponsorship Policy
                  </div>
                  <div className="mt-1.5 font-mono text-[13px] text-muted-foreground">
                    Check individual role badges below
                  </div>
                </div>
              )}
            </div>

            {visa?.topSponsoredRoles && visa.topSponsoredRoles.length > 0 && (
              <div className="mt-5 border-t border-border pt-4">
                <div className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
                  Top Certified Salaries (US DOL)
                </div>
                <div className="mt-2.5 space-y-2">
                  {visa.topSponsoredRoles.slice(0, 3).map((role) => (
                    <div key={role.title} className="flex items-center justify-between text-[12.5px]">
                      <span className="truncate text-muted-foreground pr-2">{role.title}</span>
                      <span className="shrink-0 font-mono font-medium text-foreground">
                        {role.salaryRange.split("–")[0].trim()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="mt-5 pt-2 text-[11.5px] text-muted-foreground">
            Official US Department of Labor & ATS records
          </div>
        </div>

        {/* CARD 3: Tech DNA & Workplace Policy */}
        <div className="flex flex-col justify-between rounded-2xl border border-border bg-card p-6 sm:p-7 shadow-xs transition-colors hover:border-border-strong">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Code className="h-4 w-4 text-sky-500" weight="bold" />
                Tech DNA & Remote %
              </span>
              {workModes?.remotePct != null && (
                <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-0.5 font-mono text-[10.5px] font-medium text-sky-600 dark:text-sky-400">
                  {workModes.remotePct}% Remote
                </span>
              )}
            </div>

            {/* Work Mode Bar */}
            {workModes && (
              <div className="mt-4">
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
                  {workModes.remotePct > 0 && (
                    <div
                      style={{ width: `${workModes.remotePct}%` }}
                      className="bg-sky-500"
                      title={`${workModes.remotePct}% Remote`}
                    />
                  )}
                  {workModes.hybridPct > 0 && (
                    <div
                      style={{ width: `${workModes.hybridPct}%` }}
                      className="bg-amber-500"
                      title={`${workModes.hybridPct}% Hybrid`}
                    />
                  )}
                  {workModes.onsitePct > 0 && (
                    <div
                      style={{ width: `${workModes.onsitePct}%` }}
                      className="bg-muted-foreground/40"
                      title={`${workModes.onsitePct}% On-site`}
                    />
                  )}
                </div>
                <div className="mt-2 flex justify-between font-mono text-[11px] text-muted-foreground">
                  <span>{workModes.remotePct}% Remote</span>
                  <span>{workModes.hybridPct}% Hybrid</span>
                  <span>{workModes.onsitePct}% On-site</span>
                </div>
              </div>
            )}

            {/* Tech Stack Chips */}
            {techStack && (techStack.languages.length > 0 || techStack.infrastructure.length > 0) && (
              <div className="mt-5 border-t border-border pt-4">
                <div className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
                  Detected Technology Stack
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {techStack.languages.slice(0, 5).map((lang) => (
                    <span
                      key={lang}
                      className="inline-flex items-center rounded-md border border-border bg-chip px-2.5 py-1 font-mono text-[11.5px] font-medium text-foreground"
                    >
                      {lang}
                    </span>
                  ))}
                  {techStack.infrastructure.slice(0, 3).map((infra) => (
                    <span
                      key={infra}
                      className="inline-flex items-center rounded-md border border-border bg-chip px-2.5 py-1 font-mono text-[11.5px] text-muted-foreground"
                    >
                      {infra}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="mt-5 pt-2 text-[11.5px] text-muted-foreground">
            Extracted from active engineering openings
          </div>
        </div>
      </div>

      {/* SIGNALS & VERIFIED MILESTONES FEED */}
      {signals.length > 0 && (
        <div className="mt-6 rounded-2xl border border-border bg-card p-6 sm:p-7 shadow-xs">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Buildings className="h-4 w-4 text-brand" weight="bold" />
              Verified Signals & Milestones
            </h3>
            <span className="font-mono text-[11px] text-brand">Live Feed</span>
          </div>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {signals.map((sig) => (
              <div
                key={sig.id}
                className="flex items-start gap-3 rounded-xl border border-border/70 bg-background/50 p-4"
              >
                <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand animate-pulse" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-foreground">
                      {sig.title}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {sig.timeAgo}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                    {sig.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* COMPANY NEWS & VERIFIED COVERAGE FEED */}
      {news && news.length > 0 && (
        <div className="mt-6 rounded-2xl border border-border bg-card p-6 sm:p-7 shadow-xs">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Newspaper className="h-4 w-4 text-brand" weight="bold" />
              Company News & Press Coverage
            </h3>
            <span className="font-mono text-[11px] text-muted-foreground">Verified Sources</span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {news.map((item) => (
              <div
                key={item.id}
                className="flex flex-col justify-between rounded-xl border border-border/70 bg-background/50 p-4 transition-colors hover:border-border-strong"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-md border border-brand/20 bg-brand/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-brand">
                      {item.source}
                    </span>
                    <span className="font-mono text-[10.5px] text-muted-foreground">
                      {item.publishedAt}
                    </span>
                  </div>
                  <h4 className="mt-2.5 text-[13.5px] font-semibold leading-snug text-foreground">
                    {item.headline}
                  </h4>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                    {item.summary}
                  </p>
                </div>
                <div className="mt-3 flex items-center gap-1 font-mono text-[11px] font-medium text-brand">
                  <span>Verified Coverage</span>
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
