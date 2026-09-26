"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMediaQuery } from "@/hooks/use-media-query";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthPopover } from "@/components/auth/auth-popover";
import { getCurrentUser, onAuthChange, type User } from "@/lib/firebase/client-auth";
import { createApplication, deleteApplication, updateApplication } from "@/actions/application";
import { captureEvent } from "@/lib/analytics/events";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { usePursuits, syncGuestPursuitsToServer, invalidatePursuitsCache } from "@/lib/pursuits/use-pursuits";
import { addManualGuestPursuit, listGuestPursuits, removeGuestPursuit, updateGuestPursuit } from "@/lib/pursuits/guest-store";
import { syncGuestFollowsToServer } from "@/lib/follows/use-follows";
import { syncGuestSavedSearchesToServer } from "@/lib/jobs/use-saved-searches";
import { orderPursuits, type Pursuit, type PursuitStage } from "@/lib/pursuits/types";
import { countAppliedSince, matchesTrackerSearch } from "@/lib/pursuits/tracker-display";
import {
    DEFAULT_DAILY_APPLY_GOAL,
    countAppliedToday,
} from "@/lib/pursuits/daily-apply-plan";
import { TrackerKanbanBoard } from "@/components/tracker/TrackerKanbanBoard";
import { TrackRoleSheet, type TrackRoleDraft } from "@/components/tracker/TrackRoleSheet";
import { PursuitDetailSheet } from "@/components/tracker/PursuitDetailSheet";
import { downloadTrackerExport } from "@/lib/pursuits/export-tracker";
import { AUTH_CTA_LABEL, formatAuthGateValueLine, guestKeepLine } from "@/lib/auth/auth-gate-copy";
import { TrackerTabs } from "@/components/tracker/TrackerTabs";
import { posterInlinePanelClassName } from "@/components/layout/route-loading";
import { EmptyState } from "@/components/ui/empty-state";

const TRACKER_SUBCOPY = "Your records — not submissions. Agent drafts still stop before they're sent.";

function TrackerHeader({ actions }: { actions?: React.ReactNode }) {
    return (
        <PageHeader fullWidth sticky={false} size="display" title="Tracker" description={TRACKER_SUBCOPY} actions={actions} />
    );
}

function YoursLoading() {
    return (
        <PageLayout fullWidth header={<TrackerHeader />}>
            <div className="mx-auto w-full max-w-6xl xl:max-w-7xl px-4 py-8 sm:px-8 xl:px-10">
                <div className={cn(posterInlinePanelClassName, "p-6")} role="status" aria-busy="true">
                    <div aria-hidden className="space-y-4">
                        <div className="skeleton-bar h-9 w-full max-w-md" />
                        <div className="flex gap-3 overflow-hidden">
                            {[0, 1, 2, 3, 4].map((i) => (
                                <div key={i} className="skeleton-bar h-64 w-5/6 max-w-80 shrink-0 md:w-full" />
                            ))}
                        </div>
                    </div>
                    <span className="sr-only">Loading your tracker…</span>
                </div>
            </div>
        </PageLayout>
    );
}

import { BookmarkSimple, MagnifyingGlass } from "@phosphor-icons/react";

/** Applied-this-week + soft daily plan (Today X/12) — quiet Tracker chrome. */
function AppliedThisWeekBadge({
    count,
    appliedToday,
    dailyGoal = DEFAULT_DAILY_APPLY_GOAL,
}: {
    count: number;
    appliedToday: number;
    dailyGoal?: number;
}) {
    if (count < 1 && appliedToday < 1) return null;
    return (
        <span className="text-xs font-semibold text-live" data-testid="yours-apply-pace">
            {appliedToday > 0 || count > 0 ? (
                <>
                    Today {appliedToday}/{dailyGoal}
                    {count > 0 ? <> · {count} this week</> : null}
                </>
            ) : null}
        </span>
    );
}

function TrackerEmptyState({
    user,
    onLoginClick,
}: {
    user: boolean;
    onLoginClick: () => void;
}) {
    const guestCount = listGuestPursuits().length;
    return (
        <EmptyState
            testId={user ? "yours-empty" : "yours-guest-empty"}
            title="Your tracker is empty."
            description="Save roles while browsing verified jobs, then pick up where you left off here."
            actions={
                <Button asChild variant="outline" size="sm" className="rounded-ctl font-semibold">
                    <Link href="/jobs">Browse verified roles</Link>
                </Button>
            }
            footer={
                !user ? (
                    <p className="text-xs text-muted-foreground">
                        {guestCount > 0 && <>{guestKeepLine(guestCount)} </>}
                        <button
                            type="button"
                            onClick={onLoginClick}
                            className="font-semibold text-live underline-offset-4 hover:underline"
                        >
                            {AUTH_CTA_LABEL}
                        </button>{" "}
                        to sync across devices.
                    </p>
                ) : undefined
            }
        />
    );
}

function YoursContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [user, setUser] = useState<User | null>(null);
    const [authPopoverOpen, setAuthPopoverOpen] = useState(false);
    const [addOpen, setAddOpen] = useState(searchParams.get("view") === "new");
    const [search, setSearch] = useState("");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const { pursuits, loading } = usePursuits();
    const guestSyncRef = useRef(false);
    const guestSyncInFlightRef = useRef(false);
    // G5e (Grok UX wave) — same xl (1280px) mount-site split the job board's
    // own detail panel uses (jobs/page.tsx's isXlUp/resolveDetailMountSite):
    // below xl a row click opens the sheet, at xl+ it navigates to the
    // pursuit's own full page instead — one mount site per viewport class,
    // never both mixed for the same click. Deep-linking /yours/[id] directly
    // always lands on the full page regardless of viewport (unchanged).
    const isXlUp = useMediaQuery("(min-width: 1280px)");

    // URL is source of truth for the add sheet — Soft Nav / Suspense remounts
    // can re-init local state from a stale `?view=new` if we only setState.
    useEffect(() => {
        setAddOpen(searchParams.get("view") === "new");
    }, [searchParams]);

    useEffect(() => {
        const current = getCurrentUser();
        if (current) setUser(current);
        const unsub = onAuthChange((u) => setUser(u));
        return () => unsub();
    }, []);

    useEffect(() => {
        if (user && !guestSyncRef.current && !guestSyncInFlightRef.current) {
            guestSyncInFlightRef.current = true;
            const guestPursuitCount = listGuestPursuits().length;
            void (async () => {
                try {
                    const [pursuitsOk, followsOk, savedSearchesOk] = await Promise.all([
                        syncGuestPursuitsToServer(),
                        syncGuestFollowsToServer(),
                        syncGuestSavedSearchesToServer(),
                    ]);
                    if (pursuitsOk && followsOk && savedSearchesOk) {
                        guestSyncRef.current = true;
                        if (guestPursuitCount > 0) {
                            toast.success(
                                `Synced ${guestPursuitCount} guest role${guestPursuitCount === 1 ? "" : "s"}`,
                            );
                        }
                    }
                } finally {
                    guestSyncInFlightRef.current = false;
                }
            })();
        }
    }, [user]);

    const openAdd = () => {
        setAddOpen(true);
        router.replace("/yours?view=new", { scroll: false });
    };
    const closeAdd = () => {
        setAddOpen(false);
        router.replace("/yours", { scroll: false });
    };

    const filtered = useMemo(() => {
        return orderPursuits(pursuits).filter((p) => matchesTrackerSearch(p, search));
    }, [pursuits, search]);

    const selected = pursuits.find((p) => p.id === selectedId) ?? null;
    const appliedThisWeek = useMemo(() => countAppliedSince(pursuits, Date.now() - 7 * 86_400_000), [pursuits]);
    const appliedToday = useMemo(() => countAppliedToday(pursuits), [pursuits]);

    const mutate = async (id: string, patch: Partial<Pursuit>) => {
        setSaving(true);
        try {
            if (getCurrentUser()) {
                const res = await updateApplication(id, patch);
                if (res.error) {
                    toast.error(`Could not save: ${res.error}`);
                    return false;
                }
                invalidatePursuitsCache();
            } else {
                const updated = updateGuestPursuit(id, patch);
                if (!updated) {
                    toast.error("Could not find this pursuit.");
                    return false;
                }
            }
            return true;
        } finally {
            setSaving(false);
        }
    };

    const handleTrackRole = async (draft: TrackRoleDraft) => {
        setSaving(true);
        try {
            if (getCurrentUser()) {
                const result = await createApplication({
                    company_name: draft.company,
                    position: draft.position,
                    job_url: draft.job_url || undefined,
                    status: draft.status,
                    note: draft.note || undefined,
                    applied_at: draft.status === "applied" ? new Date().toISOString() : undefined,
                });
                if (result.error) throw new Error(result.error);
                invalidatePursuitsCache();
            } else {
                addManualGuestPursuit(draft.company, draft.position, {
                    status: draft.status,
                    job_url: draft.job_url || undefined,
                    note: draft.note || undefined,
                });
            }
            closeAdd();
            toast.success("Tracked");
        } catch (e) {
            toast.error(`Failed to save: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setSaving(false);
        }
    };

    const handleRemove = async (id: string) => {
        setSaving(true);
        try {
            if (getCurrentUser()) {
                const res = await deleteApplication(id);
                if (res.error) {
                    toast.error(res.error);
                    return false;
                }
                invalidatePursuitsCache();
            } else {
                removeGuestPursuit(id);
            }
            setDetailOpen(false);
            setSelectedId(null);
            toast.success("Removed");
            return true;
        } finally {
            setSaving(false);
        }
    };

    const openDetail = (id: string) => {
        if (isXlUp) {
            router.push(`/yours/${id}`);
            return;
        }
        setSelectedId(id);
        setDetailOpen(true);
    };

    if (loading) return <YoursLoading />;

    return (
        <PageLayout
            fullWidth
            header={
                <TrackerHeader
                    actions={
                        <div className="flex flex-wrap items-center gap-2">
                            {pursuits.length > 0 && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="rounded-ctl"
                                    data-testid="tracker-export-csv"
                                    onClick={() => downloadTrackerExport(pursuits, "csv")}
                                >
                                    Export CSV
                                </Button>
                            )}
                            <Button size="sm" className="rounded-ctl" onClick={openAdd}>
                                Track a role
                            </Button>
                        </div>
                    }
                />
            }
        >
            <div className="mx-auto w-full max-w-6xl xl:max-w-7xl px-4 pb-16 pt-6 sm:px-8 xl:px-10">
                <TrackerTabs active="tracker" />
                <div className="mb-4 mt-4 flex flex-wrap items-center gap-3">
                    <div className="relative min-w-0 flex-1">
                        <MagnifyingGlass
                            size={16}
                            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                        />
                        <Input
                            type="search"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search tracker…"
                            className="h-11 rounded-ctl border-border bg-surface-2 pl-9 text-base shadow-[var(--shadow-bevel-inset)]"
                        />
                    </div>
                    <AppliedThisWeekBadge count={appliedThisWeek} appliedToday={appliedToday} />
                </div>

                {filtered.length === 0 ? (
                    pursuits.length === 0 ? (
                        <TrackerEmptyState
                            user={!!user}
                            onLoginClick={() => setAuthPopoverOpen(true)}
                        />
                    ) : (
                        <div className="py-8 text-left text-sm text-muted-foreground">
                            Nothing in this lane.{" "}
                            <Button variant="outline" size="sm" className="ml-1.5 rounded-ctl" onClick={openAdd}>
                                Track a role
                            </Button>
                        </div>
                    )
                ) : (
                    <TrackerKanbanBoard
                        pursuits={filtered}
                        selectedId={selectedId}
                        detailOpen={detailOpen}
                        onRowClick={openDetail}
                    />
                )}
            </div>

            <TrackRoleSheet open={addOpen} onOpenChange={(open) => (open ? openAdd() : closeAdd())} onSave={handleTrackRole} saving={saving} />

            <PursuitDetailSheet
                pursuit={selected}
                open={detailOpen && !!selected}
                onOpenChange={(open) => {
                    setDetailOpen(open);
                    if (!open) setSelectedId(null);
                }}
                saving={saving}
                onStatusChange={async (status: PursuitStage) => {
                    if (!selected) return;
                    const patch: Partial<Pursuit> = { status };
                    if (status === "applied" && !selected.applied_at) {
                        patch.applied_at = new Date().toISOString();
                    }
                    const fromStage = selected.status;
                    const jobId = selected.job_id;
                    const ok = await mutate(selected.id, patch);
                    if (ok) {
                        toast.success(`Marked ${status === "interested" ? "saved" : status}`);
                        // job_id is null for a manually-tracked "outside interviews"
                        // pursuit with no corpus listing — nothing to key the event on.
                        if (jobId) {
                            captureEvent("application_stage_changed", {
                                job_id: jobId,
                                from_stage: fromStage,
                                to_stage: status,
                            });
                        }
                    }
                }}
                onNoteSave={async (note) => {
                    if (!selected) return;
                    const ok = await mutate(selected.id, { note });
                    if (ok) toast.success("Note saved");
                }}
                onInterviewDateSave={async (date) => {
                    if (!selected) return;
                    const ok = await mutate(selected.id, {
                        status: "interviewing",
                        interview_date: new Date(date).toISOString(),
                    });
                    if (ok) toast.success("Interview date saved");
                }}
                onRemove={async () => {
                    if (!selected) return;
                    const jobId = selected.job_id;
                    const removed = await handleRemove(selected.id);
                    if (removed && jobId) captureEvent("job_unsaved", { job_id: jobId });
                }}
            />

            <AuthPopover
                open={authPopoverOpen}
                onOpenChange={setAuthPopoverOpen}
                showTrigger={false}
                trigger="user"
                valueLine={
                    !user
                        ? formatAuthGateValueLine("generic", listGuestPursuits().length)
                        : undefined
                }
            />
        </PageLayout>
    );
}

export default function YoursPage() {
    return (
        <Suspense fallback={<YoursLoading />}>
            <YoursContent />
        </Suspense>
    );
}
