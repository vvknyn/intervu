"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthPopover } from "@/components/auth/auth-popover";
import { getCurrentUser, onAuthChange, type User } from "@/lib/firebase/client-auth";
import { createApplication, deleteApplication, updateApplication } from "@/actions/application";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { usePursuits, syncGuestPursuitsToServer, invalidatePursuitsCache } from "@/lib/pursuits/use-pursuits";
import { listGuestPursuits } from "@/lib/pursuits/guest-store";
import { syncGuestFollowsToServer } from "@/lib/follows/use-follows";
import { syncGuestSavedSearchesToServer } from "@/lib/jobs/use-saved-searches";
import { addManualGuestPursuit, removeGuestPursuit, updateGuestPursuit } from "@/lib/pursuits/guest-store";
import { orderPursuits, type Pursuit, type PursuitStage } from "@/lib/pursuits/types";
import {
    TRACKER_CHIP_FILTERS,
    countAppliedSince,
    countByTrackerFilter,
    matchesTrackerFilter,
    matchesTrackerSearch,
    type TrackerFilter,
} from "@/lib/pursuits/tracker-display";
import { PursuitListRow } from "@/components/tracker/PursuitListRow";
import { TrackRoleSheet, type TrackRoleDraft } from "@/components/tracker/TrackRoleSheet";
import { PursuitDetailSheet } from "@/components/tracker/PursuitDetailSheet";
import { downloadTrackerExport } from "@/lib/pursuits/export-tracker";

const TRACKER_SUBCOPY = "Your records — not submissions. Agent drafts still stop before send.";

function TrackerHeader({ actions }: { actions?: React.ReactNode }) {
    return (
        <PageHeader size="display" fullWidth sticky={false} title="Tracker" description={TRACKER_SUBCOPY} actions={actions} />
    );
}

function YoursLoading() {
    return (
        <PageLayout fullWidth header={<TrackerHeader />}>
            <div className="mx-auto w-full max-w-[920px] px-5 py-8 sm:px-7">
                <p className="font-mono text-[13px] text-muted-foreground">Loading your tracker…</p>
            </div>
        </PageLayout>
    );
}

function StatusChips({
    filter,
    counts,
    total,
    appliedThisWeek,
    onChange,
}: {
    filter: TrackerFilter;
    counts: ReturnType<typeof countByTrackerFilter>;
    total: number;
    appliedThisWeek: number;
    onChange: (f: TrackerFilter) => void;
}) {
    return (
        <div className="mb-3.5 flex flex-wrap items-center gap-2">
            {TRACKER_CHIP_FILTERS.map(({ key, label }) => {
                const n = key === "all" ? total : counts[key];
                return (
                    <button
                        key={key}
                        type="button"
                        aria-pressed={filter === key}
                        onClick={() => onChange(key)}
                        className={cn(
                            "rounded-full border border-border bg-card px-3 py-1.5 font-mono text-xs text-muted-foreground transition-colors",
                            filter === key && "border-foreground bg-foreground text-background",
                        )}
                    >
                        {label} <span className="opacity-70">{n}</span>
                    </button>
                );
            })}
            {/* Self-Monitoring fact chip (spec B3) — honest praise: rendered
                ONLY when there's something to show, never a "0 applied" guilt
                line. Not a filter — no aria-pressed/onClick. */}
            {appliedThisWeek >= 1 && (
                <span className="rounded-full border border-border bg-card px-3 py-1.5 font-mono text-xs text-muted-foreground">
                    {appliedThisWeek} applied this week
                </span>
            )}
        </div>
    );
}

/** Blank Slate (spec B4) — the guest and signed-in zero-pursuit states used
 *  to be near-identical copy that taught nothing (ground truth: yours/page
 *  .tsx ~274-304 pre-fix). This teaches by example instead: one static,
 *  clearly-fake illustrative row (never a real-looking company name) plus
 *  the one real instruction for how a pursuit actually lands here. Keeps
 *  the `data-testid`s the guest/signed-in e2e specs (tests/e2e/yours.spec
 *  .ts TC-YOURS-002) assert on. "Track a role" stays alongside the new
 *  "Browse jobs" CTA — it's still the only path for logging an outside
 *  interview that never went through the board. */
