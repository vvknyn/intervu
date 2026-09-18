import type { Metadata } from "next";
import dynamic from "next/dynamic";

// ssr:false — this component's initial state reads window.location.search
// (?state=parsing|parsed, for the design-proof screenshot tooling to land
// directly on a state). Server-rendering it would always render "none" and
// mismatch the client's query-driven state on hydration. A dev-only,
// noindex, nav-unlinked harness has no SEO/first-paint reason to SSR.
const ResumeStatesMock = dynamic(
    () => import("@/components/mock/ResumeStatesMock").then((m) => m.ResumeStatesMock),
    { ssr: false },
);

export const metadata: Metadata = {
    title: "Resume states mock — Velai",
    robots: { index: false, follow: false },
};

/** Design-conformance proof for /resume's none/parsing/parsed states. */
export default function ResumeStatesMockPage() {
    return <ResumeStatesMock />;
}
