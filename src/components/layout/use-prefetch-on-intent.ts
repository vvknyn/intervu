"use client";

import { useRouter } from "next/navigation";

/**
 * Nav tabs prefetch on intent (pointer over, focus, touch) instead of on
 * sight. Next's default prefetches every visible tab's route while the page
 * underneath is still loading its first list, and on a throttled phone
 * profile that download pushed the first job rows 250–390 ms later. A hover
 * or touch still starts the fetch before the click lands.
 */
export function usePrefetchOnIntent(): (href: string) => {
    onMouseEnter: () => void;
    onFocus: () => void;
    onTouchStart: () => void;
} {
    const router = useRouter();
    return (href) => {
        const prefetch = () => router.prefetch(href);
        return { onMouseEnter: prefetch, onFocus: prefetch, onTouchStart: prefetch };
    };
}
