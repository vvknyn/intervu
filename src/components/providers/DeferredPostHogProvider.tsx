"use client";

import dynamic from "next/dynamic";

const PostHogProvider = dynamic(
    () => import("@/components/providers/PostHogProvider").then((m) => m.PostHogProvider),
    { ssr: false },
);

export function DeferredPostHogProvider({ children }: { children: React.ReactNode }) {
    return <PostHogProvider>{children}</PostHogProvider>;
}
