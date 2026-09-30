"use client";

import { useEffect, useRef, useState, type ReactNode, type TouchEvent } from "react";
import { roleStackEntries } from "@/lib/jobs/for-you/role-stack";
import { resolveDeckSwipe } from "@/lib/jobs/for-you/deck-swipe";
import type { PublicJob } from "@/lib/jobs/types";
import { cn } from "@/lib/utils";

/**
 * The opened pack as a stack of role cards (Vivek, 2026-09-30). The open role
 * is the front card; Next slides the following role up over it and the
 * covered one tips back into the stack; Previous plays that in reverse; Skip
 * tips the skipped role back and fades it out. The poses live in globals.css
 * (`.role-stack-card[data-stack-pose]`), the window in role-stack.ts, and
 * reduced motion makes every change an instant swap.
 *
 * Only the open role's card is interactive: the others are `inert` and hidden
 * from assistive tech, so focus and the pack's test ids never land on a card
 * that is tipped back or still below the stage.
 */
export function RoleStack({
    roles,
    activeIndex,
    departing,
    renderCard,
    onSwipe,
    className,
}: {
    roles: readonly PublicJob[];
    activeIndex: number;
    /** A role Skip just removed; it tips back under the stack before it goes. */
    departing: PublicJob | null;
    renderCard: (job: PublicJob, active: boolean) => ReactNode;
    /** A clear horizontal swipe on a touch screen: left is next, right is previous. */
    onSwipe?: (direction: "previous" | "next") => void;
    className?: string;
}) {
    const stageRef = useRef<HTMLDivElement>(null);
    const touchStart = useRef<{ x: number; y: number } | null>(null);
    const [entered, setEntered] = useState(false);

    // The first frame holds the open role below the stage. Reading layout
    // commits that pose, so the switch to the real poses a frame later is a
    // transition (the slide up) rather than the card appearing in place.
    useEffect(() => {
        stageRef.current?.getBoundingClientRect();
        const frame = window.requestAnimationFrame(() => setEntered(true));
        return () => window.cancelAnimationFrame(frame);
    }, []);

    const entries = roleStackEntries(roles, activeIndex, { departing, entered });

    const onTouchStart = (event: TouchEvent<HTMLDivElement>) => {
        const touch = event.touches[0];
        touchStart.current = event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY } : null;
    };
    const onTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
        const start = touchStart.current;
        touchStart.current = null;
        const touch = event.changedTouches[0];
        if (!start || !touch || !onSwipe) return;
        const direction = resolveDeckSwipe({ dx: touch.clientX - start.x, dy: touch.clientY - start.y });
        if (direction) onSwipe(direction);
    };

    return (
        <div
            ref={stageRef}
            data-testid="role-stack"
            className={cn("role-stack-stage touch-pan-y", className)}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            onTouchCancel={() => {
                touchStart.current = null;
            }}
        >
            {entries.map((entry) => (
                <article
                    key={entry.key}
                    data-testid="role-stack-card"
                    data-job-id={entry.item.id}
                    data-stack-pose={entry.pose}
                    aria-label={entry.active ? (entry.item.title ?? undefined) : undefined}
                    aria-hidden={entry.active ? undefined : true}
                    inert={!entry.active}
                    className="role-stack-card"
                >
                    {renderCard(entry.item, entry.active)}
                </article>
            ))}
        </div>
    );
}
