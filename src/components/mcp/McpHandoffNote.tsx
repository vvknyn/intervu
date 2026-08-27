import Link from "next/link";
import { McpHandoffActions } from "@/components/mcp/McpHandoffActions";
import { type JobHandoffInput } from "@/lib/mcp/job-handoff";
import { cn } from "@/lib/utils";

/**
 * Single source of truth for the "your AI does this" handoff line.
 *
 * Product decision (2026-08-02): intervu's web app does search + truth
 * signals + tracker ONLY. Every AI-intelligence surface this note replaces
 * ("Am I a fit?", tailored-resume generation, gap analysis, "generate with
 * AI") now happens exclusively through the user's own AI via MCP (/connect).
 * Every call site that used to own its own CTA renders THIS one component
 * instead of writing its own copy, so the line can't drift between surfaces
 * and never repeats itself within a single screen (each call site owns
 * whether it renders at all, not what it says).
 *
 * Visual language matches the existing quiet note this pattern was modeled
 * on (JobDetail.tsx / yours/[id]/page.tsx's prep-removal note, 2026-08-02):
 * plain bordered box, no radius (design-system rule), no icon.
 *
 * State model (2026-08-07 declutter): one sentence + one action, always.
 * The sentence here never changes with pairing state; McpHandoffActions
 * owns which single action renders (resting button, chooser, or paired
 * button) and is the only place pairing copy ("Connect once →", "Switch
 * AI") appears — this component never duplicates it.
 */
/** Copy lives HERE per variant — call sites choose a purpose, never write
 *  their own line, so surfaces can't drift. Two different variants may share
 *  a screen; the same variant must not. */
const VARIANT_COPY = {
    intelligence: "Fit, gaps, tailoring — your AI does this.",
    prep: "Interviewing? Your AI can prep you with this job's context.",
} as const;

export function McpHandoffNote({
    variant = "intelligence",
    job,
    className,
}: {
    variant?: keyof typeof VARIANT_COPY;
    job?: JobHandoffInput;
    className?: string;
}) {
    if (!job) {
        return (
            <div className={cn("border border-emerald-300/80 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-800/80 dark:bg-emerald-950/50 dark:text-emerald-200 shadow-2xs", className)}>
                {VARIANT_COPY[variant]}{" "}
                <Link href="/connect" className="font-bold text-emerald-900 underline underline-offset-4 hover:text-emerald-950 dark:text-emerald-300">
                    Connect it once →
                </Link>
            </div>
        );
    }

    return (
        <div className={cn("border border-emerald-300/80 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-800/80 dark:bg-emerald-950/50 dark:text-emerald-200 shadow-2xs", className)}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <p className="min-w-[16ch] flex-1 font-medium">{VARIANT_COPY[variant]}</p>
                <McpHandoffActions job={job} />
            </div>
        </div>
    );
}
