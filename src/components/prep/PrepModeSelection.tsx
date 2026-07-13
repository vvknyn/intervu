"use client";

import { ArrowLeft, BookOpen, Microphone } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import type { PrepJobContext } from "@/lib/prep/job-context";
import type { PrepSessionMode } from "@/lib/prep/session-progress";
import { cn } from "@/lib/utils";
import { PrepJobHeader } from "./PrepJobHeader";

export interface PrepModeSelectionProps {
  jobContext: PrepJobContext;
  onSelectMode: (mode: PrepSessionMode) => void;
  onBack: () => void;
}

const MODES: Array<{
  mode: PrepSessionMode;
  title: string;
  subtitle: string;
  icon: typeof BookOpen;
  iconBg: string;
  iconColor: string;
}> = [
  {
    mode: "learn",
    title: "Learn",
    subtitle: "Review questions and model answers at your own pace",
    icon: BookOpen,
    iconBg: "bg-blue-500/10",
    iconColor: "text-blue-500",
  },
  {
    mode: "practice",
    title: "Practice",
    subtitle: "Answer aloud and get AI critique on your responses",
    icon: Microphone,
    iconBg: "bg-brand/10",
    iconColor: "text-brand",
  },
];

export function PrepModeSelection({
  jobContext,
  onSelectMode,
  onBack,
}: PrepModeSelectionProps) {
  return (
    <div className="w-full max-w-2xl animate-in fade-in duration-300">
      <Button variant="ghost" size="sm" onClick={onBack} className="mb-6 -ml-2">
        <ArrowLeft size={16} className="mr-1.5" />
        Back
      </Button>

      <PrepJobHeader jobContext={jobContext} onEdit={onBack} />

      <p className="text-muted-foreground text-sm mb-6">
        How do you want to prepare for this interview?
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {MODES.map(({ mode, title, subtitle, icon: Icon, iconBg, iconColor }) => (
          <button
            key={mode}
            onClick={() => onSelectMode(mode)}
            data-testid={`prep-mode-${mode}`}
            className={cn(
              "group text-left p-5 rounded-xl border border-border/40 bg-card",
              "hover:shadow-md hover:border-border/60 transition-all duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
            <p className="text-xs text-muted-foreground leading-relaxed">
              {subtitle}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
