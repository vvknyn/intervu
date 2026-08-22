"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowSquareOut, CircleNotch } from "@phosphor-icons/react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
    buildHandoffUrl,
    buildJobMcpHandoffPrompt,
    getSavedHandoffClient,
    saveHandoffClient,
    type JobHandoffInput,
    type McpHandoffClient,
} from "@/lib/mcp/job-handoff";
import { dismissApplyIntent } from "@/lib/jobs/apply-intent";
import { decodeText, locationText } from "@/lib/jobs/presentation";
import { stripResidualHtml } from "@/lib/jobs/format-description";
import type { PublicJob } from "@/lib/jobs/types";
import {
    tailorResumeForJob,
    saveTailoredVersion,
    type TailorForJobResult,
} from "@/actions/tailor-resume";
import type { RecommendationPriority } from "@/types/resume";
import { classifySentinel, sentinelMessage } from "@/lib/llm/sentinels";
import { CREDIT_UNIT } from "@/lib/llm/credit-copy";
import { toast } from "@/lib/toast";

const CLIENT_LABEL: Record<McpHandoffClient, string> = {
    claude: "Claude",
    chatgpt: "ChatGPT",
};

/** Priority → Badge tone. Same ascending-heat idiom as `difficultyTone`
 *  (lib/ui/status-tokens.ts): low stays quiet, medium picks up the amber
 *  "worth a look" tone the ghost badges already use for caution, high is the
 *  one worth calling out. */
const PRIORITY_BADGE: Record<RecommendationPriority, "outline" | "st-intv" | "destructive"> = {
    low: "outline",
    medium: "st-intv",
    high: "destructive",
};

/** How many recommendations render before the "show all" toggle appears. */
const RECOMMENDATIONS_VISIBLE_CAP = 6;

type Phase = "idle" | "working" | "result" | "blocked";

/** Why the built-in lane is blocked. `auth`/`resume` are `TailorForJobResult`'s
 *  own `needs` values; `credits` and `error` come from the action's `error`
 *  string (`classifySentinel`) once `needs` is absent — see B2 in the spec.
 *  Four single-literal members (not one `kind: "auth" | "resume"` member) so
 *  each branch narrows on `.message` without a manual type assertion. */
type BlockedState =
    | { kind: "auth" }
    | { kind: "resume" }
    | { kind: "credits"; message: string }
    | { kind: "error"; message: string };

/** Posting text handed to the model — `PublicJob.description` is already
 *  plain text at ingest (see format-description.ts's module doc); this is
 *  the same defensive strip that surface already applies before rendering. */
function jobTextFrom(job: PublicJob): string {
    return stripResidualHtml(decodeText(job.description ?? "")).trim();
}

const brandButtonCls =
    "inline-flex h-11 items-center justify-center gap-2 rounded-none bg-brand px-4 text-xs font-bold uppercase tracking-wider text-brand-foreground transition-colors hover:bg-brand-muted disabled:cursor-not-allowed disabled:opacity-60";
