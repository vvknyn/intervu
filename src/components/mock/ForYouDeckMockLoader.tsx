"use client";

import dynamic from "next/dynamic";

const ForYouDeckMock = dynamic(
    () => import("@/components/mock/ForYouDeckMock").then((m) => m.ForYouDeckMock),
    { ssr: false },
);

/** Client-only loader so `useSearchParams` / deck gestures stay off the RSC path. */
export function ForYouDeckMockLoader() {
    return <ForYouDeckMock />;
}
