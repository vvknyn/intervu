"use client";

/**
 * Lightweight "does this signed-in user have a usable résumé on file"
 * signal — a boolean-only round trip (`hasUsableResumeOnFile`), never the
 * résumé document itself. /jobs (`page.tsx`) needs this to label its sort
 * control's "Best match"/"Relevance" segment correctly for a RETURNING user
 * on first paint, without re-introducing the mount-time full-résumé fetch
 * that was deliberately removed (page.tsx:2548, Task 4) — the actual résumé
 * is only ever fetched on demand, via `resolveUsableResume`, the moment an
 * action needs it.
 *
 * Tri-state, not boolean: `true`/`false` are KNOWN answers; `null` means
 * "the round trip hasn't landed yet" — a real, distinct state, not the same
 * as "known absent". A caller that treats `null` as `false` (e.g. skipping a
 * résumé-driven action's own resolve because the presence check merely
 * hasn't answered yet) re-creates the exact bug this hook exists to close,
 * just narrowed to the few hundred ms before the fetch resolves — see
 * page.tsx's `chooseBestMatch` (the sort control's résumé-aware third
 * segment) for why it only activates fit ranking on a strict `=== true`,
 * never on truthy. `false` on a failed fetch would be a lying answer (we
 * don't actually know), so a transient error also resolves to `null`, not
 * `false`.
 *
 * Auth hydration is the same trap one level up: `uid` is `null` until the
 * session cookie is asked for, which is "not yet known", not "signed out".
 * Passing `authReady: false` keeps this hook on `null` so /jobs does not
 * treat a returning user as résumeless and flash Search chrome.
 *
 * A separate concern from `usePursuits` (tracked applications) — not bolted
 * onto that hook.
 */

import { useEffect, useState } from "react";
import { hasUsableResumeOnFile } from "@/actions/resume";

/** @param uid the signed-in user's id, or null when signed out. */
export function useResumePresence(
    uid: string | null,
    authReady = true,
): boolean | null {
    const [present, setPresent] = useState<boolean | null>(null);

    // Mirrors `usePursuits`' idiom (lib/pursuits/use-pursuits.ts): the read
    // runs via a microtask, never synchronously as the effect's own first
    // statement, so a signed-out reset doesn't call setState directly
    // inside the effect body.
    useEffect(() => {
        let cancelled = false;
        const refresh = () => {
            if (cancelled) return;
            if (!authReady) {
                setPresent(null);
                return;
            }
            if (!uid) {
                // No account to check — this is a KNOWN answer, not "not yet known".
                setPresent(false);
                return;
            }
            // Don't keep a stale `false` from the pre-auth uid=null tick while
            // this uid's round trip is in flight.
            setPresent(null);
            hasUsableResumeOnFile()
                .then(({ hasResume }) => {
                    if (!cancelled) setPresent(hasResume);
                })
                .catch(() => {
                    // A failed round trip is NOT a known-absent answer — stay unknown.
                    if (!cancelled) setPresent(null);
                });
        };
        Promise.resolve().then(refresh);
        return () => {
            cancelled = true;
        };
    }, [uid, authReady]);

    return present;
}