function TrackerEmptyState({
    user,
    onAdd,
    onLoginClick,
}: {
    user: boolean;
    onAdd: () => void;
    onLoginClick: () => void;
}) {
    return (
        <div data-testid={user ? "yours-empty" : "yours-guest-empty"} className="px-2 py-9">
            <div className="mb-4 grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 rounded-none border border-dashed border-border bg-muted/40 p-4 opacity-70">
                <div className="min-w-0">
                    <div className="truncate text-[15px] font-semibold tracking-[-0.02em] text-muted-foreground">
                        Product Designer — Acme Studio
                    </div>
                    <div className="truncate font-mono text-[11px] text-[#8b939e]">not your data</div>
                </div>
                <span className="inline-flex h-fit items-center rounded-none border border-border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
                    example
                </span>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
                Open a role on the board and hit &quot;Mark applied&quot; — it lands here.
            </p>
            <div className="flex flex-wrap items-center gap-2">
                <Button asChild size="sm">
                    <Link href="/jobs">Browse jobs</Link>
                </Button>
                <Button variant="outline" size="sm" onClick={onAdd}>
                    Track a role
                </Button>
            </div>
            {!user && (
                <p className="mt-3 text-[13px] text-muted-foreground">
                    <button
                        type="button"
                        onClick={onLoginClick}
                        className="underline underline-offset-2 hover:text-foreground"
                    >
                        Log in
                    </button>{" "}
                    to sync across devices.
                </p>
            )}
        </div>
    );
}

function YoursContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [user, setUser] = useState<User | null>(null);
    const [authPopoverOpen, setAuthPopoverOpen] = useState(false);
    const [addOpen, setAddOpen] = useState(searchParams.get("view") === "new");
    const [filter, setFilter] = useState<TrackerFilter>("all");
    const [search, setSearch] = useState("");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const { pursuits, loading } = usePursuits();
    const guestSyncRef = useRef(false);
    const guestSyncInFlightRef = useRef(false);

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
        return orderPursuits(pursuits).filter(
            (p) => matchesTrackerFilter(p, filter) && matchesTrackerSearch(p, search),
        );
    }, [pursuits, filter, search]);

    const selected = pursuits.find((p) => p.id === selectedId) ?? null;
    const counts = useMemo(() => countByTrackerFilter(pursuits), [pursuits]);
    const appliedThisWeek = useMemo(() => countAppliedSince(pursuits, Date.now() - 7 * 86_400_000), [pursuits]);

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
                    return;
                }
                invalidatePursuitsCache();
            } else {
                removeGuestPursuit(id);
            }
            setDetailOpen(false);
            setSelectedId(null);
            toast.success("Removed");
        } finally {
            setSaving(false);
        }
    };

    const openDetail = (id: string) => {
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
                                    data-testid="tracker-export-csv"
                                    onClick={() => downloadTrackerExport(pursuits, "csv")}
                                >
                                    Export CSV
                                </Button>
                            )}
                            <Button size="sm" onClick={openAdd}>
                                Track a role
                            </Button>
                        </div>
                    }
                />
            }
        >
            <div className="mx-auto w-full max-w-[920px] px-5 pb-16 pt-6 sm:px-7">
                <StatusChips
                    filter={filter}
                    counts={counts}
                    total={pursuits.length}
                    appliedThisWeek={appliedThisWeek}
                    onChange={setFilter}
                />

                <div className="mb-3.5">
                    <Input
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search company or role"
                        className="rounded-[10px] border-border bg-card"
                    />
                </div>

                {filtered.length === 0 ? (
                    pursuits.length === 0 ? (
                        <TrackerEmptyState
                            user={!!user}
                            onAdd={openAdd}
                            onLoginClick={() => setAuthPopoverOpen(true)}
                        />
                    ) : (
                        <div className="px-2 py-9 text-sm text-muted-foreground">
                            Nothing in this lane.{" "}
                            <Button variant="outline" size="sm" className="ml-1.5 h-8" onClick={openAdd}>
                                Track a role
                            </Button>
                        </div>
                    )
                ) : (
                    <div className="flex flex-col gap-2">
                        {filtered.map((p) => (
                            <PursuitListRow
                                key={p.id}
                                pursuit={p}
                                active={selectedId === p.id && detailOpen}
                                onClick={() => openDetail(p.id)}
                            />
                        ))}
                    </div>
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
                    const ok = await mutate(selected.id, patch);
                    if (ok) toast.success(`Marked ${status === "interested" ? "saved" : status}`);
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
                    await handleRemove(selected.id);
                }}
            />

            <AuthPopover open={authPopoverOpen} onOpenChange={setAuthPopoverOpen} showTrigger={false} />
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
