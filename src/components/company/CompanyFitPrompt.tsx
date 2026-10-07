"use client";

import { Sparkle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";

/**
 * The company page's question for a visitor with no résumé on hand: which of
 * these roles fit them. Most visitors arrive from a search for the company
 * and leave without a click (Google arrivals on /co/, 30 days to 2026-10-07:
 * 71 visits, 20 clicked anything, none followed), and nothing on the page
 * offered what Velai does that a careers page doesn't. Its button opens the
 * résumé importer in place; the answer is the list itself, best fit first
 * with each role's label.
 *
 * Outline button: Follow stays the page's one filled action.
 */
export function CompanyFitPrompt({
  title,
  body,
  onAddResume,
}: {
  title: string;
  body: string;
  onAddResume: () => void;
}) {
  return (
    // On a phone it is one row, the question and its button, so the first
    // role still shows on the first screen (J-COMPANY-39); the line saying
    // where the résumé is kept shows from `sm` up, and in the importer.
    <div
      data-testid="company-fit-prompt"
      className="mb-6 flex items-center gap-3 rounded-panel border border-border bg-surface p-3 shadow-[var(--shadow-bevel-highlight)] sm:mb-8 sm:gap-6 sm:p-4"
    >
      <div className="min-w-0 flex-1">
        <p className="flex items-start gap-2 text-sm font-semibold text-foreground sm:text-base">
          <Sparkle size={16} weight="fill" className="mt-0.5 shrink-0 text-brand sm:mt-1" aria-hidden />
          {title}
        </p>
        <p className="mt-1 hidden text-sm text-muted-foreground sm:block">{body}</p>
      </div>
      <Button type="button" variant="outline" onClick={onAddResume} className="shrink-0">
        Check my fit
      </Button>
    </div>
  );
}
