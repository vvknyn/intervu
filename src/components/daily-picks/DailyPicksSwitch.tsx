"use client";

/**
 * The daily picks email switch (lib/daily-picks): a row in Settings › Account
 * under the weekly digest, and a quiet line on Today. Both read and write
 * through the same actions (actions/daily-picks.ts), so they never disagree.
 * It is off until the person turns it on.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getDailyPicksAction, setDailyPicksAction, type DailyPicksView } from "@/actions/daily-picks";
import { Switch } from "@/components/ui/switch";
import { captureEvent } from "@/lib/analytics/events";
import { LOCKED_RESUME_NOTE } from "@/lib/resume/locked-copy";
import { PRICING_HREF } from "@/lib/resume/payment-required";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

export type DailyPicksSurface = "settings" | "today";

export interface DailyPicksControl {
    /** `null` until read, or when the read failed (`failed`). */
    view: DailyPicksView | null;
    failed: boolean;
    saving: boolean;
    setOn: (on: boolean) => void;
    retry: () => void;
}

/** The signed-in account's daily picks state, read once `enabled`, and the switch's write. */
export function useDailyPicks(enabled: boolean, accountKey: string | null, surface: DailyPicksSurface): DailyPicksControl {
    const [view, setView] = useState<DailyPicksView | null>(null);
    const [failed, setFailed] = useState(false);
    const [saving, setSaving] = useState(false);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        void getDailyPicksAction()
            .then((res) => {
                if (cancelled) return;
                if (res.data) {
                    setView(res.data);
                    setFailed(false);
                } else setFailed(true);
            })
            .catch(() => {
                if (!cancelled) setFailed(true);
            });
        return () => {
            cancelled = true;
        };
    }, [enabled, accountKey, attempt]);

    const setOn = useCallback(
        (on: boolean) => {
            if (!view || saving) return;
            const before = view;
            setSaving(true);
            setView({ ...view, on });
            void setDailyPicksAction(on)
                .then((result) => {
                    if ("error" in result) {
                        setView(before);
                        toast.error(result.error);
                        return;
                    }
                    captureEvent("daily_picks_set", { on, surface });
                    // Read again: turning it on also says whether the saved résumé can be ranked.
                    setAttempt((n) => n + 1);
                })
                .catch(() => {
                    setView(before);
                    toast.error("Couldn't change daily picks. Try again.");
                })
                .finally(() => setSaving(false));
        },
        [view, saving, surface],
    );

    return { view, failed, saving, setOn, retry: () => setAttempt((n) => n + 1) };
}

/** What the email is, said once beside the switch. */
export const DAILY_PICKS_DESCRIPTION = "Up to 5 new roles a day that fit your résumé and level, each with why. No email on days with none. Needs a paid month.";

/** While it's on but the saved résumé can't be ranked: nothing goes out until it can. */
function ResumeNotReady({ className, locked }: { className?: string; locked?: boolean }) {
    if (locked) {
        return (
            <p className={cn("text-xs text-foreground", className)} data-testid="daily-picks-resume-not-ready">
                {LOCKED_RESUME_NOTE}{" "}
                <Link href={PRICING_HREF} className="underline underline-offset-2">
                    See pricing
                </Link>
            </p>
        );
    }
    return (
        <p className={cn("text-xs text-foreground", className)} data-testid="daily-picks-resume-not-ready">
            None can go out yet: we can&apos;t read a role or skills from the résumé saved on your account.{" "}
            <Link href="/jobs" className="underline underline-offset-2">
                Upload it on Jobs
            </Link>
            .
        </p>
    );
}

/** Settings › Account: a row under the weekly digest. */
export function DailyPicksSettingsRow({ control }: { control: DailyPicksControl }) {
    const { view, failed, saving, setOn, retry } = control;
    if (failed && !view) {
        return (
            <p className="text-xs text-muted-foreground" data-testid="daily-picks-load-failed">
                Couldn&apos;t load daily picks.{" "}
                <button type="button" onClick={retry} className="text-foreground underline underline-offset-2">
                    Try again
                </button>
            </p>
        );
    }
    if (!view) return null;
    return (
        <div data-testid="daily-picks-setting">
            <div className="flex items-center justify-between gap-4">
                <div>
                    <label htmlFor="daily-picks-switch" className="text-sm">
                        Daily picks
                    </label>
                    <p className="text-xs text-muted-foreground">
                        {DAILY_PICKS_DESCRIPTION}
                        {view.blockedGlobally && " Blocked — you've unsubscribed from all Velai emails."}
                    </p>
                </div>
                <Switch
                    id="daily-picks-switch"
                    checked={view.on}
                    onChange={() => setOn(!view.on)}
                    disabled={saving || !view.reachable}
                    aria-label="Daily picks"
                />
            </div>
            {view.on && view.resumeReady === false ? <ResumeNotReady className="mt-2" locked={view.resumeLocked} /> : null}
        </div>
    );
}

/** Today: one quiet line under the summary, only for an account mail can reach. */
export function DailyPicksTodayLine({ control }: { control: DailyPicksControl }) {
    const { view, saving, setOn } = control;
    if (!view || !view.reachable || view.blockedGlobally) return null;
    return (
        <div data-testid="today-daily-picks">
            <div className="flex items-center gap-3">
                <Switch
                    id="today-daily-picks-switch"
                    checked={view.on}
                    onChange={() => setOn(!view.on)}
                    disabled={saving}
                    aria-label="Email me new picks each day"
                />
                <label htmlFor="today-daily-picks-switch" className="text-sm text-muted-foreground">
                    Email me new picks each day
                </label>
            </div>
            {view.on && view.resumeReady === false ? <ResumeNotReady className="mt-1" locked={view.resumeLocked} /> : null}
        </div>
    );
}
