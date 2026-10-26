"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { McpHandoffActions } from "@/components/mcp/McpHandoffActions";
import { Dismissible } from "@/components/ui/dismissible";
import { type JobHandoffInput } from "@/lib/mcp/job-handoff";
import { readMcpHandoffNoteDismissed, writeMcpHandoffNoteDismissed } from "@/lib/mcp/handoff-note-dismiss";
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
 *  a screen; the same variant must not. A variant may add a short heading
 *  above its sentence (e.g. naming the AI assistants this hands off to);
 *  most don't need one. */
export const VARIANT_COPY: Record<"intelligence" | "prep", { heading?: string; sentence: string }> = {
    intelligence: {
        heading: "Check your fit in Claude, ChatGPT or Cursor",
        sentence: "Connect your AI assistant and it can read this posting and your résumé.",
    },
    prep: {
        sentence: "Interviewing? Your AI can prep you with this job's context.",
    },
};

export function McpHandoffNote({
    variant = "intelligence",
    job,
    className,
}: {
    variant?: keyof typeof VARIANT_COPY;
    job?: JobHandoffInput;
    className?: string;
}) {
    const copy = VARIANT_COPY[variant];
    const dismissible = variant === "intelligence";
    const [dismissed, setDismissed] = useState<boolean | null>(dismissible ? null : false);

    useEffect(() => {
        if (!dismissible) return;
        try {
            setDismissed(readMcpHandoffNoteDismissed(window.localStorage));
        } catch {
            setDismissed(false);
        }
    }, [dismissible]);

    if (dismissible && dismissed !== false) return null;

    const dismiss = () => {
        try {
            writeMcpHandoffNoteDismissed(window.localStorage);
        } catch {
            /* private mode — hide for this view anyway */
        }
        setDismissed(true);
    };

    const body = job ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="min-w-[16ch] flex-1">
                {copy.heading && <span className="block font-semibold text-foreground">{copy.heading}</span>}
                {copy.sentence}
            </p>
            <McpHandoffActions job={job} />
        </div>
    ) : (
        <>
            {copy.heading && <p className="mb-1 font-semibold text-foreground">{copy.heading}</p>}
            {copy.sentence}{" "}
            <Link href="/connect" className="font-semibold text-brand underline underline-offset-4 hover:text-brand">
                Connect it once
            </Link>
        </>
    );

    return (
        <div className={cn("rounded-none border border-border bg-muted px-4 py-3 text-sm text-foreground", className)}>
            {dismissible ? (
                <Dismissible onDismiss={dismiss} dismissTestId="mcp-handoff-dismiss">
                    {body}
                </Dismissible>
            ) : (
                body
            )}
        </div>
    );
}
