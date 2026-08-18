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
import { toast } from "@/lib/toast";

const CLIENT_LABEL: Record<McpHandoffClient, string> = {
    claude: "Claude",
    chatgpt: "ChatGPT",
};

/**
 * Shown once, at the moment someone commits to applying, offering to hand the
 * role to their own AI first. Deliberately NOT an offer to generate anything
 * here: intervu passes the role and the user's own material to an assistant
 * they already trust, and that assistant answers to them. Nothing is written,
 * filled in or sent on the user's behalf, and the copy says so, because the
 * failure mode this product exists in opposition to is an autofill that
 * invents credentials nobody claimed.
 *
 * `onContinue` runs from a real click inside this dialog, which matters: the
 * apply path ends in `window.open`, and a popup blocker kills that unless it
 * runs synchronously inside a user gesture. Opening a dialog first and calling
 * `window.open` from a timer or an effect afterwards would break applying.
 */
export function ApplyIntentDialog({
    job,
    open,
    onOpenChange,
    onContinue,
}: {
    job: JobHandoffInput | null;
    open: boolean;
    onOpenChange: (next: boolean) => void;
    onContinue: () => void;
}) {
    const [choosing, setChoosing] = useState(false);

    if (!job) return null;

    const handoff = (client: McpHandoffClient) => {
        saveHandoffClient(client);
        try {
            navigator.clipboard?.writeText(buildJobMcpHandoffPrompt(job)).catch(() => {});
        } catch {
            // Clipboard is a convenience; the URL below carries the prompt too.
        }
        window.open(buildHandoffUrl(client, job), "_blank", "noopener,noreferrer");
        toast.success(`Opening ${CLIENT_LABEL[client]} with this role`);
        onOpenChange(false);
    };

    const saved = getSavedHandoffClient();

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="rounded-none sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="text-title">Let your AI read this first</DialogTitle>
                    <DialogDescription className="text-[13.5px] leading-relaxed">
                        We can hand {CLIENT_LABEL[saved ?? "claude"]} the whole role — title, pay
                        band, the full description — along with your résumé and what you&apos;ve
                        already applied to, so it can tell you what to lead with before you write
                        anything. It drafts nothing on its own, and nothing is sent for you.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-2">
                    {saved && !choosing ? (
                        <button
                            type="button"
                            onClick={() => handoff(saved)}
                            className="inline-flex h-11 items-center justify-center gap-2 rounded-none bg-brand px-4 font-mono text-xs font-bold uppercase tracking-wider text-brand-foreground transition-colors hover:bg-brand-muted"
                        >
                            Open in {CLIENT_LABEL[saved]}
                        </button>
                    ) : (
                        <div className="grid grid-cols-2 gap-2">
                            {(Object.keys(CLIENT_LABEL) as McpHandoffClient[]).map((client) => (
                                <button
                                    key={client}
                                    type="button"
                                    onClick={() => handoff(client)}
                                    className="inline-flex h-11 items-center justify-center rounded-none bg-brand px-4 font-mono text-xs font-bold uppercase tracking-wider text-brand-foreground transition-colors hover:bg-brand-muted"
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
                            className="self-start font-mono text-[11px] uppercase tracking-wider text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
                        >
                            Use a different AI
                        </button>
                    )}

                    <div className="my-1 h-px bg-border" />

                    <button
                        type="button"
                        onClick={() => {
                            // Depart first, close second: `window.open` has to
                            // run in this click's own gesture stack, and doing
                            // it before any state change keeps that obvious.
                            onContinue();
                            onOpenChange(false);
                        }}
                        className="inline-flex h-11 items-center justify-center gap-2 rounded-none border border-border-strong px-4 font-mono text-xs font-bold uppercase tracking-wider transition-colors hover:bg-surface-hover"
                    >
                        <ArrowSquareOut size={16} />
                        Continue to the posting
                    </button>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[12px]">
                    <Link
                        href="/connect"
                        className="text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
                    >
                        How connecting works
                    </Link>
                    <button
                        type="button"
                        onClick={() => {
                            dismissApplyIntent();
                            onContinue();
                            onOpenChange(false);
                        }}
                        className="text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
                    >
                        Don&apos;t show this again
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
