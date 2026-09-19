"use client";

// Design-conformance proof harness for /resume's three states (none /
// parsing / parsed). The real route only reaches "none" while signed out —
// "parsing" and "parsed" sit behind `beginResumeUpload`'s sign-in gate
// (src/app/resume/page.tsx), which this dev-only mock has no credentials
// for. Every state below renders the SAME production components/markup the
// real route uses (SignedOutEmptyState, ResumeParsingStep, LiveResumePreview,
// the Dialog chrome) with fixture data standing in for a live session — this
// file is NOT exempt from the banned-utility gate.

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload } from "@phosphor-icons/react";
import { SignedOutEmptyState } from "@/app/resume/page";
import { ResumeParsingStep } from "@/components/resume-builder/ResumeImportModal";
import { LiveResumePreview } from "@/components/resume-builder/LiveResumePreview";
import type { ResumeData } from "@/types/resume";

const FIXTURE_RESUME: ResumeData = {
    profile: {
        name: "Jordan Ellis",
        profession: "Senior Product Manager",
        yearsOfExperience: 8,
        location: "Austin, TX",
        email: "jordan.ellis@example.com",
        phone: "(512) 555-0142",
        linkedin: "linkedin.com/in/jordanellis",
    },
    generatedSummary:
        "Product leader with 8 years driving 0-to-1 launches and scaling B2B SaaS platforms. Led cross-functional teams of up to 12, shipping features that grew ARR by $4.2M.",
    competencies: [
        { category: "Product", skills: ["Roadmapping", "A/B testing", "User research", "Pricing strategy"] },
        { category: "Technical", skills: ["SQL", "Figma", "Amplitude", "Jira"] },
    ],
    experience: [
        {
            id: "exp-1",
            role: "Senior Product Manager",
            company: "Northwind Labs",
            dates: "2022 — Present",
            description:
                "Own the platform roadmap for a $30M ARR product line.\nLaunched self-serve onboarding, cutting time-to-value from 14 days to 2.\nGrew activation rate 22% through a redesigned first-run experience.",
        },
        {
            id: "exp-2",
            role: "Product Manager",
            company: "Corebase",
            dates: "2018 — 2022",
            description:
                "Shipped the analytics dashboard used by 40k weekly active users.\nPartnered with design and eng to cut churn 9% via a re-priced tier.",
        },
    ],
    projects: [],
    education: [
        {
            id: "edu-1",
            degree: "B.S. Business Administration",
            institution: "University of Texas at Austin",
            year: "2016",
        },
    ],
};

type MockState = "none" | "parsing" | "parsed";

const STATES: { id: MockState; label: string }[] = [
    { id: "none", label: "None" },
    { id: "parsing", label: "Parsing" },
    { id: "parsed", label: "Parsed" },
];

// Lets the layout-audit/screenshot proof tooling land directly on a state
// (e.g. /mock/resume?state=parsing) instead of driving the toggle via DOM
// interaction. Client-only read (no useSearchParams/Suspense needed) since
// this route is never statically prerendered with a meaningful query string.
function initialStateFromQuery(): MockState {
    if (typeof window === "undefined") return "none";
    const q = new URLSearchParams(window.location.search).get("state");
    return q === "parsing" || q === "parsed" ? q : "none";
}

export function ResumeStatesMock() {
    const [state, setState] = useState<MockState>(initialStateFromQuery);

    return (
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-8 xl:max-w-7xl xl:px-10">
            <h1 className="text-2xl font-semibold text-foreground">Resume states (design proof)</h1>
            <p className="mt-1 text-sm text-muted-foreground">
                Dev-only harness — not linked from product navigation.
            </p>

            {/* ToolbarSegment recipe (design-language.md §5): bare buttons, no
                filled/bordered wrapper — same shape as /jobs's sort segments
                and ResumeImportModal's local-AI toggle. A padded pill wrapper
                here would edge-hug the buttons against its own border. */}
            <div className="mt-4 flex items-center gap-3">
                {STATES.map((s) => (
                    <button
                        key={s.id}
                        type="button"
                        onClick={() => setState(s.id)}
                        className={`min-h-6 rounded-ctl px-3 text-xs font-semibold leading-none transition-colors ${
                            state === s.id
                                ? "text-foreground underline underline-offset-2"
                                : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        {s.label}
                    </button>
                ))}
            </div>

            <div className="mt-6">
                {state === "none" && <SignedOutEmptyState onUploadClick={() => {}} />}

                {state === "parsing" && (
                    <Dialog open onOpenChange={() => {}}>
                        <DialogContent className="flex w-full max-w-[calc(100%-1rem)] flex-col overflow-hidden rounded-panel bg-white max-h-[90dvh] dark:bg-muted sm:max-w-2xl">
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">
                                    <div className="w-8 h-8 rounded-panel bg-muted flex items-center justify-center">
                                        <Upload weight="bold" className="text-brand" />
                                    </div>
                                    Import Resume
                                </DialogTitle>
                                <DialogDescription>AI is extracting structured information</DialogDescription>
                            </DialogHeader>
                            <div className="flex-1 overflow-hidden py-4">
                                <ResumeParsingStep />
                            </div>
                            <div className="flex justify-between gap-3 border-t px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                                <Button variant="outline" className="h-11 min-h-11" disabled>
                                    Cancel
                                </Button>
                                <Button className="h-11 min-h-11" disabled>
                                    Processing...
                                </Button>
                            </div>
                        </DialogContent>
                    </Dialog>
                )}

                {state === "parsed" && (
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 rounded-panel border border-border bg-muted px-4 py-2.5 text-xs text-muted-foreground">
                            <span className="font-semibold text-foreground">Resume parsed</span>
                            <span>— fixture data, design-proof only.</span>
                        </div>
                        <LiveResumePreview data={FIXTURE_RESUME} />
                    </div>
                )}
            </div>
        </div>
    );
}
