import Link from "next/link";
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
    className,
}: {
    variant?: keyof typeof VARIANT_COPY;
    className?: string;
}) {
    return (
        <div className={cn("rounded-none border border-border bg-muted/40 px-4 py-2 text-sm text-muted-foreground", className)}>
            {VARIANT_COPY[variant]}{" "}
            <Link href="/connect" className="font-medium text-foreground underline underline-offset-4 hover:text-foreground">
                Connect it once →
            </Link>
        </div>
    );
}
