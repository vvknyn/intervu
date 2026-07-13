"use client";

import { ArrowRight, MagnifyingGlass, Play, Package } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import type { CachedPlanListItem, ResumableSessionItem } from "@/lib/prep/plan-list";
import { cn } from "@/lib/utils";

export interface PrepLandingProps {
  onStartNew: () => void;
  onSearch: () => void;
  onResume: (planCacheKey: string) => void;
  onOpenPackage: (item: CachedPlanListItem) => void;
  cachedPlans: CachedPlanListItem[];
  resumableSessions: ResumableSessionItem[];
}

export function PrepLanding({
  onStartNew,
  onSearch,
  onResume,
  onOpenPackage,
  cachedPlans,
  resumableSessions,
}: PrepLandingProps) {
  const latestSession = resumableSessions[0];

  return (
    <div className="w-full max-w-2xl animate-in fade-in duration-500">
      <div className="mb-10 text-center">
        <h1 className="text-[40px] sm:text-[56px] font-semibold tracking-tighter leading-none mb-3">
          Intervu
        </h1>
        <p className="text-muted-foreground text-base">
          Your job application workspace
        </p>
      </div>

      <div className="flex flex-col gap-3 mb-8">
        <Button
          variant="brand"
          size="lg"
          className="w-full h-12 text-base"
          onClick={onStartNew}
          data-testid="prep-start-new"
        >
          Start new preparation
          <ArrowRight size={18} weight="bold" className="ml-2" />
        </Button>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Button variant="outline" className="h-11" onClick={onSearch}>
            <MagnifyingGlass size={18} className="mr-2" />
            Search plans
          </Button>
          {latestSession ? (
            <Button
              variant="outline"
              className="h-11"
              onClick={() => onResume(latestSession.planCacheKey)}
            >
              <Play size={18} className="mr-2" />
              Resume recent session
            </Button>
          ) : (
            <Button variant="outline" className="h-11" disabled>
              <Play size={18} className="mr-2" />
              Resume recent session
            </Button>
          )}
        </div>
      </div>

      {cachedPlans.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground px-1">
            Existing prep packages
          </h3>
          <div className="space-y-2">
            {cachedPlans.map((plan) => (
              <button
                key={plan.cacheKey}
                onClick={() => onOpenPackage(plan)}
                className={cn(
                  "w-full text-left p-4 rounded-xl border border-border/40 bg-card",
                  "hover:shadow-md hover:border-border/60 transition-all duration-200",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-brand/10 flex items-center justify-center shrink-0">
                    <Package size={18} weight="duotone" className="text-brand" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">
                      {plan.company} · {plan.position}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {plan.round}
                    </p>
                  </div>
                  <ArrowRight
                    size={14}
                    className="text-muted-foreground/40 shrink-0"
                  />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
