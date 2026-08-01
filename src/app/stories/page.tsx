"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchStories, saveStories } from "@/actions/save-story";
import { fetchSources } from "@/actions/sources";
import { StoryManager } from "@/components/dashboard/StoryManager";
import { SourcesManager } from "@/components/settings/SourcesManager";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/layout/PageHeader";

import { AuthPopover } from "@/components/auth/auth-popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { onAuthChange, signOut as firebaseSignOut, getCurrentUser, type User } from "@/lib/firebase/client-auth";
import { StarStory, SourceItem } from "@/types";
import { fetchProfile } from "@/actions/profile";
import { LOGIN_REQUIRED, pickRandom } from "@/lib/copy";
import { MotivationalBanner } from "@/components/ui/motivational-banner";

function StoriesLoading() {
    return (
        <div className="min-h-screen bg-background flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
                <div className="w-8 h-8 border-2 border-brand/20 border-t-brand rounded-full animate-spin" />
                <p className="text-muted-foreground text-sm">Loading stories...</p>
            </div>
        </div>
    );
}

function StoriesContent() {
    const router = useRouter();
    const searchParams = useSearchParams();

    const [user, setUser] = useState<User | null>(null);
    const [authPopoverOpen, setAuthPopoverOpen] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);
    const [loading, setLoading] = useState(true);

    const isSigningOut = useRef(false);

    const [stories, setStories] = useState<StarStory[]>([]);
    const [sources, setSources] = useState<SourceItem[]>([]);

    const defaultTab = searchParams.get("tab") === "sources" ? "sources" : "stories";

    useEffect(() => {
        const currentUser = getCurrentUser();
        if (currentUser) setUser(currentUser);

        fetchProfile().then(({ data }) => {
            if (data && (data as any).is_admin) setIsAdmin(true);
        });

        const unsubscribe = onAuthChange((firebaseUser) => {
            if (isSigningOut.current) return;
            setUser(firebaseUser);
            if (firebaseUser) {
                router.refresh();
            }
        });

        return () => unsubscribe();
    }, [router]);

    useEffect(() => {
        if (isSigningOut.current) return;

        const loadData = async () => {
            setLoading(true);
            try {
                const { data: storiesData } = await fetchStories();
                if (storiesData) {
                    try {
                        const parsed = JSON.parse(storiesData);
                        if (Array.isArray(parsed)) setStories(parsed);
                    } catch {
                        console.warn("Legacy story format found, starting fresh.");
                    }
                }

                const { data: sourcesData } = await fetchSources();
                if (sourcesData) setSources(sourcesData);
            } catch (e) {
                console.error("Failed to load stories data", e);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [user?.uid]);

    const handleSignOut = async () => {
        isSigningOut.current = true;
        localStorage.clear();
        await firebaseSignOut();
        window.location.href = "/";
    };

    const handleStorySave = async (newStories: StarStory[]) => {
        setStories(newStories);
        try {
            const res = await saveStories(newStories);
            if (res.error) throw new Error(res.error);
        } catch (e: any) {
            console.error("Failed to save stories:", e.message);
        }
    };

    // Guest View - Login Required
    if (!loading && !user) {
        return (
            <PageLayout
                header={
                    <PageHeader
                        title="Stories"
                    />
                }
            >
                <div className="flex flex-col items-center justify-center py-32 px-4 text-center">
                    <div className="w-16 h-16 bg-muted/50 rounded-2xl flex items-center justify-center mb-6 text-muted-foreground">
                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor" viewBox="0 0 256 256"><path d="M216,40H56A16,16,0,0,0,40,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,160H56V56H216V200ZM184,80a8,8,0,0,1,8-8h0a8,8,0,0,1,8,8v64a8,8,0,0,1-8,8h0a8,8,0,0,1-8-8ZM80,96a8,8,0,0,1,8-8h64a8,8,0,0,1,0,16H88A8,8,0,0,1,80,96Zm0,32a8,8,0,0,1,8-8h64a8,8,0,0,1,0,16H88A8,8,0,0,1,80,128Zm0,32a8,8,0,0,1,8-8h64a8,8,0,0,1,0,16H88A8,8,0,0,1,80,160Z"></path></svg>
                    </div>
                    <h2 className="text-xl font-semibold tracking-tight mb-2">
                        {pickRandom(LOGIN_REQUIRED.stories.headings)}
                    </h2>
                    <p className="text-muted-foreground max-w-[400px] mb-8 text-sm">
                        {pickRandom(LOGIN_REQUIRED.stories.subtexts)}
                    </p>

                    <Button
                        onClick={() => setAuthPopoverOpen(true)}
                        className="min-w-[120px]"
                    >
                        Log in
                    </Button>
                    <p className="mt-4 text-xs text-muted-foreground">
                        New here? <button onClick={() => setAuthPopoverOpen(true)} className="font-medium text-foreground hover:underline">Create an account</button>
                    </p>
                    <AuthPopover open={authPopoverOpen} onOpenChange={setAuthPopoverOpen} showTrigger={false} />
                </div>
            </PageLayout>
        );
    }

    return (
        <PageLayout
            header={
                <PageHeader
                    title="Stories"
                    actions={
                        <>
                            <AuthPopover open={authPopoverOpen} onOpenChange={setAuthPopoverOpen} showTrigger={false} />
                        </>
                    }
                />
            }
        >
            <MotivationalBanner />
            {loading ? (
                <div className="py-16 flex flex-col items-center justify-center text-muted-foreground gap-3">
                    <div className="w-5 h-5 border border-border border-t-foreground rounded-full animate-spin" />
                    <p className="text-sm">Loading...</p>
                </div>
            ) : (
                <Tabs defaultValue={defaultTab}>
                    <TabsList>
                        <TabsTrigger value="stories">
                            Stories (<span className="tabular-nums">{stories.filter(s => !s.deleted).length}</span>)
                        </TabsTrigger>
                        <TabsTrigger value="sources">
                            Sources (<span className="tabular-nums">{sources.length}</span>)
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="stories" className="mt-4">
                        <StoryManager stories={stories} onChange={handleStorySave} />
                    </TabsContent>

                    <TabsContent value="sources" className="mt-4">
                        <SourcesManager sources={sources} onChange={setSources} />
                    </TabsContent>
                </Tabs>
            )}
        </PageLayout>
    );
}

export default function StoriesPage() {
    return (
        <Suspense fallback={<StoriesLoading />}>
            <StoriesContent />
        </Suspense>
    );
}
