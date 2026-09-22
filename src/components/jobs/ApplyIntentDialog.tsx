"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowSquareOut } from "@phosphor-icons/react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    buildHandoffUrl,
    buildJobMcpHandoffPrompt,
    getSavedHandoffClient,
    saveHandoffClient,
    type JobHandoffInput,
    type McpHandoffClient,
} from "@/lib/mcp/job-handoff";
import { dismissApplyIntent } from "@/lib/jobs/apply-intent";
import { decodeText, displayCompanyBrand, locationText, titleCaseDisplay } from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";
import { toast } from "@/lib/toast";
import { isHttpApplyUrl } from "@/components/jobs/use-gated-apply";

const CLIENT_LABEL: Record<McpHandoffClient, string> = {
    claude: "Claude",
    chatgpt: "ChatGPT",
};

const outlineButtonCls =
    "inline-flex h-11 items-center justify-center gap-2 rounded-ctl border border-border-strong px-4 text-xs font-semibold transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Shown once, at the moment someone commits to applying. Handing the role to
 * the user's own AI (Claude/ChatGPT, connected over MCP) is the offer here —
 * it can read the résumé, tailor it against this posting, and save the
 * result back to the account (`get_resume`/`save_resume_variant`); nothing
 * is written, filled in, or sent on the user's behalf from inside intervu
 * itself. "Continue to the posting" always stays available: it is never a
 * gate on applying.
 *
 * `onContinue` is side effects only (e.g. arm the signed-in return prompt).
 * Employer navigation is the anchor's default action — a real `<a href>`
 * inside the click so closing this dialog cannot sever a delayed assignment.
 */
export function ApplyIntentDialog({
    job,
    open,
    onOpenChange,
    onContinue,
}: {
    job: PublicJob | null;
    open: boolean;
    onOpenChange: (next: boolean) => void;
    onContinue: () => void;
}) {
    const [choosing, setChoosing] = useState(false);

    if (!job) return null;

    // Same shape every external-handoff consumer needs — the one mapping
    // moved here from the two mount sites (jobs/page.tsx, PublicJobDetail.tsx)
    // so description/company_domain reach this dialog too instead of being
    // dropped at the door by a second, narrower prop. `company` goes through
    // the same displayCompanyBrand chain the SERP/detail panes render — this
    // text is copied into an external Claude/ChatGPT prompt URL
    // (buildJobMcpHandoffPrompt), so an uncleaned index value would leak
    // "REQ123 Acme" into another product's UI, not just intervu's own.
    const handoffJob: JobHandoffInput = {
        id: job.id,
        title: titleCaseDisplay(decodeText(job.title)),
        company: displayCompanyBrand(job.company, job.company_domain, job.title) || "Unknown company",
        location: locationText(job) || null,
    };

    const handoff = (client: McpHandoffClient) => {
        saveHandoffClient(client);
        try {
            navigator.clipboard?.writeText(buildJobMcpHandoffPrompt(handoffJob)).catch(() => {});
        } catch {
            // Clipboard is a convenience; the URL below carries the prompt too.
        }
        window.open(buildHandoffUrl(client, handoffJob), "_blank", "noopener,noreferrer");
        toast.success(`Opening ${CLIENT_LABEL[client]} with this role`);
        onOpenChange(false);
    };

    const saved = getSavedHandoffClient();
    const postingHref = job.apply_url && isHttpApplyUrl(job.apply_url) ? job.apply_url : null;

    const deferClose = () => {
        setTimeout(() => onOpenChange(false), 0);
    };

    const handleContinueSideEffects = () => {
        onContinue();
        deferClose();
    };

    const handleDismissAndContinue = () => {
        dismissApplyIntent();
        handleContinueSideEffects();
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {/* Three-zone modal (ui-patterns.com's prescription for variable-
                length modal content): fixed header, a scrolling middle that
                owns its own overflow, and a footer pinned outside that scroll.
                `flex flex-col` on the shell + `min-h-0` on the middle zone is
                what makes the middle actually shrink and scroll instead of
                growing the whole dialog past `max-h` and pushing the footer
                off screen — that was the bug: the exit lived inside the same
                scrolling block as content that can run long. */}
            <DialogContent className="flex max-h-[85dvh] flex-col rounded-panel sm:max-w-lg">
                <DialogHeader className="shrink-0">
                    <DialogTitle className="text-title">Tailor your résumé — free, bring your own agent</DialogTitle>
                    <DialogDescription className="text-sm leading-relaxed">
                        Connect Claude or ChatGPT over MCP and it can read your résumé, tailor it
                        for this role, and save the result back to your account.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto py-0.5">
                    {saved && !choosing ? (
                        <button type="button" onClick={() => handoff(saved)} className={outlineButtonCls}>
                            Open in {CLIENT_LABEL[saved]}
                        </button>
                    ) : (
                        <div className="grid grid-cols-2 gap-2">
                            {(Object.keys(CLIENT_LABEL) as McpHandoffClient[]).map((client) => (
                                <button
                                    key={client}
                                    type="button"
                                    onClick={() => handoff(client)}
                                    className={outlineButtonCls}
                                >
                                    {CLIENT_LABEL[client]}
                                </button>
                            ))}
                        </div>
                    )}

                    {saved && !choosing && (
                        <button
                            type="button"
                            onClick={() => setChoosing(true)}
                            className="self-start text-xs text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
                        >
                            Use a different AI
                        </button>
                    )}
                </div>

                {/* Pinned footer — the exit. Renders in every phase, including
                    `blocked`, and never scrolls with the middle zone: someone
                    who clicked Apply is trying to reach the posting, and
                    neither AI lane may trap them behind a scroll. The top
                    border is what reads this as its own zone rather than a
                    third "hand it to your AI" option sitting flush under
                    Claude/ChatGPT. */}
                <div className="flex shrink-0 flex-col gap-2 border-t border-border pt-3">
                    {postingHref ? (
                        <a
                            href={postingHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={handleContinueSideEffects}
                            className={outlineButtonCls}
                        >
                            <ArrowSquareOut size={16} />
                            Continue to the posting
                        </a>
                    ) : (
                        <button type="button" onClick={handleContinueSideEffects} className={outlineButtonCls}>
                            <ArrowSquareOut size={16} />
                            Continue to the posting
                        </button>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <Link
                            href="/connect"
                            className="text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
                        >
                            How connecting works
                        </Link>
                        {postingHref ? (
                            <a
                                href={postingHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={handleDismissAndContinue}
                                className="text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
                            >
                                Don&apos;t show this again
                            </a>
                        ) : (
                            <button
                                type="button"
                                onClick={handleDismissAndContinue}
                                className="text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
                            >
                                Don&apos;t show this again
                            </button>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
