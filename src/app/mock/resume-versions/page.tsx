import type { Metadata } from "next";
import { TailoredVersionsList } from "@/components/resume/TailoredVersionsList";
import type { TailoredVersionSummary } from "@/actions/tailor-resume";

export const metadata: Metadata = {
    title: "Resume-versions mock — Intervu",
    robots: { index: false, follow: false },
};

const FIXTURE_VERSIONS: TailoredVersionSummary[] = [
    {
        id: "mock-1",
        versionName: "Stripe — Senior Product Manager",
        companyName: "Stripe",
        positionTitle: "Senior Product Manager",
        recommendationCount: 5,
        createdAt: "2026-08-18T14:30:00.000Z",
        updatedAt: "2026-08-19T09:12:00.000Z",
    },
    {
        id: "mock-2",
        versionName: "Linear — Product Manager, Growth",
        companyName: "Linear",
        positionTitle: "Product Manager, Growth",
        recommendationCount: 1,
        createdAt: "2026-08-14T11:05:00.000Z",
        updatedAt: "2026-08-14T11:05:00.000Z",
    },
    {
        id: "mock-3",
        versionName: "Notion — Product Manager, AI",
        companyName: "Notion",
        positionTitle: "Product Manager, AI",
        recommendationCount: 3,
        createdAt: "2026-08-02T18:45:00.000Z",
        updatedAt: "2026-08-03T08:20:00.000Z",
    },
    {
        id: "mock-4",
        versionName: "Adobe — Group PM, Creative Cloud",
        companyName: "Adobe",
        positionTitle: "Group PM, Creative Cloud",
        recommendationCount: 0,
        createdAt: "2026-07-22T16:00:00.000Z",
        updatedAt: null,
    },
];

/** Fixture page — no auth, no network. Exercises `TailoredVersionsList`'s
 *  `initialVersions` seam so the populated list (row layout, actions, inline
 *  delete-confirm) can be pixel-verified without a real signed-in session. */
export default function ResumeVersionsMockPage() {
    return (
        <div className="min-h-screen bg-background px-4 py-10 sm:px-8">
            <div className="mx-auto max-w-6xl xl:max-w-7xl">
                <TailoredVersionsList initialVersions={FIXTURE_VERSIONS} />
            </div>
        </div>
    );
}
