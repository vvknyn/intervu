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
 * A separate concern from `usePursuits` (tracked applications) — not bolted
 * onto that hook.
 */

import { useEffect, useState } from "react";
import { hasUsableResumeOnFile } from "@/actions/resume";

/** @param uid the signed-in user's id, or null when signed out. */
export function useResumePresence(uid: string | null): boolean {
    const [present, setPresent] = useState(false);

    // Mirrors `usePursuits`' idiom (lib/pursuits/use-pursuits.ts): the read
    // runs via a microtask, never synchronously as the effect's own first
    // statement, so a signed-out reset doesn't call setState directly
    // inside the effect body.
    useEffect(() => {
        let cancelled = false;
        const refresh = () => {
            if (cancelled) return;
            if (!uid) {
                setPresent(false);
                return;
            }
            hasUsableResumeOnFile()
                .then(({ hasResume }) => {
                    if (!cancelled) setPresent(hasResume);
                })
                .catch(() => {
                    if (!cancelled) setPresent(false);
                });
        };
        Promise.resolve().then(refresh);
        return () => {
            cancelled = true;
        };
    }, [uid]);

    return present;
}
