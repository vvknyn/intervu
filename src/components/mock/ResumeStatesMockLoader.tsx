"use client";

import dynamic from "next/dynamic";

// `dynamic(..., { ssr: false })` is only legal inside a Client Component —
// this thin wrapper exists solely to host that call so the page itself can
// stay a Server Component (it needs to export `metadata`). See
// ResumeStatesMock.tsx for why ssr:false is needed here.
const ResumeStatesMock = dynamic(
    () => import("@/components/mock/ResumeStatesMock").then((m) => m.ResumeStatesMock),
    { ssr: false },
);

export function ResumeStatesMockLoader() {
    return <ResumeStatesMock />;
}
