"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowSquareOut, Buildings, CalendarBlank, Lightning } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { toast } from "@/lib/toast";
import { getCurrentUser } from "@/lib/firebase/client-auth";
import { updateApplication } from "@/actions/application";
import { updateGuestPursuit } from "@/lib/pursuits/guest-store";
import { invalidatePursuitsCache, usePursuits } from "@/lib/pursuits/use-pursuits";
import { nextAction, stageLabel, type Pursuit } from "@/lib/pursuits/types";

/**
 * The pursuit page: one header, ONE next-action block per `nextAction()`
 * (spec §3 "stage choreography" — never three tool offers at once, never a
 * disabled button). Reuses `updateApplication` for signed-in mutations and
 * `updateGuestPursuit` for a guest's local record — same route either way,
 * since `usePursuits()` already serves both from one list.
 */
export default function PursuitDetailPage() {
    const params = useParams<{ id: string }>();
    const id = Array.isArray(params.id) ? params.id[0] : params.id;
    const { pursuits, loading } = usePursuits();
    const [interviewDate, setInterviewDate] = useState("");
    const [saving, setSaving] = useState(false);

    const pursuit = pursuits.find((p) => p.id === id);

    const mutate = async (patch: Partial<Pursuit>) => {
        setSaving(true);
        try {
            if (getCurrentUser()) {
                const res = await updateApplication(id, patch);
                if (res.error) {
                    toast.error(`Could not save: ${res.error}`);
                    return;
                }
                invalidatePursuitsCache();
            } else {
                const updated = updateGuestPursuit(id, patch);
                if (!updated) toast.error("Could not find this pursuit.");
            }
        } finally {
            setSaving(false);
        }
    };

    const backLink = (
        <Link href="/yours" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft size={16} />
            Yours
        </Link>
    );

    if (loading) {
        return (
            <PageLayout header={<PageHeader title="Yours" actions={backLink} />}>
                <div className="h-40 animate-pulse rounded-xl bg-card" />
            </PageLayout>
        );
    }

    if (!pursuit) {
        return (
            <PageLayout header={<PageHeader title="Yours" actions={backLink} />}>
                <div data-testid="pursuit-not-found" className="py-24 text-center text-sm text-muted-foreground">
                    We couldn&apos;t find that pursuit.
                </div>
            </PageLayout>
        );
    }

    const action = nextAction(pursuit);
    const snapshot = pursuit.job_snapshot;

    return (
        <PageLayout header={<PageHeader title={pursuit.company_name} description={pursuit.position} actions={backLink} />}>
            <div className="space-y-6">
                <div className="rounded-xl border border-border bg-card p-6">
                    <div className="flex items-start gap-4">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                            <Buildings size={26} />
                        </div>
                        <div className="min-w-0 flex-1">
                            <h1 className="text-xl font-bold tracking-tight">{pursuit.company_name}</h1>
                            <p className="text-muted-foreground">{pursuit.position}</p>
                            {snapshot?.location && <p className="mt-1 text-xs text-muted-foreground">{snapshot.location}</p>}
                        </div>
                    </div>
                    <div data-testid="pursuit-stage" className="mt-4 text-sm text-muted-foreground">
                        {stageLabel(pursuit)}
                    </div>
                    {/* Honest about a dead listing (spec §7): the snapshot carries the
                        JD, so tailor/prep still work even after the live posting expires
                        out of Meilisearch — but say so plainly rather than pretending
                        nothing happened. */}
                    {!snapshot && pursuit.job_id && (
                        <p className="mt-2 text-xs text-muted-foreground">This listing&apos;s details are no longer available.</p>
                    )}
                </div>

                <div className="rounded-xl border border-border bg-card p-6">
                    {action.kind === "tailor" && (
                        <Button asChild className="gap-2">
                            <Link
                                href={`/resume-tailor?company=${encodeURIComponent(pursuit.company_name)}&position=${encodeURIComponent(pursuit.position)}`}
                            >
                                {action.label}
                            </Link>
                        </Button>
                    )}

                    {action.kind === "apply" && (
                        <div className="flex flex-wrap gap-2">
                            {pursuit.job_url && (
                                <Button
                                    variant="outline"
                                    onClick={() => window.open(pursuit.job_url, "_blank", "noopener,noreferrer")}
                                    className="gap-2"
                                >
                                    <ArrowSquareOut size={16} />
                                    Open posting
                                </Button>
                            )}
                            <Button disabled={saving} onClick={() => mutate({ status: "applied", applied_at: new Date().toISOString() })}>
                                {saving ? "Saving…" : "I applied"}
                            </Button>
                        </div>
                    )}

                    {action.kind === "set_interview" && (
                        <div className="flex flex-wrap items-center gap-2">
                            <Input
                                type="date"
                                value={interviewDate}
                                onChange={(e) => setInterviewDate(e.target.value)}
                                className="w-auto"
                                aria-label="Interview date"
                            />
                            <Button
                                disabled={saving || !interviewDate}
                                onClick={() =>
                                    mutate({ status: "interviewing", interview_date: new Date(interviewDate).toISOString() })
                                }
                                className="gap-2"
                            >
                                <CalendarBlank size={16} />
                                {saving ? "Saving…" : "Set interview date"}
                            </Button>
                        </div>
                    )}

                    {action.kind === "prep" && (
                        <Button asChild className="gap-2">
                            <Link
                                href={`/prep?company=${encodeURIComponent(pursuit.company_name)}&position=${encodeURIComponent(pursuit.position)}&searched=true`}
                            >
                                <Lightning size={16} weight="fill" />
                                {action.label}
                            </Link>
                        </Button>
                    )}

                    {action.kind === "closed" && <p className="text-sm text-muted-foreground">{action.label}</p>}
                </div>

                {snapshot?.description && (
                    <div className="rounded-xl border border-border bg-card p-6">
                        <div className="mb-2 text-[13px] font-semibold">About this role</div>
                        <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-muted-foreground">
                            {snapshot.description}
                        </p>
                    </div>
                )}
            </div>
        </PageLayout>
    );
}
