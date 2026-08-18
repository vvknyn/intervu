"use client";

/**
 * Lightweight "does this signed-in user have a usable résumé on file"
 * signal — a boolean-only round trip (`hasUsableResumeOnFile`), never the
 * résumé document itself. /jobs (`page.tsx`) needs this to style its
 * persistent "My résumé" control correctly for a RETURNING user on first
 * paint, without re-introducing the mount-time full-résumé fetch that was
 * deliberately removed (page.tsx:2548, Task 4) — the actual résumé is only
 * ever fetched on demand, via `resolveUsableResume`, the moment an action
 * needs it.
 *
 * Tri-state, not boolean: `true`/`false` are KNOWN answers; `null` means
 * "the round trip hasn't landed yet" — a real, distinct state, not the same
 * as "known absent". A caller that treats `null` as `false` (e.g. skipping a
 * résumé-driven action's own resolve because the presence check merely
 * hasn't answered yet) re-creates the exact bug this hook exists to close,
 * just narrowed to the few hundred ms before the fetch resolves — see
 * page.tsx's `handleMyResumeClick` for why it never does that. `false` on a
 * failed fetch would be a lying answer (we don't actually know), so a
 * transient error also resolves to `null`, not `false`.
 *
 * A separate concern from `usePursuits` (tracked applications) — not bolted
 * onto that hook.
 */

import { useEffect, useState } from "react";
import { hasUsableResumeOnFile } from "@/actions/resume";

/** @param uid the signed-in user's id, or null when signed out. */
export function useResumePresence(uid: string | null): boolean | null {
    const [present, setPresent] = useState<boolean | null>(null);

    // Mirrors `usePursuits`' idiom (lib/pursuits/use-pursuits.ts): the read
    // runs via a microtask, never synchronously as the effect's own first
    // statement, so a signed-out reset doesn't call setState directly
    // inside the effect body.
    useEffect(() => {
        let cancelled = false;
        const refresh = () => {
            if (cancelled) return;
            if (!uid) {
                // No account to check — this is a KNOWN answer, not "not yet known".
                setPresent(false);
                return;
            }
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
    }, [uid]);

    return present;
}
