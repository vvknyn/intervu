"use client";

import { useCallback, useEffect, useId, useState, useSyncExternalStore } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowSquareOut, CalendarBlank } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DotSeparated } from "@/components/ui/dot-separated";
import { InlineConfirm } from "@/components/ui/inline-confirm";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { toast } from "@/lib/toast";
import { getCurrentUser, onAuthChange, type User } from "@/lib/firebase/client-auth";
import { deleteApplication, updateApplication } from "@/actions/application";
import { captureEvent } from "@/lib/analytics/events";
import { AuthPopover } from "@/components/auth/auth-popover";
import { useAuthGate } from "@/components/auth/use-auth-gate";
import { openApplyUrl, useGatedApply } from "@/components/jobs/use-gated-apply";
import { formatAuthGateValueLine, type AuthGateReason } from "@/lib/auth/auth-gate-copy";
import { detailFetcher } from "@/lib/jobs/detail-fetch";
import { displayCompanyName } from "@/lib/jobs/presentation";
import { JobDescription, JobDetail } from "@/components/jobs/JobDetail";
import { formatDescription } from "@/lib/jobs/format-description";
import { ReceiptShell } from "@/components/jobs/receipt-shell";
import { LandedPledgeForPursuit } from "@/components/tracker/LandedPledgePanel";
import { PursuitNoteField } from "@/components/tracker/PursuitNoteField";
import { PursuitStatusPicker } from "@/components/tracker/PursuitStatusPicker";
import { McpHandoffNote } from "@/components/mcp/McpHandoffNote";
import { STATUS_PILL } from "@/lib/ui/status-tokens";
import type { PublicJob } from "@/lib/jobs/types";
import { listGuestPursuits, removeGuestPursuit, updateGuestPursuit } from "@/lib/pursuits/guest-store";
import { invalidatePursuitsCache, usePursuits } from "@/lib/pursuits/use-pursuits";
import {
    nextAction,
    orderResumeVersionsLatestFirst,
    type Pursuit,
    type PursuitStage,
    type ResumeVersionSnapshot,
} from "@/lib/pursuits/types";
import { pursuitDateFacts, trackerStatusLabel, trackerStatusPatch } from "@/lib/pursuits/tracker-display";
import { downloadResumeVersion } from "@/lib/pursuits/download-resume";
import { LoadFailedState } from "@/components/ui/load-failed-state";
import { WaitBar, WaitState } from "@/components/ui/wait-state";

/** Resume used row (spec: "label, saved date (mono), Download button").
 *  Only the MCP `save_resume_variant` tool files a version against a pursuit,
 *  so the card renders only when one exists: an empty "No resume version on
 *  file" card was all a web user ever saw (journey audit 2026-09-30). Lists
 *  every version, latest first, so re-filing a resume never hides earlier
 *  ones. */
