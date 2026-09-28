"use client";

import { useState } from "react";
import { LandingOnboardingView } from "@/components/onboarding/LandingOnboardingView";
import { LandingAnimatedBackground } from "@/components/marketing/LandingAnimatedBackground";
import { CategoryHubGrid } from "@/components/jobs/CategoryHubGrid";
import { Button } from "@/components/ui/button";
import type { ResumeData } from "@/types/resume";

const FIXTURE_RESUME: ResumeData = {
    profile: {
        name: "Alex Chen",
        profession: "Senior Full Stack Engineer",
        yearsOfExperience: 8,
        location: "San Francisco, CA",
        email: "alex.chen@example.com",
        phone: "(555) 234-5678",
        linkedin: "linkedin.com/in/alexchen",
    },
    generatedSummary:
        "Full stack engineer with 8 years of experience building high-scale cloud platforms, distributed systems, and real-time web applications.",
    competencies: [
        { category: "Core Skills", skills: ["TypeScript", "React", "Next.js", "Python", "SQL", "PostgreSQL", "Redis"] },
    ],
    experience: [],
    projects: [],
    education: [],
};

type MockMode = "step2" | "step3_upload" | "step3_parsed" | "dashboard";

export function OnboardingMock() {
    const [mode, setMode] = useState<MockMode>("step3_parsed");
    const [resumeData, setResumeData] = useState<ResumeData>(FIXTURE_RESUME);

    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col p-4 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-panel border border-border bg-card">
                <div className="text-xs font-semibold text-foreground">
                    Onboarding &amp; Profile Parameters Preview
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                        size="sm"
                        variant={mode === "step2" ? "default" : "outline"}
                        onClick={() => setMode("step2")}
                        className="text-xs h-7 px-2.5"
                    >
                        Step 2
                    </Button>
                    <Button
                        size="sm"
                        variant={mode === "step3_upload" ? "default" : "outline"}
                        onClick={() => setMode("step3_upload")}
                        className="text-xs h-7 px-2.5"
                    >
                        Step 3 (Dropzone)
                    </Button>
                    <Button
                        size="sm"
                        variant={mode === "step3_parsed" ? "default" : "outline"}
                        onClick={() => setMode("step3_parsed")}
                        className="text-xs h-7 px-2.5"
                    >
                        Step 3 (Profile Params)
                    </Button>
                    <Button
                        size="sm"
                        variant={mode === "dashboard" ? "default" : "outline"}
                        onClick={() => setMode("dashboard")}
                        className="text-xs h-7 px-2.5"
                    >
                        Dashboard (CategoryHubGrid)
                    </Button>
                </div>
            </div>

            <div className="relative flex-1 flex flex-col items-center justify-center max-w-4xl mx-auto w-full overflow-hidden rounded-panel border border-border p-4 min-h-[500px]">
                <LandingAnimatedBackground />
                <div className="relative z-10 w-full max-w-2xl">
                {mode === "step2" && (
                    <LandingOnboardingView
                        initialStep={2}
                        isAuthenticated={false}
                        onComplete={() => setMode("dashboard")}
                        onOpenAuth={() => setMode("step3_upload")}
                        className="w-full"
                    />
                )}

                {mode === "step3_upload" && (
                    <LandingOnboardingView
                        initialStep={3}
                        isAuthenticated={true}
                        userName="Alex Chen"
                        userEmail="alex.chen@example.com"
                        onComplete={() => setMode("dashboard")}
                        className="w-full"
                    />
                )}

                {mode === "step3_parsed" && (
                    <div className="w-full max-w-2xl mx-auto space-y-3">
                        <LandingOnboardingView
                            initialStep={3}
                            initialParsedResume={resumeData}
                            isAuthenticated={true}
                            userName={resumeData.profile.name}
                            userEmail={resumeData.profile.email}
                            onComplete={(data) => {
                                if (data.resume) setResumeData(data.resume);
                                setMode("dashboard");
                            }}
                            className="w-full"
                        />
                    </div>
                )}

                {mode === "dashboard" && (
                    <div className="w-full space-y-4">
                        <CategoryHubGrid
                            userName={resumeData.profile.name}
                            isAuthenticated={true}
                            hasResume={true}
                            resume={resumeData}
                            onUpdateResume={(updated) => setResumeData(updated)}
                            onOpenAdvancedSearch={() => {}}
                        />
                    </div>
                )}
                </div>
            </div>
        </div>
    );
}