const outlineButtonCls =
    "inline-flex h-11 items-center justify-center gap-2 rounded-none border border-border-strong px-4 text-xs font-bold uppercase tracking-wider transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Shown once, at the moment someone commits to applying. Built-in tailoring
 * is the primary offer here — reword and reorder what the résumé already
 * says against this posting, never invent a skill, employer or number the
 * user didn't write (enforced server-side, see `enforceResumeIntegrity`).
 * Handing the role to the user's own AI (Claude/ChatGPT) is the secondary,
 * quieter lane below it — nothing is written, filled in or sent on the
 * user's behalf there either. "Continue to the posting" always stays
 * available: neither lane is a gate on applying.
 *
 * `onContinue` runs from a real click inside this dialog, which matters: the
 * apply path ends in `window.open`, and a popup blocker kills that unless it
 * runs synchronously inside a user gesture. Opening a dialog first and calling
 * `window.open` from a timer or an effect afterwards would break applying.
 * The built-in tailoring call below is `await`-ed but never itself leads to
 * `window.open` in the same handler, so it can't trip this.
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
    const pathname = usePathname();
    const [choosing, setChoosing] = useState(false);
    const [phase, setPhase] = useState<Phase>("idle");
    const [result, setResult] = useState<TailorForJobResult | null>(null);
    const [blocked, setBlocked] = useState<BlockedState | null>(null);
    const [showAllRecs, setShowAllRecs] = useState(false);
    const [saving, setSaving] = useState(false);
    const [savedId, setSavedId] = useState<string | null>(null);

    if (!job) return null;

    // Same shape every external-handoff consumer needs — the one mapping
    // moved here from the two mount sites (jobs/page.tsx, PublicJobDetail.tsx)
    // so description/company_domain reach the built-in lane too instead of
    // being dropped at the door by a second, narrower prop.
    const handoffJob: JobHandoffInput = {
        id: job.id,
        title: decodeText(job.title),
        company: job.company || "Unknown company",
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

    const startTailoring = async () => {
        setPhase("working");
        setBlocked(null);
        const { data, error, needs } = await tailorResumeForJob({
            jobId: job.id,
            jobTitle: handoffJob.title,
            companyName: handoffJob.company,
            jobText: jobTextFrom(job),
            jobUrl: job.apply_url || undefined,
        });
        if (needs) {
            setBlocked(needs === "auth" ? { kind: "auth" } : { kind: "resume" });
            setPhase("blocked");
            return;
        }
        if (error) {
            const kind = classifySentinel(error) === "credits" ? "credits" : "error";
            setBlocked({ kind, message: sentinelMessage(error) });
            setPhase("blocked");
            return;
        }
        if (data) {
            setResult(data);
            setSavedId(null);
            setShowAllRecs(false);
            setPhase("result");
        }
    };

    const handleSave = async () => {
        if (!result?.tailored || !result.original) return;
        setSaving(true);
        const { data, error } = await saveTailoredVersion({
            versionName: `${handoffJob.company} — ${handoffJob.title}`,
            originalSummary: result.original.generatedSummary,
            originalExperience: result.original.experience,
            originalCompetencies: result.original.competencies,
            originalProfile: result.original.profile,
            originalEducation: result.original.education,
            sectionOrder: result.original.sectionOrder,
            tailoredSummary: result.tailored.summary,
            tailoredExperience: result.tailored.experience,
            tailoredCompetencies: result.tailored.competencies,
            companyName: handoffJob.company,
            positionTitle: handoffJob.title,
            recommendations: result.recommendations,
        });
        setSaving(false);
        if (error || !data) {
            toast.error(error || "Couldn't save this version");
            return;
        }
        setSavedId(data.id);
        toast.success("Saved to your résumé versions");
    };

    const visibleRecs = result
        ? showAllRecs
            ? result.recommendations
            : result.recommendations.slice(0, RECOMMENDATIONS_VISIBLE_CAP)
        : [];

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {/* Three-zone modal (ui-patterns.com's prescription for variable-
                length modal content): fixed header, a scrolling middle that
                owns its own overflow, and a footer pinned outside that scroll.
                `flex flex-col` on the shell + `min-h-0` on the middle zone is
                what makes the middle actually shrink and scroll instead of
                growing the whole dialog past `max-h` and pushing the footer
                off screen — that was the bug: the exit lived inside the same
                scrolling block as a recommendation list that can run long. */}
            <DialogContent className="flex max-h-[85vh] flex-col rounded-none sm:max-w-lg">
                <DialogHeader className="shrink-0">
                    <DialogTitle className="text-title">Tailor your résumé for this role</DialogTitle>
                    <DialogDescription className="text-[13.5px] leading-relaxed">
                        intervu rewords and reorders what your résumé already says so it lands
                        against this posting. It never adds a skill, employer or number you
                        didn&apos;t write.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto py-0.5">
                    {phase === "idle" && (
                        <button type="button" onClick={startTailoring} className={brandButtonCls}>
                            Tailor my résumé
                        </button>
                    )}

                    {phase === "working" && (
                        <button type="button" disabled className={brandButtonCls}>
                            <CircleNotch size={16} className="animate-spin" />
                            Reading the posting…
                        </button>
                    )}

                    {phase === "blocked" && blocked && (
                        <BlockedPanel
                            blocked={blocked}
                            pathname={pathname}
                            onRetry={() => {
                                setBlocked(null);
                                setPhase("idle");
                            }}
                        />
                    )}

                    {phase === "result" && result && (
                        <div className="flex flex-col gap-3 rounded-none border border-border p-3">
                            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                {result.recommendations.length} change
                                {result.recommendations.length === 1 ? "" : "s"} suggested
                            </p>

                            <div className="flex flex-col gap-2">
                                {visibleRecs.map((rec) => (
                                    <div key={rec.id} className="rounded-none border border-border p-2">
                                        <div className="flex items-start justify-between gap-2">
                                            <span className="text-[13px] font-semibold">{rec.title}</span>
                                            <Badge variant={PRIORITY_BADGE[rec.priority]}>{rec.priority}</Badge>
                                        </div>
                                        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                                            {rec.reasoning}
                                        </p>
                                    </div>
                                ))}
                            </div>

                            {!showAllRecs && result.recommendations.length > RECOMMENDATIONS_VISIBLE_CAP && (
                                <button
                                    type="button"
                                    onClick={() => setShowAllRecs(true)}
                                    className="self-start text-[11px] uppercase tracking-wider text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
                                >
                                    Show all {result.recommendations.length}
                                </button>
                            )}

                            {result.dropped > 0 && (
                                <p className="text-[12px] leading-relaxed text-muted-foreground">
                                    {result.dropped} suggestion{result.dropped === 1 ? "" : "s"} were
                                    discarded because {result.dropped === 1 ? "it added" : "they added"}{" "}
                                    something your résumé doesn&apos;t say.
                                </p>
                            )}

                            {result.mode === "structured" ? (
                                savedId ? (
                                    <Link href={`/resume?v=${savedId}`} className={brandButtonCls}>
                                        Open in the editor
                                    </Link>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={handleSave}
                                        disabled={saving}
                                        className={brandButtonCls}
                                    >
                                        {saving ? "Saving…" : `Save for ${handoffJob.company}`}
                                    </button>
                                )
                            ) : (
                                <Link href="/resume" className={outlineButtonCls}>
                                    Structure your résumé to save versions
                                </Link>
                            )}
                        </div>
                    )}

                    <div className="my-1 h-px bg-border" />

                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        Or hand it to your own AI
                    </p>

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
                            className="self-start text-[11px] uppercase tracking-wider text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
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
                    <button
                        type="button"
                        onClick={() => {
                            // Depart first, close second: `window.open` has to
                            // run in this click's own gesture stack, and doing
                            // it before any state change keeps that obvious.
                            onContinue();
                            onOpenChange(false);
                        }}
                        className={outlineButtonCls}
                    >
                        <ArrowSquareOut size={16} />
                        Continue to the posting
                    </button>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
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
                </div>
            </DialogContent>
        </Dialog>
    );
}

