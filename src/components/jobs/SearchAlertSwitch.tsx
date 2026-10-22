"use client";

import { useEffect, useId, useState } from "react";
import { Switch } from "@/components/settings/Switch";
import { deleteSavedSearchAction, saveSavedSearchAction } from "@/actions/saved-searches";
import { invalidateSavedSearchesCache } from "@/lib/jobs/use-saved-searches";
import { captureEvent } from "@/lib/analytics/events";
import { noteSetupFacts } from "@/hooks/use-onboarding";
import {
    hrefFromJobsUrlState,
    jobsUrlStateFromSavedHref,
    suggestSavedSearchName,
    type SavedSearch,
} from "@/lib/jobs/saved-searches";
import type { JobsUrlState } from "@/lib/jobs/url-state";
import { cn } from "@/lib/utils";

/** The saved search that IS this search, whichever href shape it was stored in. */
export function savedSearchFor(saved: readonly SavedSearch[], urlState: JobsUrlState): SavedSearch | undefined {
    const href = hrefFromJobsUrlState(urlState);
    return saved.find((s) => hrefFromJobsUrlState(jobsUrlStateFromSavedHref(s.href)) === href);
}

/**
 * The "Job alert" switch for the search on screen, as one switch on the results
 * line (Vivek, 2026-10-10, after Autodesk's careers search: a quiet control
 * in place of three sentences). It replaced the toolbar's "Get alerts", the
 * visit line's "Email me new roles" and the results line's "Get new matches
 * by email", which all opened the same form.
 *
 * Signed in, the switch IS the saved search: on saves it (saved searches feed
 * the weekly digest), off deletes it. No naming step; the name is the query,
 * the same default the toolbar's Save search offers. Signed out it opens the
 * email form under the line (no account needed), and stays on for this search
 * once that form has sent.
 */
export function SearchAlertSwitch({
    signedIn,
    saved,
    urlState,
    guestOn,
    guestRequested,
    onGuestChange,
    onSignedInOn,
    className,
}: {
    signedIn: boolean;
    /** The account's saved searches (signed in). */
    saved: readonly SavedSearch[];
    urlState: JobsUrlState;
    /** Signed out: the email form under the line is open. */
    guestOn: boolean;
    /** Signed out: this browser already asked for alerts on this search. */
    guestRequested: boolean;
    onGuestChange(open: boolean): void;
    /** Signed in: alerts just turned on (the page asks for a reachable email if the account lacks one). */
    onSignedInOn?: () => void;
    className?: string;
}) {
    const id = useId();
    // The row this switch just saved, so turning it straight back off deletes
    // it before the refreshed list has arrived.
    const [justSaved, setJustSaved] = useState<SavedSearch | null>(null);
    const match = signedIn ? (savedSearchFor(saved, urlState) ?? (justSaved ? savedSearchFor([justSaved], urlState) : undefined)) : undefined;
    // While a save or delete is in flight, and until the refreshed list agrees with it.
    const [pending, setPending] = useState<boolean | null>(null);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<{ tone: "error" | "info"; text: string } | null>(null);

    useEffect(() => {
        if (pending !== null && !busy && Boolean(match) === pending) setPending(null);
    }, [match, pending, busy]);

    const on = signedIn ? (pending ?? Boolean(match)) : guestOn || guestRequested;

    const toggle = async () => {
        if (busy) return;
        const next = !on;
        setNote(null);
        captureEvent("search_alert_switch_toggled", { on: next, signed_in: signedIn });

        if (!signedIn) {
            if (guestRequested && !next) {
                // The alert lives under their email address, not this browser.
                setNote({ tone: "info", text: "To stop these emails, use Unsubscribe in any alert email." });
                return;
            }
            onGuestChange(next);
            return;
        }

        setPending(next);
        setBusy(true);
        try {
            const res: { data?: SavedSearch; error?: string } = next
                ? await saveSavedSearchAction({ name: suggestSavedSearchName(urlState), href: hrefFromJobsUrlState(urlState) })
                : match
                  ? await deleteSavedSearchAction(match.id)
                  : {};
            if (res.error) {
                setPending(null);
                setNote({ tone: "error", text: next ? "Couldn't turn alerts on. Try again." : "Couldn't turn alerts off. Try again." });
                return;
            }
            setJustSaved(next ? (res.data ?? null) : null);
            invalidateSavedSearchesCache();
            if (next) {
                captureEvent("saved_search_created", { surface: "alert_switch", signed_in: true });
                // A saved search is what setup's weekly-email step asks for.
                noteSetupFacts({ savedSearches: 1 });
                onSignedInOn?.();
            }
        } catch {
            setPending(null);
            setNote({ tone: "error", text: "Couldn't reach Velai. Try again." });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div data-testid="search-alert-switch" className={cn("flex flex-col items-start gap-1", className)}>
            <div className="flex items-center gap-2">
                <Switch
                    id={id}
                    checked={on}
                    onChange={() => void toggle()}
                    disabled={busy}
                    aria-label="Job alert for this search"
                />
                <label htmlFor={id} className="cursor-pointer whitespace-nowrap text-sm text-foreground">
                    Job alert
                </label>
            </div>
            {note && (
                <p
                    data-testid="search-alert-switch-note"
                    role={note.tone === "error" ? "alert" : "status"}
                    className={cn("text-xs", note.tone === "error" ? "text-destructive" : "text-muted-foreground")}
                >
                    {note.text}
                </p>
            )}
        </div>
    );
}
