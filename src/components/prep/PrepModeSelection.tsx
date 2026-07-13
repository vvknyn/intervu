"use client";

import { ArrowLeft, BookOpen, Key, Microphone, Sparkle, Coins } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import type { PrepJobContext } from "@/lib/prep/job-context";
import type { PrepSessionMode } from "@/lib/prep/session-progress";
import { cn } from "@/lib/utils";
import { PrepJobHeader } from "./PrepJobHeader";

export type PrepEntitlement = { isAdmin: boolean; isBYOK: boolean; credits: number; monthlyFree: number };

export interface PrepModeSelectionProps {
  jobContext: PrepJobContext;
  isAuthenticated: boolean;
  entitlement: PrepEntitlement | null;
  entitlementLoading?: boolean;
  onSelectMode: (mode: PrepSessionMode) => void;
  onBack: () => void;
}

const MODES: Array<{
  mode: PrepSessionMode;
  title: string;
  subtitle: string;
  startLabel: string;
  icon: typeof BookOpen;
  iconBg: string;
  iconColor: string;
}> = [
  {
    mode: "learn",
    title: "Learn",
    subtitle: "Review questions and model answers at your own pace",
    startLabel: "Start Learn",
    icon: BookOpen,
    iconBg: "bg-blue-500/10",
    iconColor: "text-blue-500",
  },
  {
    mode: "practice",
    title: "Practice",
    subtitle: "Answer aloud and get AI critique on your responses",
    startLabel: "Start Practice",
    icon: Microphone,
    iconBg: "bg-brand/10",
    iconColor: "text-brand",
  },
];

function entitlementLabel(s: PrepEntitlement): { Icon: typeof Coins; label: string } {
  if (s.isAdmin) return { Icon: Sparkle, label: "Unlimited" };
  if (s.isBYOK) return { Icon: Key, label: "Your API key" };
  return { Icon: Coins, label: `${s.credits} credit${s.credits === 1 ? "" : "s"}` };
}

export function PrepModeSelection({
  jobContext,
  isAuthenticated,
  entitlement,
  entitlementLoading = false,
  onSelectMode,
  onBack,
}: PrepModeSelectionProps) {
  const entitlementDisplay = entitlement ? entitlementLabel(entitlement) : null;
  const startDisabled = isAuthenticated && entitlementLoading;

  return (
    <div className="w-full max-w-2xl animate-in fade-in duration-300">
      <Button variant="ghost" size="sm" onClick={onBack} className="mb-6 -ml-2">
        <ArrowLeft size={16} className="mr-1.5" />
        Back
      </Button>

      <PrepJobHeader jobContext={jobContext} onEdit={onBack} />

      <p className="text-muted-foreground text-sm mb-4">
        How do you want to prepare for this interview?
      </p>

      {entitlementDisplay && (
        <div
          className="flex items-center gap-2 text-sm text-muted-foreground mb-2"
          data-testid="prep-entitlement-label"
        >
          <entitlementDisplay.Icon size={16} weight="regular" />
          <span>{entitlementDisplay.label}</span>
        </div>
      )}

      {entitlementLoading && isAuthenticated && (
        <p className="text-sm text-muted-foreground mb-4" data-testid="prep-entitlement-loading">
          Checking credits…
        </p>
      )}

      {!isAuthenticated && (
        <p className="text-sm text-muted-foreground mb-6" data-testid="prep-sign-in-prompt">
          Sign in to start
        </p>
      )}

      <div className={cn("grid grid-cols-1 sm:grid-cols-2 gap-4", !isAuthenticated && "mb-0")}>
        {MODES.map(({ mode, title, subtitle, startLabel, icon: Icon, iconBg, iconColor }) => (
          <button
            key={mode}
            onClick={() => !startDisabled && onSelectMode(mode)}
            disabled={startDisabled}
            data-testid={`prep-mode-${mode}`}
            className={cn(
              "group text-left p-5 rounded-xl border border-border/40 bg-card",
              "hover:shadow-md hover:border-border/60 transition-all duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              startDisabled && "opacity-60 cursor-not-allowed hover:shadow-none",
            )}
          >
            <div
              className={cn(
                "w-10 h-10 rounded-lg flex items-center justify-center mb-4",
                iconBg,
              )}
            >
              <Icon size={22} weight="duotone" className={iconColor} />
            </div>
            <h3 className="font-semibold text-base mb-1 group-hover:text-brand transition-colors">
              {title}
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed mb-3">
              {subtitle}
            </p>
            <span className="text-xs font-medium text-brand">{startLabel}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