/** The built-in lane's blocked sub-states (B2 "blocked"). `auth`/`resume` are
 *  CTAs that route away; `credits` renders through `lib/llm/credit-copy`'s
 *  vocabulary rather than the raw `OUT_OF_CREDITS:`-prefixed string; `error`
 *  is the generic-failure fallback (network/provider trouble) with a way
 *  back to `idle` rather than a dead end. */
function BlockedPanel({
    blocked,
    pathname,
    onRetry,
}: {
    blocked: BlockedState;
    pathname: string;
    onRetry: () => void;
}) {
    if (blocked.kind === "auth") {
        return (
            <Link href={`/login?next=${encodeURIComponent(pathname)}`} className={brandButtonCls}>
                Sign in to tailor
            </Link>
        );
    }
    if (blocked.kind === "resume") {
        return (
            <Link href="/resume" className={brandButtonCls}>
                Add your résumé first
            </Link>
        );
    }
    if (blocked.kind === "credits") {
        return (
            <div className="flex flex-col gap-2 rounded-none border border-border-strong bg-muted/40 p-3">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Out of {CREDIT_UNIT.many}
                </p>
                <p className="text-[12.5px] leading-relaxed text-muted-foreground">{blocked.message}</p>
            </div>
        );
    }
    return (
        <div className="flex flex-col gap-2 rounded-none border border-border-strong bg-muted/40 p-3">
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">{blocked.message}</p>
            <button
                type="button"
                onClick={onRetry}
                className="self-start text-[11px] uppercase tracking-wider text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
            >
                Try again
            </button>
        </div>
    );
}
