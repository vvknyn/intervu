"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { ResumeData } from "@/types/resume";
import { CircleNotch, Info as InfoIcon } from "@phosphor-icons/react";
import { fetchResumeData } from "@/actions/resume";
import { fetchProfile } from "@/actions/profile";
import { TailoredVersionsList } from "@/components/resume-tailor/TailoredVersionsList";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { MotivationalBanner } from "@/components/ui/motivational-banner";
import { McpHandoffNote } from "@/components/mcp/McpHandoffNote";

import { AuthPopover } from "@/components/auth/auth-popover";
import { getCurrentUser, signOut as firebaseSignOut, type User } from "@/lib/firebase/client-auth";
import { useRouter } from "next/navigation";

const RESUME_STORAGE_KEY = "interview-os-resume-data";

function ResumeTailorContent() {
    const router = useRouter();

    const [resumeData, setResumeData] = useState<ResumeData | null>(null);
    const [user, setUser] = useState<User | null>(null);
    const [authPopoverOpen, setAuthPopoverOpen] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);

    useEffect(() => {
        const currentUser = getCurrentUser();
        if (currentUser) setUser(currentUser);

        fetchProfile().then(({ data }) => {
            if (data && (data as any).is_admin) setIsAdmin(true);
        });
    }, []);

    const handleSignOut = async () => {
        localStorage.clear();
        await firebaseSignOut();
        window.location.href = "/";
    };

    // Load resume data from DB (authenticated) or localStorage (guest)
    useEffect(() => {
        const loadResume = async () => {
            // Try database first for authenticated users
            const { data: dbData, error } = await fetchResumeData();
            if (dbData && !error) {
                setResumeData(dbData);
                console.log("[ResumeTailor] Loaded from database");
                return;
            }

            // Fall back to localStorage
            const saved = localStorage.getItem(RESUME_STORAGE_KEY);
            if (saved) {
                try {
                    const data = JSON.parse(saved);
                    setResumeData(data);
                    console.log("[ResumeTailor] Loaded from localStorage");
                } catch (e) {
                    console.error("Failed to load resume data", e);
                }
            }
        };
        loadResume();
    }, []);

    const savedVersionsSidebar = (
        <div className="space-y-6">
            <div className="flex items-center gap-2 mb-4">
                <h3 className="text-lg font-semibold">Saved Versions</h3>
            </div>
            <TailoredVersionsList />
        </div>
    );

    return (
        <PageLayout
            header={
                <PageHeader
                    title="Tailor Resume"
                    actions={
                        <>
                            <AuthPopover open={authPopoverOpen} onOpenChange={setAuthPopoverOpen} showTrigger={false} />
                        </>
                    }
                />
            }
            sidebar={savedVersionsSidebar}
        >
            <MotivationalBanner />
            <div className="space-y-6 sm:space-y-8">
                {!resumeData && (
                    <div className="p-4 sm:p-6 bg-yellow-50/50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded-lg text-yellow-800 dark:text-yellow-200 flex items-center gap-3">
                        <InfoIcon size={20} className="shrink-0" />
                        <p className="text-sm sm:text-base">No resume found. Please <Link href="/resume-builder" className="underline font-medium hover:text-yellow-900 dark:hover:text-yellow-100">create a resume</Link> first.</p>
                    </div>
                )}

                <McpHandoffNote />
            </div>
        </PageLayout>
    );
}

export default function ResumeTailor() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center bg-background">
                <CircleNotch size={40} className="animate-spin text-muted-foreground/30" />
            </div>
        }>
            <ResumeTailorContent />
        </Suspense>
    );
}
