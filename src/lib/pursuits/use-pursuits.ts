"use client";

/**
 * The one shared pursuits read-path — the root page, /yours, and TopBar all
 * consume this instead of each fetching independently. Fixes the old
 * `appliedIds` bug at its root (root page.tsx, pre-PR2): that was
 * session-only React state, so a reload forgot which jobs were tracked. This
 * fetches the signed-in user's pursuits ONCE (module-level cache, shared
 * across every mounted consumer) and every consumer derives whatever view it
 * needs from the same list; a signed-out user reads localStorage instead.
 *
 * `invalidatePursuitsCache` is the one write-side hook — every mutation
 * (go-after, mark-applied, a stage change on /yours/[id]) calls it so every
 * mounted consumer re-fetches on its next render.
 */

import { useEffect, useState } from "react";
import { afterPursuitsReadHold } from "@/lib/pursuits/read-hold";
import { createServerListCache } from "@/lib/server-list-cache";
import { getApplications, upsertPursuitForJob, createManualPursuit } from "@/actions/application";
import { keepGuestAppliedResumeAction } from "@/actions/applications";
import type { Pursuit } from "@/lib/pursuits/types";
import { isAccountPaid } from "@/lib/account/paid-status";
import { isPaymentRequired } from "@/lib/resume/payment-required";
import { getCurrentUser, onAuthChange } from "@/lib/firebase/client-auth";
import { listGuestPursuits, removeGuestPursuits, subscribeGuestPursuits } from "@/lib/pursuits/guest-store";

const server = createServerListCache(async () => {
    await afterPursuitsReadHold();
    return getApplications();
});

export function invalidatePursuitsCache(): void {
    server.invalidate();
}

/**
 * Merge-at-sign-in (spec §3, §7): push every guest pursuit to the server,
 * then clear local storage. Callers (root page, /yours) guard this behind
 * their own `useRef` so it runs at most once per page load.
 *
 * Two shapes, two chokepoints: a job-linked guest pursuit goes through
 * `upsertPursuitForJob`, which keeps whichever stage is more advanced per
 * job_id. A manual (search-seed-line, no job_id) guest pursuit has nothing
 * to find-or-create by — same as its own server-side creation path — so it
 * goes through `createManualPursuit` instead, carrying the guest's current
 * `status` through rather than resetting to "interviewing" (a job_id-less
 * guest pursuit used to be silently dropped here entirely).
 *
 * A guest role marked Applied carries the résumé copy it took then
 * (`AppliedResume`) onto the account's role, dated when it was taken.
 */
/** @returns true when there was nothing to sync or every guest row landed. */
export async function syncGuestPursuitsToServer(): Promise<boolean> {
    const guests = listGuestPursuits();
    if (guests.length === 0) return true;
    // A role's résumé copy is résumé text: it goes up only for an account with paid time.
    const paid = await isAccountPaid();
    // Rows whose copy the account has not confirmed (unpaid, or refused for payment) keep it on this device.
    const keepOnDevice = new Set<string>();
    const results = await Promise.all(
        guests.map(async (g) => {
            const res = await (g.job_id
                ? upsertPursuitForJob(
                      {
                          job_id: g.job_id,
                          title: g.job_snapshot?.title ?? g.position,
                          company: g.job_snapshot?.company ?? g.company_name,
                          location: g.job_snapshot?.location ?? null,
                          description: g.job_snapshot?.description,
                          apply_url: g.job_snapshot?.apply_url ?? g.job_url ?? "",
                      },
                      g.status,
                  )
                : createManualPursuit({
                      company: g.company_name,
                      position: g.position,
                      status: g.status,
                      job_url: g.job_url,
                      note: g.note,
                  }));
            // Best effort: a copy the account refuses for any other reason
            // (over the upload cap) must not hold every guest row in this
            // browser for a retry. Only a job-linked row waits for payment:
            // re-syncing it is an idempotent upsert, a manual one would repeat.
            const copy = g.applied_resume;
            if (!res?.error && res?.data?.id && copy?.content) {
                const kept = paid ? await keepGuestAppliedResumeAction(res.data.id, { saved_at: copy.saved_at, content: copy.content }) : null;
                if ((!paid || isPaymentRequired(kept)) && g.job_id) keepOnDevice.add(g.id);
            }
            return res;
        }),
    );
    // Server actions return {error} rather than throwing, so Promise.all never
    // rejects. Remove only the rows the server confirmed (no error, an id back)
    // and not waiting on a résumé copy; every other row stays for the next
    // load's retry (job-linked upserts are idempotent; a manual row may briefly
    // duplicate, which beats silent loss).
    const confirmed = new Set<string>();
    guests.forEach((g, i) => {
        const r = results[i];
        if (!r?.error && r?.data?.id && !keepOnDevice.has(g.id)) confirmed.add(g.id);
    });
    removeGuestPursuits(confirmed);
    const ok = results.every((r) => !r?.error);
    invalidatePursuitsCache();
    return ok;
}