function ResumeUsedCard({ versions, pursuit }: { versions: ResumeVersionSnapshot[]; pursuit: Pursuit }) {
    return (
        <div className="rounded-panel border border-border bg-surface p-6 shadow-[var(--shadow-bevel-highlight)]">
            <div className="mb-3 text-xs text-muted-foreground">Resume used</div>
            <div className="divide-y divide-border">
                {versions.map((version, i) => (
                    <div key={`${version.saved_at}-${i}`} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                        <div className="min-w-0">
                            <p className="truncate text-sm text-foreground">{version.label}</p>
                            <p className="text-xs text-muted-foreground">
                                {new Date(version.saved_at).toLocaleDateString(undefined, {
                                    year: "numeric",
                                    month: "short",
                                    day: "numeric",
                                })}
                            </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void downloadResumeVersion(version, { company_name: pursuit.company_name, position: pursuit.position })}
                            >
                                Download
                            </Button>
                            {/* .md stays available as a secondary, portable format
                                (R4/R5) — PDF is the default per the user report. */}
                            <button
                                type="button"
                                onClick={() => void downloadResumeVersion(version, { company_name: pursuit.company_name, position: pursuit.position }, "md")}
                                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                            >
                                .md
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

const subscribeNever = () => () => {};

/** Interview date for an applied or interviewing pursuit. The date input's
 *  value is a calendar day, stored as UTC midnight, so the saved value is
 *  read back with `slice(0, 10)` (its UTC day), never through a local Date. */
function InterviewDateField({
    saved,
    disabled,
    onSave,
}: {
    saved: string | undefined;
    disabled: boolean;
    onSave: (date: string) => void;
}) {
    const id = useId();
    const initial = saved ? saved.slice(0, 10) : "";
    const [value, setValue] = useState(initial);
    return (
        <div>
            <Label htmlFor={id} className="mb-1.5 block text-xs text-muted-foreground">
                Interview date
            </Label>
            <div className="flex flex-wrap items-center gap-2">
                <Input
                    id={id}
                    type="date"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    className="ctl-lg w-auto rounded-ctl border-border bg-surface-2 text-base shadow-[var(--shadow-bevel-inset)]"
                />
                <Button disabled={disabled || !value || value === initial} onClick={() => onSave(value)} className="gap-2">
                    <CalendarBlank size={16} />
                    {initial ? "Change date" : "Set interview date"}
                </Button>
            </div>
        </div>
    );
}

/**
 * The pursuit page, which replaces the tracker's detail sheet at xl+: the
 * role as the page title, then one card with everything you can change (the
 * same status row, interview date and note as the sheet, plus Remove), then
 * at most one handoff note per `nextAction()` (spec §3 "stage choreography"),
 * the résumé used and the saved posting. Reuses `updateApplication` for
 * signed-in mutations and `updateGuestPursuit` for a guest's local record —
 * same route either way, since `usePursuits()` already serves both from one
 * list.
 */
export default function PursuitDetailPage() {
    const params = useParams<{ id: string }>();
    const id = Array.isArray(params.id) ? params.id[0] : params.id;
    const { pursuits, loading, failed, retry } = usePursuits();
    // Pursuits live in this browser (a guest's store) or behind client-side
    // auth, so the server can only ever render "couldn't find that pursuit".
    // Hold the loading state until the client has read them, instead of
    // flashing not-found and failing hydration on every load.
    const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
    const [saving, setSaving] = useState(false);
    const [confirmingRemove, setConfirmingRemove] = useState(false);
    const [removing, setRemoving] = useState(false);
    // Set once a remove succeeds, so the page shows the way back rather than
    // flashing "couldn't find that pursuit" before the redirect lands.
    const [removed, setRemoved] = useState(false);
    // One clock read for this page's whole lifetime. JobDetail derives relative
    // ages from it during render, where a fresh Date.now() would be the
    // impure-render call react-hooks/purity flags.
    const [nowMs] = useState(() => Date.now());
    /**
     * Three outcomes, deliberately kept apart: we have the live posting, we
     * know it's gone, or we couldn't find out.
     *
     * The third is not hypothetical. Looking a posting up by id needs `id` in
     * the index's `filterableAttributes` — index state, not repo state. That
     * setting went live 2026-07-25 (verified: `id = "<doc>"` resolves), but it
     * was absent for the six days before, during which this lookup failed
     * outright, and a future re-provision can drop it again with no deploy.
     * Collapsing "couldn't check" into "no longer live" would tell people a
     * role they can still apply to is dead. `detailFetcher.fetch`
     * (lib/jobs/detail-fetch.ts) is the existing chokepoint for exactly this
     * call, and it degrades to "unknown" whether the response classifies
     * that way, its own fetch deadline lapses, or the request itself throws.
     */
    const [detail, setDetail] = useState<{
        open: boolean;
        job: PublicJob | null;
        state: "idle" | "loading" | "gone" | "unknown";
        descriptionPending: boolean;
    }>({ open: false, job: null, state: "idle", descriptionPending: false });
    // Bumped by `retryDescription` to force the existence-check effect below
    // to re-run for the same job id after a timed-out fill (0 = no retry yet).
    const [retryNonce, setRetryNonce] = useState(0);

    const pursuit = pursuits.find((p) => p.id === id);

    const router = useRouter();
    const searchParams = useSearchParams();

    /**
     * R5a (2026-08-09 founder report): a résumé variant saved via the MCP
     * `save_resume_variant` tool now returns a `download_url` shaped
     * `/yours/<pursuitId>?download=pdf&variant=<saved_at>` so the agent can
     * hand the user a working download link right in chat. Auto-triggers
     * the SAME client-side renderer the in-page Download button uses
     * (`downloadResumeVersion`) once the pursuit's own resume_versions have
     * loaded — one renderer, two entry points, never a second server-side
     * PDF path to drift from this one.
     *
     * Auth-gated on the session cookie, same as every other real-account
     * mutation on this page (`mutate`, above) — `/yours` itself is public
     * (guest tracker), but a variant only ever exists for a signed-in
     * user's Firestore-backed pursuit, so a logged-out visitor is bounced
     * to `/login?next=<this URL>` and lands right back here, query intact
     * (`/yours/<id>` is in SAFE_POST_AUTH_PREFIXES — lib/auth/product-
     * routes.ts), where this effect re-fires and completes the download.
     */
    useEffect(() => {
        if (loading || searchParams.get("download") !== "pdf") return;
        if (!getCurrentUser()) {
            const here = `/yours/${id}?${searchParams.toString()}`;
            router.replace(`/login?next=${encodeURIComponent(here)}`); // signup-gate-exempt: client redirect into the auth flow, not a rendered prompt
            return;
        }
        if (!pursuit) return; // still resolving, or genuinely not found — no-op, no false error
        const variantKey = searchParams.get("variant");
        const version = pursuit.resume_versions?.find((v) => v.saved_at === variantKey);
        if (version) {
            void downloadResumeVersion(version, { company_name: pursuit.company_name, position: pursuit.position });
        } else {
            toast.error("Couldn't find that resume version — it may have been re-filed since this link was created.");
        }
        router.replace(`/yours/${id}`);
    }, [loading, pursuit, id, searchParams, router]);

    /**
     * Open the live posting behind this pursuit. Only reachable when `job_id`
     * exists — a manually-added pursuit has no posting to show, so its card
     * stays inert rather than opening a sheet that can only apologise.
     * Fetched once and kept; reopening doesn't re-query.
     */
    const openDetail = async (jobId: string) => {
        if (detail.job) return setDetail((d) => ({ ...d, open: true }));
        setDetail({ open: true, job: null, state: "loading", descriptionPending: false });
        const check = await detailFetcher.fetch(jobId);
        setDetail({
            open: true,
            job: check.status === "found" ? check.job : null,
            state: check.status === "found" ? "idle" : check.status === "not_found" ? "gone" : "unknown",
            descriptionPending: check.status === "found" && check.descriptionPending,
        });
    };

    // "try again" on a timed-out description — re-runs the SAME existence
    // check for the currently open job. A pending result never refetches on
    // its own (no auto-polling); this only fires from the explicit click.
    const retryDescription = useCallback(() => {
        const jobId = pursuit?.job_id;
        if (!jobId) return;
        setDetail((d) => ({ ...d, state: "loading" }));
        setRetryNonce((n) => n + 1);
    }, [pursuit?.job_id]);

    useEffect(() => {
        if (retryNonce === 0) return;
        const jobId = pursuit?.job_id;
        if (!jobId) return;
        void (async () => {
            const check = await detailFetcher.fetch(jobId);
            // A failed retry ("unknown", or a "not_found" for a job that WAS
            // showing a moment ago) keeps the previously rendered job and its
            // pending flag on screen — see `runExistenceCheck`'s (lib/jobs/
            // result-state.ts) doc comment for why a failed request is never
            // treated as proof the role is gone.
            setDetail((d) =>
                check.status === "found"
                    ? { ...d, job: check.job, state: "idle", descriptionPending: check.descriptionPending }
                    : { ...d, state: "idle" },
            );
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [retryNonce]);

    const [user, setUser] = useState<User | null>(() => getCurrentUser());
    useEffect(() => onAuthChange(setUser), []);

    // Job 2 gate (2026-09-18): `/yours` is explicitly public (guest
    // tracker — see this page's own doc comment), so every control below
    // that can open the employer's posting routes through the same
    // chokepoint every other job surface uses (`use-gated-apply.ts`).
    // Unlike jobs/page.tsx and PublicJobDetail.tsx, none of this page's
    // three controls reliably has a full `PublicJob` at click time — two
    // only ever carry `pursuit.job_url`, a bare string — so `Job` here is
    // that URL, and the post-auth replay can't reopen `ApplyIntentDialog`
    // (it needs a full `PublicJob`). The honest floor instead: reopen the
    // job sheet via a REAL fetch (`openDetail`) so the user's own next
    // click on ITS "Open posting" button is a fresh gesture; a manually-
    // added pursuit (job_url but no job_id — no sheet exists at all) has
    // nothing further to surface and is simply left on the tracker.
    const [authGateReason, setAuthGateReason] = useState<AuthGateReason | null>(null);
    const { gate, authOpen, setAuthOpen, onAuthed } = useAuthGate<string>({
        handlers: {
            apply: () => {
                if (pursuit?.job_id) void openDetail(pursuit.job_id);
            },
            // This page has no résumé importer — nothing here ever calls
            // `gate({ kind: "upload", ... })`. Still required:
            // `AuthGateHandlers` is a mapped type over every `PendingAction`
            // kind, so every caller supplies both.
            upload: () => {},
        },
        user,
        // Titles the dialog for the click that opened it ("Sign in to apply");
        // without it a guest's Open posting got a plain "Sign in".
        onGateOpen: setAuthGateReason,
    });
    const gatedOpenPosting = useGatedApply<string>({
        user,
        gate: (action) => gate({ kind: "apply", payload: action.payload }, { originSurface: "job_detail", gateReason: "apply" }),
        perform: openApplyUrl,
    });

    /** Writes a patch to the account (signed in) or this browser's guest
     *  store. `busy` greys the status row and date button while it runs; a
     *  note autosave passes false so typing never flickers the controls. */
    const mutate = async (patch: Partial<Pursuit>, { busy = true }: { busy?: boolean } = {}) => {
        if (busy) setSaving(true);
        try {
            if (getCurrentUser()) {
                const res = await updateApplication(id, patch);
                if (res.error) {
                    toast.error(`Could not save: ${res.error}`);
                    return false;
                }
                invalidatePursuitsCache();
            } else if (!updateGuestPursuit(id, patch)) {
                toast.error("Could not find this pursuit.");
                return false;
            }
            return true;
        } finally {
            if (busy) setSaving(false);
        }
    };

    const backLink = (
        <Link href="/yours" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft size={16} />
            Tracker
        </Link>
    );
    // The tracker's own masthead (display size, not sticky) in every state, so
    // the page doesn't jump from a compact bar to a tall one as it loads.
    const header = (title: string, description?: React.ReactNode) => (
        <PageHeader sticky={false} size="display" title={title} description={description} actions={backLink} />
    );

    if (!hydrated || loading || (removed && !pursuit)) {
        return (
            <PageLayout header={header("Tracker")}>
                <WaitState
                    label={removed ? "Back to your tracker" : "Loading pursuit"}
                    skeleton={
                        <div className="space-y-4">
                            <WaitBar className="h-32 rounded-panel" />
                            <WaitBar className="h-24 rounded-panel" />
                        </div>
                    }
                />
            </PageLayout>
        );
    }

    if (!pursuit && failed) {
        return (
            <PageLayout header={header("Tracker")}>
                <LoadFailedState title="We can't load this pursuit right now." onRetry={retry} testId="pursuit-load-failed" />
            </PageLayout>
        );
    }

    if (!pursuit) {
        return (
            <PageLayout header={header("Tracker")}>
                <div data-testid="pursuit-not-found" className="py-24 text-center text-sm text-muted-foreground">
                    We couldn&apos;t find that pursuit.
                </div>
            </PageLayout>
        );
    }

    const action = nextAction(pursuit);
    const snapshot = pursuit.job_snapshot;
    // `pursuit.company_name` is a Firestore-stored snapshot (`buildJobSnapshot`/
    // `upsertPursuitCore`) — the live Meili index carries the ATS-stated raw
    // name permanently (intervu owns brand cleaning at display time, never at
    // ingest — ingest is the pipeline repo's sync.mjs, which PUTs the
    // Subspace feed through unchanged), so every snapshot taken
    // from it carries the raw value too, and nothing ever rewrites a pursuit
    // already on file. Cleaned at render instead, same as every live search hit.
    const companyName = displayCompanyName(pursuit.company_name);
    // Ashby/Lever store literal Markdown; the same formatter the live
    // posting uses turns it into headings, paragraphs and lists instead of
    // printing "**" (2026-09-30 founder report).
    const descriptionBlocks = formatDescription(snapshot?.description);
    const resumeVersions = orderResumeVersionsLatestFirst(pursuit.resume_versions ?? []);
    const showInterviewDate = pursuit.status === "applied" || pursuit.status === "interviewing";

    // Same writes, toast and event as the tracker's detail sheet
    // (yours/page.tsx), so a status set here reads the same everywhere.
    const changeStatus = async (status: PursuitStage) => {
        const fromStage = pursuit.status;
        const jobId = pursuit.job_id;
        if (!(await mutate(trackerStatusPatch(pursuit, status, new Date().toISOString())))) return;
        toast.success(`Marked ${trackerStatusLabel(status).toLowerCase()}`);
        if (jobId) captureEvent("application_stage_changed", { job_id: jobId, from_stage: fromStage, to_stage: status });
    };

    const saveInterviewDate = async (date: string) => {
        if (await mutate({ status: "interviewing", interview_date: new Date(date).toISOString() })) {
            toast.success("Interview date saved");
        }
    };

    const saveNote = async (note: string) => {
        if (!(await mutate({ note }, { busy: false }))) throw new Error("note not saved");
    };

    const remove = async () => {
        const jobId = pursuit.job_id;
        setRemoving(true);
        try {
            if (getCurrentUser()) {
                const res = await deleteApplication(id);
                if (res.error) {
                    toast.error(res.error);
                    return;
                }
                invalidatePursuitsCache();
            } else {
                removeGuestPursuit(id);
            }
            setRemoved(true);
            if (jobId) captureEvent("job_unsaved", { job_id: jobId });
            toast.success("Removed");
            router.push("/yours");
        } finally {
            setRemoving(false);
            setConfirmingRemove(false);
        }
    };

    return (
        <PageLayout header={header(pursuit.position, <DotSeparated items={[companyName, snapshot?.location]} />)}>
            <div className="space-y-6">
                {/* Everything you can change about this application, in one card:
                    the same status row, interview date and note as the tracker's
                    detail sheet, which this page replaces at xl+. */}
                <section
                    aria-label="Your application"
                    className="space-y-5 rounded-panel border border-border bg-surface p-6 shadow-[var(--shadow-bevel-highlight)]"
                >
                    <div data-testid="pursuit-stage">
                        <h2 className="mb-1.5 text-xs text-muted-foreground">Status</h2>
                        <PursuitStatusPicker status={pursuit.status} disabled={saving} onChange={(status) => void changeStatus(status)} />
                        <p data-testid="pursuit-dates" className="mt-2 text-sm text-muted-foreground">
                            <DotSeparated items={pursuitDateFacts(pursuit, nowMs)} />
                        </p>
                        {/* Honest about a dead listing (spec §7): the snapshot carries the
                            JD, so tailor/prep still work even after the live posting expires
                            out of Meilisearch — but say so plainly rather than pretending
                            nothing happened. */}
                        {!snapshot && pursuit.job_id && (
                            <p className="mt-2 text-xs text-muted-foreground">This listing&apos;s details are no longer available.</p>
                        )}
                    </div>

                    {showInterviewDate && (
                        <InterviewDateField
                            key={`${pursuit.id}:${pursuit.interview_date ?? ""}`}
                            saved={pursuit.interview_date}
                            disabled={saving}
                            onSave={(date) => void saveInterviewDate(date)}
                        />
                    )}

                    <div className="max-w-2xl">
                        <PursuitNoteField key={pursuit.id} initialNote={pursuit.note ?? ""} onSave={saveNote} rows={3} />
                    </div>

                    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-5">
                        {/* A linked listing opens in place (the live posting, or an honest
                            "no longer live"); a hand-tracked role only has its URL. */}
                        {pursuit.job_id ? (
                            <Button variant="outline" onClick={() => void openDetail(pursuit.job_id!)}>
                                View posting
                            </Button>
                        ) : pursuit.job_url ? (
                            <Button variant="outline" onClick={() => gatedOpenPosting(pursuit.job_url!)} className="gap-2">
                                <ArrowSquareOut size={16} />
                                Open posting
                            </Button>
                        ) : null}
                        {!confirmingRemove && (
                            <Button
                                variant="outline"
                                disabled={saving}
                                className="text-muted-foreground hover:text-destructive"
                                onClick={() => setConfirmingRemove(true)}
                            >
                                Remove
                            </Button>
                        )}
                    </div>
                    {confirmingRemove && (
                        <InlineConfirm
                            prompt={`Remove ${pursuit.position} at ${companyName}?`}
                            confirmLabel="Remove"
                            busyLabel="Removing…"
                            busy={removing}
                            onConfirm={() => void remove()}
                            onCancel={() => setConfirmingRemove(false)}
                        />
                    )}
                </section>

                {/* The pay-when-you-land moment (strategy decision 7): only once
                    the pursuit sits in the Offer lane. p-6 matches the cards
                    around it; the sheet keeps the panel's own p-3.5. */}
                <LandedPledgeForPursuit pursuit={pursuit} className="p-6" />

                {/* Tailoring and prep moved to MCP 2026-08-02: the quiet handoff
                    note is the one next step for a saved or interviewing role. */}
                {action.kind === "tailor" && <McpHandoffNote />}
                {action.kind === "prep" && <McpHandoffNote variant="prep" />}

                {resumeVersions.length > 0 && <ResumeUsedCard versions={resumeVersions} pursuit={pursuit} />}

                {descriptionBlocks.length > 0 && (
                    <section
                        aria-labelledby="pursuit-about"
                        className="rounded-panel border border-border bg-surface p-6 shadow-[var(--shadow-bevel-highlight)]"
                    >
                        <h2 id="pursuit-about" className="mb-3 text-xs font-semibold">
                            About this role
                        </h2>
                        <div data-testid="pursuit-description" className="max-w-prose">
                            <JobDescription blocks={descriptionBlocks} headingLevel={3} />
                        </div>
                    </section>
                )}
            </div>

            <Sheet open={detail.open} onOpenChange={(open) => setDetail((d) => ({ ...d, open }))}>
                <SheetContent side="bottom" className="custom-scrollbar rounded-t-panel p-0">
                    <SheetTitle className="sr-only">
                        {pursuit.position} at {companyName}
                    </SheetTitle>
                    {detail.state === "loading" ? (
                        <div className="p-6">
                            <ReceiptShell label="Posting check" status="Checking" statusClassName={STATUS_PILL.saved}>
                                <span className="text-muted-foreground">Loading this posting…</span>
                            </ReceiptShell>
                        </div>
                    ) : detail.job ? (
                        <JobDetail
                            job={detail.job}
                            now={nowMs}
                            /* This sheet only ever opens from the visitor's own
                               tracker (Yours), never a search list/company page/
                               board/email link — "direct" is the closest fit,
                               matching PublicJobDetail's own document-layout
                               default. */
                            source="direct"
                            /* Passing the pursuit is what makes JobDetail render its
                               "In Yours ✓" state instead of a "Go after this job" CTA
                               — you are already here because you went after it. */
                            pursuit={pursuit}
                            onGoAfter={() => {}}
                            onOpenPosting={() => {
                                const href = pursuit.job_url ?? detail.job?.apply_url;
                                if (href) gatedOpenPosting(href);
                            }}
                            descriptionPending={detail.descriptionPending}
                            onRetryDescription={retryDescription}
                        />
                    ) : detail.state === "gone" ? (
                        /* Says what actually happened. The pursuit's own saved
                           snapshot is still on the page behind this sheet, so
                           tailoring still works — but we don't dress a stale
                           snapshot up as the live posting. */
                        <div className="p-6">
                            <ReceiptShell label="Posting check" status="No longer live" statusClassName={STATUS_PILL.closed}>
                                <p className="text-foreground">This posting is no longer live.</p>
                                <p className="mt-1 text-muted-foreground">
                                    It has left our index since you saved it. What you saved is still on this page.
                                </p>
                            </ReceiptShell>
                        </div>
                    ) : (
                        /* "unknown" — we could not check, so we claim nothing
                           about the role either way. Saying "no longer live"
                           here would declare a job dead on the strength of a
                           failed request. */
                        <div className="p-6">
                            <ReceiptShell label="Posting check" status="Unconfirmed" statusClassName={STATUS_PILL.saved}>
                                <p className="text-foreground">We can&apos;t load the live posting right now.</p>
                                <p className="mt-1 text-muted-foreground">
                                    What you saved is still on this page, and the posting may well still be open —
                                    {pursuit.job_url ? " open it at the source to check." : " we just can't confirm it from here."}
                                </p>
                                {pursuit.job_url && (
                                    <button
                                        type="button"
                                        onClick={() => gatedOpenPosting(pursuit.job_url!)}
                                        className="mt-3 text-sm text-live underline underline-offset-2"
                                    >
                                        Open posting
                                    </button>
                                )}
                            </ReceiptShell>
                        </div>
                    )}
                </SheetContent>
            </Sheet>

            {/* Same auth-gate popover jobs/page.tsx and PublicJobDetail.tsx
                mount — "auto" (not "user"): every open here is a side effect
                of a gated Apply click, never a deliberate sign-in click. */}
            <AuthPopover
                open={authOpen}
                onOpenChange={setAuthOpen}
                onAuthed={onAuthed}
                showTrigger={false}
                trigger="user"
                originSurface="tracker"
                valueLine={authGateReason ? formatAuthGateValueLine(authGateReason, listGuestPursuits().length) : undefined}
                defaultTab={authGateReason === "tracker" ? "signup" : "login"}
                reason={authGateReason ?? undefined}
            />
        </PageLayout>
    );
}
