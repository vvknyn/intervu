"use client";

import { useLayoutEffect, useState } from "react";

/**
 * Mirrors a docked slot's DOM node into React state, for a `createPortal`
 * target that only exists while its own gate is active (TopBar mounts each
 * `[data-testid="topbar-docked-*"]` element conditionally, so the node has
 * to be re-found after any render that may have added or removed it). The
 * `requestAnimationFrame` re-check after the synchronous read catches the
 * slot appearing a frame late, when its own conditional render commits
 * after this effect runs.
 *
 * One hook per slot, not one effect per gate — `jobs/page.tsx` calls this
 * once per docked mount, passing whichever gate (`headerDockActive`,
 * `homeViewDockActive`, …) governs that slot.
 */
export function useDockedSlotMount(active: boolean, testId: string): HTMLElement | null {
    const [mount, setMount] = useState<HTMLElement | null>(null);

    useLayoutEffect(() => {
        if (!active) {
            setMount(null);
            return;
        }
        const sync = () => {
            setMount(document.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null);
        };
        sync();
        const id = requestAnimationFrame(sync);
        return () => cancelAnimationFrame(id);
    }, [active, testId]);

    return mount;
}