export interface UsePursuitsResult {
    pursuits: Pursuit[];
    loading: boolean;
    /** The signed-in read failed after its automatic retry — render
     *  `LoadFailedState`, never the empty state. */
    failed: boolean;
    retry: () => void;
    hasAny: boolean;
    /** job_id → pursuit, for an O(1) "does this job already have a pursuit" check. */
    byJobId: Map<string, Pursuit>;
}

export function usePursuits(): UsePursuitsResult {
    const [user, setUser] = useState(() => getCurrentUser());
    const [pursuits, setPursuits] = useState<Pursuit[]>(() => (user ? (server.peek() ?? []) : listGuestPursuits()));
    const [loading, setLoading] = useState(!!user && !server.peek());
    const [failed, setFailed] = useState(false);
    // Whose list `pursuits` holds (an account uid, or null for this browser's
    // guest list). The sign-in answer reaches this hook before the account's
    // list does; for that gap the list on hand is still the guest one, so the
    // hook reports loading instead of letting a page call the role missing.
    const [listUid, setListUid] = useState<string | null>(() => user?.uid ?? null);

    useEffect(
        () =>
            onAuthChange((nextUser) => {
                setUser(nextUser);
                if (!nextUser) {
                    invalidatePursuitsCache();
                    setPursuits(listGuestPursuits());
                    setListUid(null);
                    setLoading(false);
                    setFailed(false);
                }
            }),
        [],
    );

    // Re-read on mount/user-change and whenever the server cache or the
    // guest store is invalidated elsewhere (another mounted consumer's
    // mutation). Each `refresh` call below runs inside an async continuation
    // (a subscription callback or a `.then`), never synchronously as the
    // effect's first statement.
    useEffect(() => {
        let cancelled = false;
        const signedIn = !!user;
        const uid = user?.uid ?? null;

        const refresh = () => {
            if (cancelled) return;
            if (!signedIn) {
                setPursuits(listGuestPursuits());
                setListUid(null);
                setLoading(false);
                setFailed(false);
                return;
            }
            const pendingGuest = listGuestPursuits();
            if (pendingGuest.length > 0) {
                setPursuits(pendingGuest);
                setListUid(uid);
                setLoading(false);
                setFailed(false);
                return;
            }
            setLoading(!server.peek());
            server.fetch().then((res) => {
                if (cancelled) return;
                if (res.ok) setPursuits(res.data);
                setListUid(uid);
                setFailed(!res.ok);
                setLoading(false);
            });
        };

        // Kick off the first read via a microtask rather than synchronously,
        // so this effect's own body never calls setState directly.
        Promise.resolve().then(refresh);
        const unsubServer = server.subscribe(refresh);
        const unsubGuest = subscribeGuestPursuits(refresh);
        return () => {
            cancelled = true;
            unsubServer();
            unsubGuest();
        };
    }, [user]);

    const byJobId = new Map<string, Pursuit>();
    for (const p of pursuits) if (p.job_id) byJobId.set(p.job_id, p);

    return {
        pursuits,
        loading: loading || listUid !== (user?.uid ?? null),
        failed,
        retry: invalidatePursuitsCache,
        hasAny: pursuits.length > 0,
        byJobId,
    };
}
