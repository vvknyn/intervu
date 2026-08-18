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
            <div className="mx-auto w-full max-w-6xl xl:max-w-7xl px-4 py-8 sm:px-8 xl:px-10">
                <p className="text-[13px] text-muted-foreground">Loading your tracker…</p>
            </div>
        </PageLayout>
    );
}

import { BookmarkSimple, MagnifyingGlass, Plus, ArrowSquareOut } from "@phosphor-icons/react";

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
        <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center rounded-none border border-border bg-card/75 p-0.5 backdrop-blur-xl">
                {TRACKER_CHIP_FILTERS.map(({ key, label }) => {
                    const n = key === "all" ? total : counts[key];
                    const active = filter === key;
                    return (
                        <button
                            key={key}
                            type="button"
                            aria-pressed={active}
                            onClick={() => onChange(key)}
                            className={cn(
                                "flex items-center gap-1.5 rounded-none px-3 py-1 text-xs font-semibold uppercase tracking-wider transition-colors",
                                active
                                    ? "bg-foreground text-background font-bold"
                                    : "text-muted-foreground hover:text-foreground",
                            )}
                        >
                            <span>{label}</span>
                            <span className={cn("px-1 text-[10px]", active ? "opacity-90" : "opacity-60")}>
                                {n}
                            </span>
                        </button>
                    );
                })}
            </div>

            {appliedThisWeek >= 1 && (
                <span className="inline-flex items-center rounded-none border border-brand/40 bg-brand/10 px-3 py-0.5 text-xs font-bold uppercase tracking-wider text-brand">
                    {appliedThisWeek} applied this week
                </span>
            )}
        </div>
    );
}

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
        <div data-testid={user ? "yours-empty" : "yours-guest-empty"} className="rounded-2xl border border-slate-300/80 bg-card p-8 shadow-xs dark:border-slate-700 text-center space-y-6">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/80 shadow-2xs">
                <BookmarkSimple size={24} weight="duotone" />
            </div>

            <div className="space-y-1 max-w-md mx-auto">
                <h3 className="text-lg font-bold text-foreground tracking-tight">Your Tracker is Empty</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                    Save verified jobs with 1-click while browsing, or log outside applications manually to keep your pipeline organized.
                </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3">
                <Button asChild className="rounded-lg font-semibold bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 shadow-xs">
                    <Link href="/jobs">Browse Verified Roles</Link>
                </Button>
                <Button variant="outline" onClick={onAdd} className="rounded-lg font-semibold shadow-2xs">
                    <Plus size={15} /> Track a Role
                </Button>
            </div>

            {/* Example preview row */}
            <div className="pt-4 border-t border-slate-200/80 dark:border-slate-800 max-w-lg mx-auto text-left">
                <div className="mb-2 flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Preview of a tracked role</span>
                    <span className="rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground dark:border-slate-700 dark:bg-slate-800">
                        EXAMPLE
                    </span>
                </div>
                <div className="grid grid-cols-[1fr_auto] items-center gap-4 rounded-xl border border-slate-200/90 bg-slate-50/70 p-4 opacity-80 dark:border-slate-800 dark:bg-slate-900/40">
                    <div>
                        <div className="text-sm font-bold text-foreground">Staff Product Designer</div>
                        <div className="text-xs text-muted-foreground">Acme Studio · San Francisco, CA</div>
                    </div>
                    <span className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 shadow-2xs">
                        SAVED
                    </span>
                </div>
            </div>

            {!user && (
                <p className="text-xs text-muted-foreground pt-1">
                    <button
                        type="button"
                        onClick={onLoginClick}
                        className="font-semibold text-foreground underline underline-offset-4 hover:text-emerald-600"
                    >
                        Sign in
                    </button>{" "}
                    to sync your tracked roles across devices.
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
            <div className="mx-auto w-full max-w-6xl xl:max-w-7xl px-4 pb-16 pt-6 sm:px-8 xl:px-10">
                <StatusChips
                    filter={filter}
                    counts={counts}
                    total={pursuits.length}
                    appliedThisWeek={appliedThisWeek}
                    onChange={setFilter}
                />

                <div className="relative mb-5">
                    <MagnifyingGlass
                        size={16}
                        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search company or role in your tracker..."
                        className="h-10 pl-9 rounded-xl border-slate-300 bg-card text-base md:text-xs font-medium shadow-2xs dark:border-slate-700"
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
