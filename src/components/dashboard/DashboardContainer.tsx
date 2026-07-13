import { useState, useEffect, useCallback, KeyboardEvent, useRef, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Gear, SignOut, MagnifyingGlass, WarningCircle, Link as LinkIcon, FileText, Briefcase, Globe, ArrowRight, Plugs } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/layout/Header";
import { EmptyState } from "./EmptyState";
import { LoadingState } from "./LoadingState";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AuthPopover } from "@/components/auth/auth-popover";


import { signOut } from "@/actions/auth";
import { onAuthChange, signOut as firebaseSignOut, getCurrentUser, type User } from "@/lib/firebase/client-auth";

import { CompanyReconData, MatchData, QuestionsData, ReverseQuestionsData, StarStory, SourceItem, TechnicalData, CodingChallenge, ProviderConfig, SystemDesignData } from "@/types";
import { fetchFavoritedQuestionTexts, addFavorite, removeFavorite } from "@/actions/favorites";
import { fetchRecon, fetchMatch, fetchQuestions, fetchReverse, generateGenericJSON, generateGenericText, fetchTechnicalQuestions, fetchCodingChallenge, explainTechnicalConcept, extractCompaniesFromResume, fetchSystemDesignQuestions, checkApiHealth, generateInterviewPlan } from "@/actions/generate-context";

import { fetchUrlContent } from "@/actions/fetch-url";
import { fetchResumeData, saveResumeData } from "@/actions/resume";
import { fetchTailoredVersions } from "@/actions/tailor-resume";
import { fetchProfile, updateResume } from "@/actions/profile";
import { llmCache } from "@/lib/llm/cache";
import { InterviewCache } from "@/lib/interview-cache";
import { buildPrepJobContextFromLegacy, emptyPrepJobContext, type PrepJobContext } from "@/lib/prep/job-context";
import { listCachedPlans, listResumableSessions, type CachedPlanListItem } from "@/lib/prep/plan-list";
import type { PrepSessionMode } from "@/lib/prep/session-progress";
import {
    emptyPendingPrep,
    queuePendingPrep,
    clearPendingPrep,
    takePrepReplay,
    type PendingPrepStartPayload,
    type PendingPrepState,
} from "@/lib/prep/pending-prep-actions";
import { PrepLanding } from "@/components/prep/PrepLanding";
import { PrepSetupFlow } from "@/components/prep/PrepSetupFlow";
import { PrepModeSelection } from "@/components/prep/PrepModeSelection";
import { RateLimiter } from "@/lib/rate-limiter";
import { fetchServerCache, saveServerCache } from "@/actions/cache";
import { loadEnhancedCache, saveEnhancedCache, canMakeRequest, recordRequest } from "@/lib/cache-helpers";
import { PageLayout } from "@/components/layout/PageLayout";
import { User as UserIcon, ChatCircleDots, Code, GraduationCap, Question, Star, BookOpen, Lightbulb } from "@phosphor-icons/react";
import { QuestionsLoader, ReverseQuestionsLoader, SectionLoader } from "@/components/dashboard/SectionLoaders";
import { saveStories, fetchStories } from "@/actions/save-story";
import { fetchSources, saveSource, deleteSource } from "@/actions/sources";
import { exportToPDF } from "@/actions/export-pdf";
import { parseSearchQuery } from "@/actions/search";
import { quickParseSearchQuery } from "@/lib/search-utils";
import { useDebouncedCallback } from "use-debounce";
import { classifySentinel, sentinelMessage } from "@/lib/llm/sentinels";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { STATUS_PILL } from "@/lib/ui/status-tokens";
import { PrepSettings, QuestionSettings, loadPrepSettings } from "./PrepSettings";
import { RecipeGrid } from "@/components/recipes/RecipeGrid";
import type { Recipe } from "@/components/recipes/recipes-config";
import { LOADING_MESSAGES, LOADING_STEPS } from "@/lib/copy";
import { MotivationalBanner } from "@/components/ui/motivational-banner";

// Lazy-loaded components — only fetched when actually rendered
const CompanyRecon = dynamic(() => import("./CompanyRecon").then(m => ({ default: m.CompanyRecon })), { ssr: false });
const MatchSection = dynamic(() => import("./MatchSection").then(m => ({ default: m.MatchSection })), { ssr: false });
const QuestionsGrid = dynamic(() => import("./QuestionsGrid").then(m => ({ default: m.QuestionsGrid })), { ssr: false });
const ReverseQuestions = dynamic(() => import("./ReverseQuestions").then(m => ({ default: m.ReverseQuestions })), { ssr: false });
const KnowledgeSection = dynamic(() => import("@/components/dashboard/KnowledgeSection").then(m => ({ default: m.KnowledgeSection })), { ssr: false });
const CodingWorkspace = dynamic(() => import("@/components/dashboard/CodingWorkspace").then(m => ({ default: m.CodingWorkspace })), { ssr: false });
const DashboardSidebar = dynamic(() => import("@/components/dashboard/DashboardSidebar").then(m => ({ default: m.DashboardSidebar })), { ssr: false });
const StoryManager = dynamic(() => import("@/components/dashboard/StoryManager").then(m => ({ default: m.StoryManager })), { ssr: false });
const SourcesManager = dynamic(() => import("@/components/settings/SourcesManager").then(m => ({ default: m.SourcesManager })), { ssr: false });
const ContextModal = dynamic(() => import("@/components/modals/ContextModal").then(m => ({ default: m.ContextModal })), { ssr: false });
const PrivacyNotice = dynamic(() => import("@/components/ui/privacy-notice").then(m => ({ default: m.PrivacyNotice })), { ssr: false });

const SetupRecipeWizard = dynamic(() => import("@/components/recipes/wizards/SetupRecipeWizard").then(m => ({ default: m.SetupRecipeWizard })), { ssr: false });
const StoryBankRecipeWizard = dynamic(() => import("@/components/recipes/wizards/StoryBankRecipeWizard").then(m => ({ default: m.StoryBankRecipeWizard })), { ssr: false });
const PrepareInterviewDialog = dynamic(() => import("@/components/recipes/wizards/PrepareInterviewDialog").then(m => ({ default: m.PrepareInterviewDialog })), { ssr: false });
const AddSourcesRecipeDialog = dynamic(() => import("@/components/recipes/wizards/AddSourcesRecipeDialog").then(m => ({ default: m.AddSourcesRecipeDialog })), { ssr: false });
const StarredQuestionsSection = dynamic(() => import("@/components/dashboard/StarredQuestionsSection").then(m => ({ default: m.StarredQuestionsSection })), { ssr: false });
const CodingCountDialog = dynamic(() => import("@/components/dashboard/CodingCountDialog").then(m => ({ default: m.CodingCountDialog })), { ssr: false });

export function DashboardContainer() {
    // Router and URL params
    const router = useRouter();
    const searchParams = useSearchParams();

    // Global State - Single search query
    const [searchQuery, setSearchQuery] = useState("");
    const [searchError, setSearchError] = useState<string | null>(null);
    const [authPopoverOpen, setAuthPopoverOpen] = useState(false);

    // Parsed values from search query
    const [company, setCompany] = useState("");
    const [position, setPosition] = useState("");
    const [round, setRound] = useState("");

    const [loading, setLoading] = useState(false);
    const [loadingText, setLoadingText] = useState("");
    const [progress, setProgress] = useState(0); // Progress State
    const [viewState, setViewState] = useState<"empty" | "loading" | "dashboard" | "error">("empty");
    const [hasSearched, setHasSearched] = useState(false);
    const [prepPhase, setPrepPhase] = useState<"landing" | "setup" | "mode" | "session" | "summary" | "package">("landing");
    const [showSearchPlans, setShowSearchPlans] = useState(false);
    const [prepJobContext, setPrepJobContext] = useState<PrepJobContext>(() => emptyPrepJobContext("", "", ""));
    const [cachedPlans, setCachedPlans] = useState<CachedPlanListItem[]>([]);
    const [resumableSessions, setResumableSessions] = useState<ReturnType<typeof listResumableSessions>>([]);
    const [error, setError] = useState<string | null>(null);
    // Data State
    const [reconData, setReconData] = useState<CompanyReconData | null>(null);
    const [matchData, setMatchData] = useState<MatchData | null>(null);
    const [questionsData, setQuestionsData] = useState<QuestionsData | null>(null);
    const [reverseData, setReverseData] = useState<ReverseQuestionsData | null>(null);
    const [technicalData, setTechnicalData] = useState<TechnicalData | null>(null);
    const [codingChallenges, setCodingChallenges] = useState<CodingChallenge[]>([]);
    const [systemDesignData, setSystemDesignData] = useState<SystemDesignData | null>(null);
    const [resultsHaveResumeContext, setResultsHaveResumeContext] = useState(false);

    // Favorites state
    const [favoritedMap, setFavoritedMap] = useState<Record<string, string>>({});

    // Coding Count Dialog state
    const [codingCountDialogOpen, setCodingCountDialogOpen] = useState(false);
    const codingCountResolverRef = useRef<((count: number) => void) | null>(null);
    const codingChallengeCountRef = useRef<number>(1);

    const pendingPrepRef = useRef<PendingPrepState>(emptyPendingPrep());
    const authedPrepRef = useRef(false);

    // Calculate if role is technical (for optimistic tab rendering)
    // Calculate if role is technical (for optimistic tab rendering)
    const isTechnicalRole = (() => {
        const positionLower = position.toLowerCase();
        const roundLower = round.toLowerCase();

        // 1. STRONG EXCLUSIONS: Medical, Legal, HR, Sales, etc.
        // If these are in the POSITION, strictly exclude regardless of round name
        if (/slp|speech|pathologist|therapist|medical|nurse|doctor|physician|clinical|health|sales|account|marketing|business|hr|recruiter|finance|legal|operations|support|customer|admin|assistant/i.test(positionLower)) {
            return false;
        }

        // 2. STRONG INCLUSIONS: If position has these, it's technical
        // IT/Engineering Abbreviations & Keywords
        if (/\b(swe|sde|sdet|mle|qa|dev|eng)\b/i.test(positionLower) ||
            /software|developer|engineer|programmer|coding|technical|technology|data scientist|machine learning|ai|full stack|backend|frontend|web|devops|sre|security|cyber|cloud|systems|architect|network|database|dba/i.test(positionLower)) {
            return true;
        }

        // 3. ROUND-BASED INFERENCE (Careful with "Technical")
        // "Coding" or "System Design" rounds are almost always for tech roles. 
        // But only if we are mostly sure it's not a restricted role (already filtered by step 1).
        if (/coding|system design|whiteboard|algorithm|leetcode|hackerrank/i.test(roundLower)) {
            return true;
        }
        // "Coding" or "System Design" rounds are almost always for tech roles
        if (/coding|system design|whiteboard|algorithm/i.test(roundLower)) {
            return true;
        }

        // "Technical" round is ambiguous (SLPs have technical rounds). 
        // Only accept it if we didn't exclude it above, AND maybe it has some other hint?
        // actually, if we passed the exclusion list, and the round is "Technical", it MIGHT be technical.
        // But for safety, let's require at least some tech hint in position or strict round name.
        // Let's NOT include generic "Technical" round unless position matches.

        return false;
    })();
    // User Data
    const [resume, setResume] = useState("");
    const [stories, setStories] = useState<StarStory[]>([]);
    const [sources, setSources] = useState<SourceItem[]>([]);
    const [context, setContext] = useState("");
    const [user, setUser] = useState<User | null>(null);

    // Refs for always-current values (avoid stale closure issues)
    const resumeRef = useRef("");
    const storiesRef = useRef<StarStory[]>([]);

    // Keep refs in sync with state
    useEffect(() => {
        resumeRef.current = resume;
    }, [resume]);

    useEffect(() => {
        storiesRef.current = stories;
    }, [stories]);

    // Question generation settings
    const [prepSettings, setPrepSettings] = useState<QuestionSettings>({
        questions: 20,
        reverse: 5,
        technical: 5,
        systemDesign: 10
    });
    // Track the settings used for the last analysis to show "Update" indicator
    const [lastAnalyzedSettings, setLastAnalyzedSettings] = useState<QuestionSettings | null>(null);

    // Check if current settings differ from last analyzed
    const hasPendingChanges = lastAnalyzedSettings ? (
        JSON.stringify(prepSettings) !== JSON.stringify(lastAnalyzedSettings)
    ) : false;

    // New State for Job Context & Companies
    const [jobUrl, setJobUrl] = useState("");
    const [jobContext, setJobContext] = useState("");
    const [jobInputMode, setJobInputMode] = useState<"url" | "text">("url"); // Added state
    const [isFetchingJob, setIsFetchingJob] = useState(false);
    const [resumeCompanies, setResumeCompanies] = useState<string[]>([]);

    // Modals & UI State
    const [isContextOpen, setIsContextOpen] = useState(false);
    const [isExportingPDF, setIsExportingPDF] = useState(false);
    const [isAuthChecked, setIsAuthChecked] = useState(false);
    const [isGuest, setIsGuest] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);
    const [isRegeneratingMatch, setIsRegeneratingMatch] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);

    // Individual section loading states - tracks whether each section is still loading
    const [sectionLoading, setSectionLoading] = useState<{
        match: boolean;
        questions: boolean;
        reverse: boolean;
        technical: boolean;
        coding: boolean;
        systemDesign: boolean;
    }>({
        match: false,
        questions: false,
        reverse: false,
        technical: false,
        coding: false,
        systemDesign: false
    });

    // Dashboard UI State
    const [activeSection, setActiveSection] = useState("section-match");
    const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);


    // Recipe Wizard State
    const [setupRecipeOpen, setSetupRecipeOpen] = useState(false);
    const setupDismissCountRef = useRef(0);
    const [storyRecipeOpen, setStoryRecipeOpen] = useState(false);
    const [prepareRecipeOpen, setPrepareRecipeOpen] = useState(false);
    const [sourcesRecipeOpen, setSourcesRecipeOpen] = useState(false);
    const [isRegeneratingAll, setIsRegeneratingAll] = useState(false);

    // Ref for the center column (viewport-locked scroll container on desktop)
    const centerColumnRef = useRef<HTMLDivElement>(null);

    // Scroll to top when switching sections
    useEffect(() => {
        if (centerColumnRef.current) {
            centerColumnRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [activeSection]);

    // Cache helpers
    const getCacheKey = (comp: string, pos: string, rnd: string) => `interview-os-cache-${comp.toLowerCase()}-${pos.toLowerCase()}-${rnd.toLowerCase()}`;


    const saveToCache = (comp: string, pos: string, rnd: string, data: { reconData?: CompanyReconData, matchData?: MatchData, questionsData?: QuestionsData, reverseData?: ReverseQuestionsData, technicalData?: TechnicalData, codingChallenges?: CodingChallenge[], systemDesignData?: SystemDesignData }, hasContext: boolean) => {
        try {
            const cacheData = {
                timestamp: Date.now(),
                company: comp,
                position: pos,
                round: rnd,
                hasContext, // Store if this data was generated with context
                reconData: data.reconData,
                matchData: data.matchData,
                questionsData: data.questionsData,
                reverseData: data.reverseData,
                technicalData: data.technicalData,
                codingChallenges: data.codingChallenges,
                systemDesignData: data.systemDesignData
            };
            sessionStorage.setItem(getCacheKey(comp, pos, rnd), JSON.stringify(cacheData));
        } catch (e) {
            console.error("Failed to save to cache:", e);
        }
    };

    const loadFromCache = (comp: string, pos: string, rnd: string) => {
        try {
            const cached = sessionStorage.getItem(getCacheKey(comp, pos, rnd));
            if (!cached) return null;

            const cacheData = JSON.parse(cached);
            // Cache expires after 1 hour
            if (Date.now() - cacheData.timestamp > 60 * 60 * 1000) {
                sessionStorage.removeItem(getCacheKey(comp, pos, rnd));
                return null;
            }
            return cacheData;
        } catch (e) {
            console.error("Failed to load from cache:", e);
            return null;
        }
    };

    // Load User Data (Resume, Stories, Profile)
    // Returns the resume text so callers can check for stale cache
    const fetchUserData = useCallback(async (): Promise<string> => {
        const currentUser = getCurrentUser();
        setUser(currentUser);
        setIsAuthChecked(true);

        // Load Stories
        const { data: storiesData } = await fetchStories();
        if (storiesData) {
            try {
                const parsed = JSON.parse(storiesData);
                if (Array.isArray(parsed)) setStories(parsed);
            } catch (e) {
                console.log("Could not parse stories as JSON.");
            }
        }

        // Load Sources
        const { data: sourcesData } = await fetchSources();
        if (sourcesData) {
            setSources(sourcesData);
        }

        // Load Favorites Map (batch fetch for O(1) lookups)
        if (user) {
            fetchFavoritedQuestionTexts().then(({ data: favMap }) => {
                if (favMap) setFavoritedMap(favMap);
            }).catch(e => console.warn("Failed to load favorites map:", e));
        }

        // Helper: convert structured resume data to text for AI context
        const resumeDataToText = (rd: any): string => {
            const textParts: string[] = [];
            if (rd.profile) {
                textParts.push(`${rd.profile.profession || ''} | ${rd.profile.email || ''} | ${rd.profile.location || ''}`);
            }
            if (rd.generatedSummary) {
                textParts.push(`SUMMARY:\n${rd.generatedSummary}`);
            }
            if (rd.experience?.length > 0) {
                textParts.push("EXPERIENCE:");
                rd.experience.forEach((exp: any) => {
                    textParts.push(`${exp.role || ''} at ${exp.company || ''} (${exp.dates || ''})\n${exp.description || ''}`);
                });
            }
            if (rd.competencies?.length > 0) {
                textParts.push("SKILLS:");
                rd.competencies.forEach((comp: any) => {
                    textParts.push(`${comp.category || 'Skills'}: ${(comp.skills || []).join(", ")}`);
                });
            }
            if (rd.education?.length > 0) {
                textParts.push("EDUCATION:");
                rd.education.forEach((edu: any) => {
                    textParts.push(`${edu.degree || ''} at ${edu.institution || ''} (${edu.year || ''})`);
                });
            }
            return textParts.join("\n\n");
        };

        // Load Resume
        let resumeText = "";
        const { data: profileData } = await fetchProfile();
        if (profileData) {
            console.log("[Dashboard] Profile Data:", profileData);
            if ((profileData as any).is_admin) setIsAdmin(true);
            if (profileData.resume_text && profileData.resume_text.length > 50) {
                console.log("[Dashboard] Found resume_text length:", profileData.resume_text.length);
                resumeText = profileData.resume_text;
                setResume(profileData.resume_text);
                resumeRef.current = profileData.resume_text;
            } else {
                console.log("[Dashboard] No resume_text in database, checking resume_data fallback");

                // Fallback 1: Try structured resume_data from database
                const { data: structuredResume } = await fetchResumeData();
                if (structuredResume && (structuredResume.profile?.profession || structuredResume.experience?.length || structuredResume.generatedSummary)) {
                    const converted = resumeDataToText(structuredResume);
                    if (converted.length > 50) {
                        resumeText = converted;
                        setResume(converted);
                        resumeRef.current = converted;
                        console.log("[Dashboard] Loaded resume from resume_data (structured), length:", converted.length);

                        // Sync resume_text back to profile so it's available next time
                        updateResume(converted).catch(e => console.warn("Failed to sync resume_text:", e));
                    }
                }

                // Fallback 2: Try localStorage
                if (!resumeText && typeof window !== 'undefined') {
                    const RESUME_STORAGE_KEY = "interview-os-resume-data";
                    const savedResume = localStorage.getItem(RESUME_STORAGE_KEY);
                    if (savedResume) {
                        try {
                            const resumeData = JSON.parse(savedResume);
                            const localResumeText = resumeDataToText(resumeData);
                            if (localResumeText.length > 50) {
                                resumeText = localResumeText;
                                setResume(localResumeText);
                                resumeRef.current = localResumeText;
                                console.log("[Dashboard] Loaded resume from localStorage fallback, length:", localResumeText.length);
                            }
                        } catch (e) {
                            console.warn("Failed to parse localStorage resume fallback", e);
                        }
                    }
                }

                // Fallback 3: Try extracting from tailored resume versions
                if (!resumeText) {
                    try {
                        const { data: versions } = await fetchTailoredVersions();
                        if (versions && versions.length > 0) {
                            const v = versions[0]; // most recent version
                            const versionResume: any = {
                                profile: v.originalProfile,
                                generatedSummary: v.originalSummary,
                                experience: v.originalExperience,
                                competencies: v.originalCompetencies,
                                education: v.originalEducation,
                            };
                            const versionText = resumeDataToText(versionResume);
                            if (versionText.length > 50) {
                                resumeText = versionText;
                                setResume(versionText);
                                resumeRef.current = versionText;
                                console.log("[Dashboard] Loaded resume from tailored version fallback, length:", versionText.length);

                                // Persist to profile so future loads are fast
                                updateResume(versionText).catch(e => console.warn("Failed to sync resume_text from version:", e));
                                saveResumeData(versionResume).catch(e => console.warn("Failed to sync resume_data from version:", e));
                            }
                        }
                    } catch (e) {
                        console.warn("Failed to load resume from tailored versions", e);
                    }
                }
            }

        } else {
            // Guest mode: Load from localStorage
            console.log("[DashboardContainer] Guest mode - loading from localStorage");

            // Try to load resume from Resume Builder localStorage
            const RESUME_STORAGE_KEY = "interview-os-resume-data";
            const savedResume = localStorage.getItem(RESUME_STORAGE_KEY);
            if (savedResume) {
                try {
                    const resumeData = JSON.parse(savedResume);
                    resumeText = resumeDataToText(resumeData);
                    if (resumeText.length > 50) {
                        setResume(resumeText);
                        resumeRef.current = resumeText;
                        console.log("[DashboardContainer] Loaded resume from localStorage, length:", resumeText.length);
                    }
                } catch (e) {
                    console.warn("Failed to parse saved resume", e);
                }
            }
        }
        return resumeText;
    }, []);

    // Model config — server reads OPENROUTER_API_KEY from env
    const modelConfig: Partial<ProviderConfig> = {};

    // Manual Refresh - Force new analysis (Bypass Cache)
    const handleRefresh = async () => {
        setIsRefreshing(true);
        await fetchUserData();

        // If we have an active search, re-analyze
        if (hasSearched && searchQuery) {
            // Pass forceRefresh=true
            await handleAnalyze(true);
        }
        setIsRefreshing(false);
    };

    // Auto-refresh on focus or visibility change
    useEffect(() => {
        const onFocus = () => {
            fetchUserData();
        };
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                fetchUserData();
            }
        };
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => {
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [fetchUserData]);


    // Load prep settings from localStorage
    useEffect(() => {
        setPrepSettings(loadPrepSettings());
    }, []);

    // Initial Data Load and URL State Restoration
    useEffect(() => {
        const loadData = async () => {
            const userResume = await fetchUserData();
            const hasUserContext = userResume.length > 20;

            // Listen for auth changes
            const unsubscribeAuth = onAuthChange((firebaseUser) => {
                setUser(firebaseUser);
                if (!firebaseUser) {
                    setStories([]);
                    setResume("");  // Clear resume
                    setResumeCompanies([]); // Clear companies
                }
            });



            // Check URL params first to determine intent
            const urlCompany = searchParams.get('company');
            const urlPosition = searchParams.get('position');
            const urlRound = searchParams.get('round');
            const urlSearched = searchParams.get('searched');
            const isCleanHome = searchParams.toString() === '';

            // If navigating to clean "/" (Home), reset to home view
            if (isCleanHome) {
                setHasSearched(false);
                setPrepPhase("landing");
                setShowSearchPlans(false);
            }

            // Restore dashboard state from localStorage (only on clean home with no URL override)
            // This restores the search bar values but does NOT auto-navigate to SERP
            const savedState = localStorage.getItem('dashboard_state');
            if (savedState && isCleanHome) {
                try {
                    const state = JSON.parse(savedState);
                    if (state.searchQuery) setSearchQuery(state.searchQuery);
                    if (state.company) setCompany(state.company);
                    if (state.position) setPosition(state.position);
                    if (state.round) setRound(state.round);
                    if (state.jobUrl) setJobUrl(state.jobUrl);
                    if (state.jobContext) setJobContext(state.jobContext);
                } catch (e) {
                    console.error('Failed to restore dashboard state', e);
                }
            }

            // Restore state from URL (explicit SERP navigation)
            if (urlCompany && urlPosition && urlRound && urlSearched === 'true') {
                setCompany(urlCompany);
                setPosition(urlPosition);
                setRound(urlRound);
                setSearchQuery(`${urlCompany}, ${urlPosition}, ${urlRound}`);
                setHasSearched(true);
                setPrepPhase("package");

                // Try to load from cache
                const cached = await loadEnhancedCache(urlCompany, urlPosition, urlRound);
                // Don't use stale cache if user has resume but cache has no matchData
                const shouldUseCacheUrl = cached && (cached.hasContext === hasUserContext) && (!hasUserContext || (hasUserContext && cached.matchData));
                if (shouldUseCacheUrl && cached) {
                    setReconData(cached.reconData);
                    setMatchData(cached.matchData);
                    setQuestionsData(cached.questionsData);
                    setReverseData(cached.reverseData);
                    setTechnicalData(cached.technicalData);
                    setCodingChallenges(cached.codingChallenges || []);
                    setSystemDesignData(cached.systemDesignData);
                    setResultsHaveResumeContext(!!cached.hasContext);
                    setViewState("dashboard");
                } else if (cached) {
                    // Restore partial data but trigger re-analysis for match
                    setReconData(cached.reconData);
                    setQuestionsData(cached.questionsData);
                    setReverseData(cached.reverseData);
                    setTechnicalData(cached.technicalData);
                    setCodingChallenges(cached.codingChallenges || []);
                    setSystemDesignData(cached.systemDesignData);
                    setResultsHaveResumeContext(false);
                    setViewState("dashboard");
                    // matchData left as null - auto-analyze effect will trigger
                }
            }

            // Return cleanup function
            return () => {
                unsubscribeAuth?.();
            };
        };
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    // Save dashboard state to localStorage whenever it changes
    useEffect(() => {
        if (hasSearched) {
            const state = {
                searchQuery,
                company,
                position,
                round,
                jobUrl,
                jobContext
            };
            localStorage.setItem('dashboard_state', JSON.stringify(state));
        }
    }, [searchQuery, company, position, round, jobUrl, jobContext, hasSearched]);

    // Refresh cached plan list when returning to landing
    useEffect(() => {
        if (!hasSearched && prepPhase === "landing") {
            setCachedPlans(listCachedPlans());
            setResumableSessions(listResumableSessions());
        }
    }, [hasSearched, prepPhase]);

    const openPrepAuth = () => {
        authedPrepRef.current = false;
        setAuthPopoverOpen(true);
    };

    const runPrepStart = async (payload: PendingPrepStartPayload) => {
        const { jobContext, mode, prepSettings: settings } = payload;
        const companyName = jobContext.identity.companyName;
        const jobTitle = jobContext.identity.jobTitle;
        const roundVal = jobContext.interview.round;

        setPrepJobContext({
            ...jobContext,
            interview: { ...jobContext.interview, sessionMode: mode },
        });
        setCompany(companyName);
        setPosition(jobTitle);
        setRound(roundVal);
        setJobContext(jobContext.content.originalJd ?? "");
        setPrepSettings(settings);

        setSearchError(null);
        setLoading(true);
        setLoadingText(LOADING_STEPS.generating);

        try {
            const currentResume = resumeRef.current || resume;
            const hasResumeContext = currentResume.length > 20;

            const cached = await loadEnhancedCache(companyName, jobTitle, roundVal);
            const shouldUseCache = cached
                && (cached.hasContext === hasResumeContext)
                && (!hasResumeContext || (hasResumeContext && cached.matchData));

            if (shouldUseCache && cached) {
                applyCachedPlanData(cached);
                setPrepPhase("session");
                return;
            }

            const currentUser = getCurrentUser();
            if (currentUser) {
                const rateLimitCheck = canMakeRequest(currentUser.uid);
                if (!rateLimitCheck.allowed) {
                    setSearchError(rateLimitCheck.message || "Rate limit exceeded");
                    return;
                }
                recordRequest(currentUser.uid);
            }

            const storiesText = getStoriesContext();

            let outputPrefs = { strategyLength: "standard" as const, coverLetterLength: "standard" as const };
            try {
                const stored = localStorage.getItem("intervu-output-prefs");
                if (stored) outputPrefs = { ...outputPrefs, ...JSON.parse(stored) };
            } catch { /* ignore */ }

            const result = await generateInterviewPlan(
                companyName,
                jobTitle,
                roundVal,
                currentResume,
                storiesText,
                {
                    modelConfig: {},
                    prepSettings: settings,
                    outputPrefs,
                    codingChallengeCount: codingChallengeCountRef.current,
                    jobContext,
                },
                false,
            );

            if (result.error) {
                throw new Error(result.error);
            }

            if (result.reconData) setReconData(result.reconData);
            if (result.matchData) setMatchData(result.matchData);
            if (result.questionsData) setQuestionsData(result.questionsData);
            if (result.reverseData) setReverseData(result.reverseData);
            if (result.technicalData) setTechnicalData(result.technicalData);
            if (result.codingChallenges && result.codingChallenges.length > 0) {
                setCodingChallenges(result.codingChallenges);
            }
            if (result.systemDesignData) setSystemDesignData(result.systemDesignData);
            setResultsHaveResumeContext(currentResume.length > 20);
            setLastAnalyzedSettings(settings);
            setPrepPhase("session");
        } catch (e: unknown) {
            const sentinel = classifySentinel(e);
            if (sentinel === "auth") {
                setAuthPopoverOpen(true);
                setSearchError("Sign in to use Intervu's built-in AI (or add your own key in Settings).");
            } else if (sentinel === "credits") {
                const msg = sentinelMessage(e) ||
                    "You're out of AI credits. Add your own API key in Settings to keep going.";
                toast.error(msg, 7000);
                setSearchError(msg);
            } else {
                const errorMessage = e instanceof Error ? e.message : "Failed to start preparation.";
                setSearchError(errorMessage);
            }
        } finally {
            setLoading(false);
            setLoadingText("");
        }
    };

    const maybeReplayPrepStart = useCallback(() => {
        if (!authedPrepRef.current) return;
        const { next, action } = takePrepReplay(pendingPrepRef.current);
        pendingPrepRef.current = next;
        if (!action) return;
        if (action.kind === "start") {
            void runPrepStart(action.payload);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (user) maybeReplayPrepStart();
    }, [user, maybeReplayPrepStart]);

    const handlePrepModeSelect = (mode: PrepSessionMode) => {
        const { companyName, jobTitle } = prepJobContext.identity;
        const roundVal = prepJobContext.interview.round;
        const planCacheKey = InterviewCache.getCacheKey(companyName, jobTitle, roundVal);

        const payload: PendingPrepStartPayload = {
            jobContext: {
                ...prepJobContext,
                interview: { ...prepJobContext.interview, sessionMode: mode },
            },
            mode,
            prepSettings,
            planCacheKey,
        };

        if (!user) {
            pendingPrepRef.current = queuePendingPrep(pendingPrepRef.current, { kind: "start", payload });
            openPrepAuth();
            return;
        }

        void runPrepStart(payload);
    };

    // Auto-save Resume with Debounce
    const debouncedSaveResume = useDebouncedCallback(async (text: string) => {
        if (typeof text === 'string') {
            await updateResume(text);
        }
    }, 2000);


    // Watch for resume changes
    // Watch for resume changes and auto-save
    useEffect(() => {
        // Skip initial load
        debouncedSaveResume(resume);
    }, [resume, debouncedSaveResume]);

    // Auto-extract companies from resume for the Included Experiences dropdown
    useEffect(() => {
        const extractCompanies = async () => {
            // Only extract if we have a resume and haven't extracted yet
            if (!resume || resume.length < 50 || resumeCompanies.length > 0) return;

            console.log("[Dashboard] Extracting companies from resume...");
            try {
                // Use the current model config
                const result = await extractCompaniesFromResume(resume, modelConfig);
                if (result.data && result.data.length > 0) {
                    console.log("[Dashboard] Extracted companies:", result.data);
                    setResumeCompanies(result.data);
                }
            } catch (e) {
                console.error("Failed to extract companies:", e);
            }
        };

        extractCompanies();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resume]); // Only re-run if resume changes drastically (and we don't have companies)


    // Derived: Serialize Stories for AI
    const getStoriesContext = () => {
        if (stories.length === 0) return "";
        return stories.map(s => `
            STORY TITLE: ${s.title}
            SITUATION: ${s.situation}
            TASK: ${s.task}
            ACTION: ${s.action}
            RESULT: ${s.result}
        `).join("\n\n");
    };

    const getSourcesContext = () => {
        if (sources.length === 0) return "";
        return sources.map(s => `
            SOURCE (${s.type}): ${s.title}
            CONTENT: ${s.content}
        `).join("\n\n");
    };

    const getFullContext = () => `
    RESUME SUMMARY:
    ${resume}
    
    ADDITIONAL STORIES / CONTEXT (USER EDITABLE):
    ${getStoriesContext()}

    ADDITIONAL SOURCES:
    ${getSourcesContext()}
  `;

    const handleFetchJobContext = async () => {
        if (!jobUrl) return;
        setIsFetchingJob(true);
        setSearchError(null);

        try {
            const res = await fetchUrlContent(jobUrl);
            if (res.data) {
                setJobContext(res.data);

                // Try to intelligently parse company and position from the job description
                const parsed = await parseSearchQuery(`Extract company name and job title from: ${res.data.substring(0, 1000)}`);

                if (parsed && parsed.company && parsed.position) {
                    setCompany(parsed.company);
                    setPosition(parsed.position);
                    // Update search query to reflect parsed values
                    setSearchQuery(`${parsed.company}, ${parsed.position}, ${round || 'Technical Round'}`);
                }
            } else {
                setSearchError(res.error || "Failed to fetch job posting");
            }
        } catch (error) {
            console.error("Job URL fetch error:", error);
            setSearchError("Failed to fetch job posting");
        } finally {
            setIsFetchingJob(false);
        }
    };


    const handleAnalyze = async (forceRefresh: boolean = false) => {
        console.log(`[handleAnalyze] Called with query="${searchQuery}" forceRefresh=${forceRefresh}`);
        if (!searchQuery.trim()) {
            setSearchError("Tell us what you're preparing for \u2014 e.g. \"Google PM final round\"");
            return;
        }

        // Server handles API key via OPENROUTER_API_KEY env var
        const activeModelConfig: Partial<ProviderConfig> = {};

        setSearchError(null);
        setLoading(true);
        setLoadingText(LOADING_STEPS.parsing);
        let progressInterval: ReturnType<typeof setInterval> | null = null;

      try {

        // Try quick parse first (instant, client-side)
        console.log("Parsing query...");
        let parsed = quickParseSearchQuery(searchQuery);

        // If quick parse fails, try server-side LLM parsing with timeout
        if (!parsed) {
            console.log("Quick parse failed, trying server parse...");
            try {
                parsed = await parseSearchQuery(searchQuery, activeModelConfig);
            } catch (e) {
                // SECTION C: handle AUTH_REQUIRED/OUT_OF_CREDITS on the client
                // (e.g. show sign-in prompt / add-key CTA) — the server gate throws
                // these with a recognizable prefix on shared-key generations.
                console.error("Parse failed:", e);
                console.log(`Parse error: ${e}`);
            }
        }

        if (!parsed) {
            console.log("Parse returned null — showing error");
            setSearchError("Could not understand your query. Please enter in format: Company, Position, Round (e.g., Google, Software Engineer, Technical)");
            setLoading(false);
            if (hasSearched) setViewState("error");
            return;
        }

        console.log(`Parsed: ${parsed.company} / ${parsed.position} / ${parsed.round}`);

        // Update parsed values
        setCompany(parsed.company);
        setPosition(parsed.position);
        setRound(parsed.round);

        // Determine if this is a technical role from freshly-parsed values
        const parsedIsTechnical = (() => {
            const posLower = parsed.position.toLowerCase();
            const rndLower = parsed.round.toLowerCase();
            if (/slp|speech|pathologist|therapist|medical|nurse|doctor|physician|clinical|health|sales|account|marketing|business|hr|recruiter|finance|legal|operations|support|customer|admin|assistant/i.test(posLower)) return false;
            if (/\b(swe|sde|sdet|mle|qa|dev|eng)\b/i.test(posLower) || /software|developer|engineer|programmer|coding|technical|technology|data scientist|machine learning|ai|full stack|backend|frontend|web|devops|sre|security|cyber|cloud|systems|architect|network|database|dba/i.test(posLower)) return true;
            if (/coding|system design|whiteboard|algorithm|leetcode|hackerrank/i.test(rndLower)) return true;
            return false;
        })();

        // Show coding count dialog for technical roles (only on fresh search, not refresh)
        if (parsedIsTechnical && !forceRefresh) {
            setLoading(false); // Pause loading indicator while dialog is shown
            const count = await new Promise<number>((resolve) => {
                codingCountResolverRef.current = resolve;
                setCodingCountDialogOpen(true);
            });
            codingChallengeCountRef.current = count;
            setLoading(true);
        } else if (forceRefresh) {
            // Use previously selected count on refresh
        } else {
            codingChallengeCountRef.current = 0;
        }

        // Use refs for current values (avoids stale closure issues)
        const currentResume = resumeRef.current || resume;
        const currentStories = storiesRef.current || stories;

        // Check cache first
        // Fix: Compare resume context specifically (not stories) to match what the cache tracks
        const hasResumeContext = currentResume.length > 20;
        console.log("[DashboardContainer] Context check:", {
            resumeLength: currentResume.length,
            storiesCount: currentStories.length,
            hasResumeContext,
            resumeStateLength: resume.length,
            resumeRefLength: resumeRef.current.length
        });

        // Skip Cache if forceRefresh is true
        console.log("Checking cache...");
        if (!forceRefresh) {
            const cached = await loadEnhancedCache(parsed.company, parsed.position, parsed.round);
            const shouldUseCache = cached && (cached.hasContext === hasResumeContext) && (!hasResumeContext || (hasResumeContext && cached.matchData));

            if (shouldUseCache && cached) {
                console.log("Cache hit! Loading from cache");
                setReconData(cached.reconData);
                setMatchData(cached.matchData);
                setQuestionsData(cached.questionsData);
                setReverseData(cached.reverseData);
                setTechnicalData(cached.technicalData);
                setCodingChallenges(cached.codingChallenges || []);
                setSystemDesignData(cached.systemDesignData);
                setResultsHaveResumeContext(!!cached.hasContext);
                setHasSearched(true);
                setViewState("dashboard");
                setLoading(false);

                // Update URL
                const params = new URLSearchParams();
                params.set('position', parsed.position);
                params.set('round', parsed.round);
                params.set('searched', 'true');
                // Update the URL in place — NOT via the Next router — so the [searchParams]
                // init effect doesn't re-fire and re-run a second (token-wasting) analysis.
                window.history.replaceState(null, "", `/?${params.toString()}`);
                return;
            }
        }


        // Check rate limit before making API calls (cache miss)
        const currentUser = getCurrentUser();
        if (currentUser) {
            const rateLimitCheck = canMakeRequest(currentUser.uid);
            if (!rateLimitCheck.allowed) {
                setSearchError(rateLimitCheck.message || "Rate limit exceeded");
                setLoading(false);
                setViewState("error");
                return;
            }
            // Record this request for rate limiting
            recordRequest(currentUser.uid);
        }

        setHasSearched(true);
        setViewState("loading");
        setLoading(true);
        setError(null);
        setProgress(5);

        let messageIndex = 0;
        setLoadingText(LOADING_MESSAGES[0]);

        // Simulated progress interval
        progressInterval = setInterval(() => {
            setProgress(prev => {
                // Slower progress as it gets higher, capping at 90%
                if (prev >= 90) return 90;
                const increment = prev < 50 ? 5 : 2;
                return prev + increment;
            });

            // Rotate messages every few ticks (approx every 3s)
            if (Date.now() % 3000 < 500 && messageIndex < LOADING_MESSAGES.length - 1) {
                messageIndex++;
                setLoadingText(LOADING_MESSAGES[messageIndex]);
            }
        }, 800);

        const storiesText = getStoriesContext();
            console.log("Calling generateInterviewPlan server action...");
            // Generate Interview Plan (Batched Backend Action)
            setLoadingText(LOADING_STEPS.generating);

            // Load output preferences from localStorage
            let outputPrefs = { strategyLength: "standard" as const, coverLetterLength: "standard" as const };
            try {
                const stored = localStorage.getItem("intervu-output-prefs");
                if (stored) outputPrefs = { ...outputPrefs, ...JSON.parse(stored) };
            } catch { /* ignore */ }

            const settings = {
                modelConfig: activeModelConfig,
                prepSettings,
                outputPrefs,
                codingChallengeCount: codingChallengeCountRef.current,
                jobContext: buildPrepJobContextFromLegacy({
                    company: parsed.company,
                    position: parsed.position,
                    round: parsed.round,
                    jobUrl,
                    jobContextText: jobContext,
                    resumeText: currentResume,
                    prepIntensity: JSON.stringify(prepSettings),
                }),
            };

            const result = await generateInterviewPlan(
                parsed.company,
                parsed.position,
                parsed.round,
                currentResume,
                storiesText,
                settings,
                forceRefresh
            );

            if (result.error) {
                throw new Error(result.error);
            }

            // Batch State Updates
            if (result.reconData) setReconData(result.reconData);
            if (result.matchData) setMatchData(result.matchData);
            if (result.questionsData) setQuestionsData(result.questionsData);
            if (result.reverseData) setReverseData(result.reverseData);
            if (result.technicalData) setTechnicalData(result.technicalData);
            if (result.codingChallenges && result.codingChallenges.length > 0) setCodingChallenges(result.codingChallenges);
            if (result.systemDesignData) setSystemDesignData(result.systemDesignData);
            setResultsHaveResumeContext(currentResume.length > 20);

            if (result.fromCache) {
                console.log("[Dashboard] Loaded full plan from Server Cache");
            } else {
                console.log("[Dashboard] Generated new plan from Server");
            }

            // Sync State for Persistence
            const newState = {
                searchQuery: searchQuery,
                company: parsed.company,
                position: parsed.position,
                round: parsed.round,
                reconData: result.reconData,
                matchData: result.matchData,
                questionsData: result.questionsData,
                reverseData: result.reverseData,
                technicalData: result.technicalData,
                codingChallenges: result.codingChallenges,
                systemDesignData: result.systemDesignData,
                hasSearched: true,
                loading: false,
                viewState: "dashboard",
                timestamp: Date.now()
            };
            localStorage.setItem('dashboard_state', JSON.stringify(newState));

            setHasSearched(true);
            setViewState("dashboard");
            setHasSearched(true);
            setViewState("dashboard");
            setLoading(false);
            setProgress(100);

            // Update URL
            const params = new URLSearchParams();
            params.set('company', parsed.company);
            params.set('position', parsed.position);
            params.set('round', parsed.round);
            params.set('searched', 'true');
            // Update the URL in place — NOT via the Next router — so the [searchParams]
            // init effect doesn't re-fire and re-run a second (token-wasting) analysis.
            window.history.replaceState(null, "", `/?${params.toString()}`);

      } catch (e: unknown) {
            // SECTION C sentinel UX: the server cost/auth gate throws prefixed errors.
            //  - AUTH_REQUIRED → open the login popover (shared key needs an account).
            //  - OUT_OF_CREDITS → show an add-key / upgrade message.
            const sentinel = classifySentinel(e);
            if (sentinel === "auth") {
                setAuthPopoverOpen(true);
                setViewState(hasSearched ? "error" : "empty");
                setSearchError("Sign in to use Intervu's built-in AI (or add your own key in Settings).");
            } else if (sentinel === "credits") {
                const msg = sentinelMessage(e) ||
                    "You're out of AI credits. Add your own API key in Settings to keep going.";
                toast.error(msg, 7000);
                setViewState(hasSearched ? "error" : "empty");
                setSearchError(msg);
            } else {
                let errorMessage = "Analysis failed due to an unexpected error.";

                if (e instanceof Error) {
                    errorMessage = e.message;
                } else if (typeof e === "string") {
                    errorMessage = e;
                } else if (typeof e === "object" && e && "error" in e) {
                    errorMessage = String((e as any).error);
                } else if (typeof e === "object" && e && "message" in e) {
                    errorMessage = String((e as any).message);
                }

                // Use warn for expected provider errors (rate limits), error for unexpected failures
                const isProviderError = errorMessage.toLowerCase().includes('limit') || errorMessage.toLowerCase().includes('switch to');
                if (isProviderError) {
                    console.warn("[DashboardContainer] Provider limit:", errorMessage);
                } else {
                    console.error("[DashboardContainer] Analysis Error:", e);
                }

                setSearchError(errorMessage);
                setError(errorMessage);
                setViewState(hasSearched ? "error" : "empty");
            }
      } finally {
            if (progressInterval) clearInterval(progressInterval);
            setLoading(false);
            setLoadingText("");
            setProgress(0);
            // Update last analyzed settings
            setLastAnalyzedSettings(prepSettings);
      }
    };

    const handleUpdateMatches = async (newMatches: string[]) => {
        if (!matchData) return;

        // Optimistic update of entities
        const updatedMatchData = { ...matchData, matched_entities: newMatches };
        setMatchData(updatedMatchData);
        setIsRegeneratingMatch(true);

        try {
            // AI Refresh of headline and script
            const entitiesStr = newMatches.join(", ");
            const prompt = `
            Context: Candidate is interviewing at ${company} for a ${position} role in a ${round} interview.
            Selected Experiences/Companies: ${entitiesStr}
            Full Resume & Data: ${getFullContext()}
            ${jobContext ? `\nJob Posting Context:\n${jobContext}` : ""}

            Task: Write a COMPREHENSIVE, DETAILED "Tell me about yourself" script.
            
            CRITICAL INSTRUCTIONS:
            1. **Length Goal**: 450-600 words (3-4 minutes spoken). THIS MUST BE LONG AND DETAILED.
            2. **Structure (4 Distinct Sections)**:
               - **Paragraph 1 (The Foundation)**: Education & early career context. Set the stage detailedly. (~80-100 words)
               - **Paragraph 2 (The Growth)**: Middleware/earlier relevant roles. Don't just list titles—explain *challenges* and *wins*. (~120-150 words)
               - **Paragraph 3 (The Peak)**: Most recent/senior roles. Deep dive into specific projects, leadership, and impact. Highlight: ${entitiesStr}. (~120-150 words)
               - **Paragraph 4 ( The Alignment)**: Why you are here. Connect your specific "Peak" skills to [Company]'s mission/product. (~80-100 words)
            3. **Style**: Conversational but professional. "Let me walk you through my journey..."
            4. **CRITICAL**: Do NOT summarize. EXPAND on your points.
            5. **FIRST PERSON**: "I started..."

            STRICT RULES:
            - **Data Source**: Use ONLY the Resume/Stories for candidate facts.
            - **Relevance**: Focus on experience relevant to ${position}. 
            - **NO NUMBERS/METRICS**: Do NOT include specific figures, percentages, or KPIs.

            Return JSON: {
                "headline": "A punchy 5-8 word headline summarizing the candidate's fit",
                "reasoning": "The full first-person script in markdown format (combine all 4 paragraphs into one text)"
            }
        `;

            const res = await generateGenericJSON(prompt, modelConfig);
            if (res) {
                setMatchData({ ...updatedMatchData, headline: res.headline, reasoning: res.reasoning });
            }
        } catch (e) {
            console.error("Failed to regenerate match script:", e);
        } finally {
            setIsRegeneratingMatch(false);
        }
    };

    const handleRegenerateQuestions = async () => {
        if (!company || !position || !round) return;
        setLoadingText(LOADING_STEPS.refreshing);
        // Pass true for uniqueness, use prepSettings.questions for count
        const res = await fetchQuestions(company, position, round, modelConfig, true, prepSettings.questions);
        if (res.data) setQuestionsData(res.data);
        setLoadingText("");
    };

    const handleToggleFavorite = async (questionText: string, isFavorited: boolean, favoriteId?: string) => {
        if (!user) {
            setAuthPopoverOpen(true);
            return;
        }

        if (isFavorited && favoriteId) {
            // Optimistic: remove from map
            setFavoritedMap(prev => {
                const next = { ...prev };
                delete next[questionText];
                return next;
            });
            await removeFavorite(favoriteId);
        } else {
            // Optimistic: add to map with placeholder ID
            const tempId = `temp-${Date.now()}`;
            setFavoritedMap(prev => ({ ...prev, [questionText]: tempId }));
            const { data, error } = await addFavorite({
                question_text: questionText,
                company,
                position,
                round,
            });
            if (data) {
                setFavoritedMap(prev => ({ ...prev, [questionText]: data.id }));
            } else if (error) {
                // Revert optimistic update
                setFavoritedMap(prev => {
                    const next = { ...prev };
                    delete next[questionText];
                    return next;
                });
            }
        }
    };

    const handleAddMatch = (match: string) => {
        if (!matchData) return;
        const entities = matchData.matched_entities || [];
        if (entities.includes(match)) return;
        handleUpdateMatches([...entities, match]);
    };

    const handleRemoveMatch = (match: string) => {
        if (!matchData) return;
        const entities = matchData.matched_entities || [];
        handleUpdateMatches(entities.filter(m => m !== match));
    };

    const handleGenerateStrategy = async (index: number, questionItem: any) => {
        // Fallback for types if needed
        const questionText = typeof questionItem === 'string' ? questionItem : questionItem.question;
        const category = typeof questionItem === 'object' ? questionItem.category : 'Behavioral';
        const keyPoints = questionItem.keyPoints || [];
        const framework = questionItem.framework || questionItem.answerFramework;
        const jobContextSection = jobContext ? `\n\nJOB POSTING CONTEXT:\n${jobContext}` : "";

        // Behavioral -> STAR Method (Uses Resume)
        if (category === 'Behavioral') {
            const prompt = `
                Context: Candidate is interviewing at ${company} for a ${position} role.${jobContextSection}
                Question: "${questionText}"
                Full Resume & Data: ${getFullContext()}

                Task: Write a compelling STAR method answer using the candidate's background.

                CRITICAL INSTRUCTIONS - DATA & SPECIFICS:
                1. EXTRACT EXACT NUMBERS from the resume/stories: percentages (25%, 40%), dollar amounts ($50K, $1M), timeframes (3 months, 2 weeks), team sizes (5 engineers, 12 people), user counts (10K users, 1M DAU).
                2. If the resume mentions "improved performance" - find the actual number or estimate based on context (e.g., "reduced latency by approximately 30%").
                3. NEVER use vague phrases like "significantly improved", "greatly enhanced", "substantial impact". ALWAYS quantify.
                4. The Result section MUST contain at least 2-3 specific metrics or outcomes.
                5. Reference specific technologies, tools, or methodologies mentioned in the resume.

                ANTI-VAGUENESS RULES:
                - BAD: "Led a team to improve the system"
                - GOOD: "Led a team of 5 engineers over 3 months to reduce API latency from 800ms to 200ms"
                - BAD: "Increased revenue significantly"
                - GOOD: "Increased conversion rate by 18%, adding $2.3M in annual revenue"

                If exact numbers aren't in the resume, use reasonable estimates with qualifiers like "approximately" or "roughly" - but NEVER leave metrics out entirely.

                FORMAT YOUR RESPONSE AS:
                **Situation:** [2-3 sentences with specific context - team size, company stage, timeline]
                **Task:** [1-2 sentences with clear, measurable objective]
                **Action:** [3-5 sentences with specific technical/strategic steps taken]
                **Result:** [2-3 sentences with QUANTIFIED impact - percentages, dollar amounts, time saved, users impacted. THIS IS MANDATORY.]
            `;
            return generateGenericText(prompt, modelConfig);
        }

        // Product Management Questions
        if (category === 'Product Management' || category?.toLowerCase().includes('product')) {
            const frameworkHint = framework ? `Use the ${framework} framework to structure your answer.` : '';
            const keyPointsHint = keyPoints.length > 0 ? `Key points to cover: ${keyPoints.join(', ')}` : '';

            const prompt = `
                Context: Candidate is interviewing at ${company} for a ${position} role.${jobContextSection}
                Question: "${questionText}"
                ${frameworkHint}
                ${keyPointsHint}
                Full Resume & Data: ${getFullContext()}

                Task: Provide a structured PM interview answer with SPECIFIC DATA AND METRICS.

                CRITICAL - DATA REQUIREMENTS:
                1. When discussing metrics, use SPECIFIC numbers (e.g., "target 15% increase in DAU", "reduce churn from 8% to 5%")
                2. When estimating market size or impact, show your math (e.g., "10M users × $5 ARPU = $50M TAM")
                3. When prioritizing, assign actual scores or percentages
                4. Reference specific examples from your experience with real metrics
                5. NEVER use vague terms like "significant", "substantial", "many users" - QUANTIFY everything

                FORMAT YOUR RESPONSE WITH CLEAR SECTIONS:
                ${framework === 'CIRCLES' ? `
                **Comprehend:** Clarify the question and constraints (include specific user segments, market size)
                **Identify:** Identify the user and their needs (with % breakdown of user types)
                **Report:** Report user needs and pain points (quantify impact)
                **Cut:** Prioritize the most important needs (use a scoring framework)
                **List:** List potential solutions (with estimated effort/impact)
                **Evaluate:** Evaluate trade-offs (compare with specific metrics)
                **Summarize:** Recommend with expected outcomes (target metrics)
                ` : framework === 'RICE' ? `
                **Reach:** How many users affected? (specific numbers)
                **Impact:** What's the impact per user? (1-3 scale with rationale)
                **Confidence:** How confident are we? (% with data sources)
                **Effort:** How much work is required? (person-weeks/months)
                **Prioritization:** Final score and recommendation
                ` : `
                **Understanding:** Clarify the problem (with specific constraints and metrics)
                **Analysis:** Break down the key factors (with data points)
                **Approach:** Your proposed solution (with timeline and milestones)
                **Trade-offs:** Consider alternatives (with quantified comparison)
                **Metrics:** Success metrics with specific targets (e.g., "increase retention from 60% to 75%")
                `}

                Reference the candidate's past experience with specific results where relevant.
            `;
            return generateGenericText(prompt, modelConfig);
        }

        // System Design Questions
        if (category === 'System Design') {
            const prompt = `
                Context: Interview at ${company} for ${position}.${jobContextSection}
                Question: "${questionText}"
                ${keyPoints.length > 0 ? `Key points to address: ${keyPoints.join(', ')}` : ''}

                Task: Provide a structured system design answer.

                FORMAT YOUR RESPONSE AS:
                **Requirements:** Functional and non-functional requirements
                **High-Level Design:** Key components and their interactions
                **Deep Dive:** Detailed design of critical components
                **Trade-offs:** Discuss alternatives and why you chose this approach
                **Scalability:** How the system handles growth

                Keep it concise but comprehensive.
            `;
            return generateGenericText(prompt, modelConfig);
        }

        // Coding Questions
        if (category === 'Coding') {
            const prompt = `
                Context: Interview at ${company} for ${position}.${jobContextSection}
                Question: "${questionText}"

                Task: Provide a coding interview answer.

                FORMAT YOUR RESPONSE AS:
                **Approach:** Explain your algorithm approach
                **Time Complexity:** O(?) analysis
                **Space Complexity:** O(?) analysis
                **Code:**
                \`\`\`
                // Clean, well-commented solution
                \`\`\`
                **Edge Cases:** List important edge cases to handle
            `;
            return generateGenericText(prompt, modelConfig);
        }

        // Case Study Questions
        if (category === 'Case Study') {
            const prompt = `
                Context: Interview at ${company} for ${position}.${jobContextSection}
                Question: "${questionText}"
                Full Resume & Data: ${getFullContext()}

                Task: Provide a structured case study answer with SPECIFIC DATA AND METRICS throughout.

                CRITICAL - DATA REQUIREMENTS:
                1. When estimating, show your math explicitly (e.g., "1M users × 10% conversion × $50 = $5M")
                2. Use specific numbers for all assumptions (not "many" or "some" - use "approximately 500K" or "roughly 15%")
                3. Provide concrete timelines (not "soon" - use "within 3 months" or "by Q2")
                4. Reference specific metrics from your experience when drawing parallels

                FORMAT YOUR RESPONSE AS:
                **Clarifying Questions:** What would you ask? (with why each matters for the analysis)
                **Framework:** Structure your analysis (with specific categories and weightings)
                **Analysis:** Key insights with DATA POINTS (market sizes, growth rates, conversion rates, costs)
                **Recommendation:** Your proposed solution with EXPECTED OUTCOMES (target metrics, ROI estimate, timeline)
                **Next Steps:** Implementation plan with specific milestones and success criteria

                Draw from the candidate's experience with SPECIFIC RESULTS where relevant.
            `;
            return generateGenericText(prompt, modelConfig);
        }

        const prompt = `
            Context: Interview at ${company} for ${position}.${jobContextSection}
            Question: "${questionText}"
            Category: ${category}
            ${keyPoints.length > 0 ? `Key points to address: ${keyPoints.join(', ')}` : ''}
            Full Resume & Data: ${getFullContext()}

            Task: Provide a well-structured, comprehensive answer to this interview question.

            CRITICAL - DATA REQUIREMENTS:
            1. EXTRACT AND USE specific numbers from the resume/stories: percentages, dollar amounts, timeframes, team sizes, user counts
            2. NEVER use vague phrases like "significantly improved" or "greatly enhanced" - ALWAYS quantify
            3. If exact numbers aren't available, use reasonable estimates with "approximately" or "roughly"
            4. Include at least 2-3 specific metrics or data points in your answer

            FORMAT YOUR RESPONSE WITH:
            - Clear structure using **bold headers**
            - Bullet points where appropriate
            - SPECIFIC examples with DATA (numbers, percentages, timeframes)
            - Quantified outcomes and results
            - Keep it concise but thorough
        `;
        return generateGenericText(prompt, modelConfig);
    };

    // Auto-analyze if we have search params but missing data (e.g. from URL restore or Resume addition)
    useEffect(() => {
        if (!hasSearched) return;
        if (loading) return;
        if (viewState === 'error') return;

        const hasResume = resume.length > 20;
        const missingMatch = hasResume && !matchData;
        const noData = viewState === 'empty';

        // Only auto-trigger if we need data
        if (missingMatch || noData) {
            // Debounce slightly to ensure state is settled
            const timer = setTimeout(() => {
                handleAnalyze();
            }, 100);
            return () => clearTimeout(timer);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resume.length, hasSearched, matchData, viewState, loading]);



    const handleSaveContext = () => {
        setIsContextOpen(false);
        handleRegenerateQuestions();
    };



    const handleRegenerateReverse = async () => {
        const promptReverse = `
        Target: ${company}. Position: ${position}. Round: ${round}.
        Candidate Profile: ${getFullContext()}
        Generate 5 strategic, high-level questions for a ${position} candidate to ask the interviewer at the end of a ${round} interview at ${company}.
        Tailor these questions based on the candidate's background and the specific interview round.
        Focus on growth, challenges, and culture relevant to the ${position} role.
        Return JSON: { "reverse_questions": [{ "type": "Category Name", "question": "The question text" }] }
    `;
        const res = await generateGenericJSON(promptReverse, modelConfig);
        if (res) setReverseData(res);
    };

    const handleExportPDF = async () => {
        if (!reconData || !matchData || !questionsData || !reverseData) {
            toast.info('Please complete the analysis before exporting to PDF.');
            return;
        }

        setIsExportingPDF(true);
        try {
            const result = await exportToPDF({
                company,
                round,
                reconData,
                matchData,
                questionsData,
                reverseData,
                resume,
                stories: getStoriesContext()
            });

            if (result.success && result.pdf) {
                // Create download link
                const link = document.createElement('a');
                link.href = result.pdf;
                link.download = `${company}-${round}-interview-prep.pdf`;
                link.click();
            } else {
                toast.error(`Failed to export PDF: ${result.error || 'Unknown error'}`);
            }
        } catch (error: unknown) {
            console.error('Export error:', error);
            toast.error('Failed to export PDF. Please try again.');
        } finally {
            setIsExportingPDF(false);
        }
    };

    const handleReset = () => {
        // Clear cache
        const keys = Object.keys(sessionStorage);
        keys.forEach(key => {
            if (key.startsWith('interview-os-cache-')) {
                sessionStorage.removeItem(key);
            }
        });
        localStorage.removeItem('dashboard_state');

        // Reset all state
        setSearchQuery("");
        setCompany("");
        setPosition("");
        setRound("");
        setJobUrl("");
        setJobContext("");
        setReconData(null);
        setMatchData(null);
        setQuestionsData(null);
        setReverseData(null);
        setTechnicalData(null);
        setCodingChallenges([]);
        setSystemDesignData(null);
        setHasSearched(false);
        setViewState("empty");
        setPrepPhase("landing");
        setShowSearchPlans(false);
        setSearchError(null);
        router.push("/");
    };


    const handleRegenerateAll = async () => {
        if (isRegeneratingAll || !company || !position || !round) return;

        setIsRegeneratingAll(true);
        try {
            // Clear sessionStorage caches
            const keys = Object.keys(sessionStorage);
            keys.forEach(key => {
                if (key.startsWith('interview-os-cache-')) {
                    sessionStorage.removeItem(key);
                }
            });

            // Re-run the full analysis
            await handleAnalyze();
        } catch (e) {
            console.error("Regenerate all failed:", e);
        } finally {
            setIsRegeneratingAll(false);
        }
    };

    const recipeContext = {
        hasResume: !!resume,
        hasApiKeys: true,
        storyCount: stories.length,
    };

    const applyCachedPlanData = (cached: Awaited<ReturnType<typeof loadEnhancedCache>>) => {
        if (!cached) return;
        const hasUserContext = resumeRef.current.length > 50;
        const shouldUseCache = (cached.hasContext === hasUserContext) && (!hasUserContext || (hasUserContext && cached.matchData));
        setReconData(cached.reconData);
        setQuestionsData(cached.questionsData);
        setReverseData(cached.reverseData);
        setTechnicalData(cached.technicalData);
        setCodingChallenges(cached.codingChallenges || []);
        setSystemDesignData(cached.systemDesignData);
        if (shouldUseCache) {
            setMatchData(cached.matchData);
            setResultsHaveResumeContext(!!cached.hasContext);
        } else {
            setMatchData(null);
            setResultsHaveResumeContext(false);
        }
        setViewState("dashboard");
    };

    const handleOpenPackage = async (item: CachedPlanListItem) => {
        setCompany(item.company);
        setPosition(item.position);
        setRound(item.round);
        setSearchQuery(`${item.company}, ${item.position}, ${item.round}`);
        setHasSearched(true);
        setPrepPhase("package");

        const cached = await loadEnhancedCache(item.company, item.position, item.round);
        applyCachedPlanData(cached);
    };

    const handleResumeSession = async (planCacheKey: string) => {
        const session = resumableSessions.find((s) => s.planCacheKey === planCacheKey);
        if (!session) return;
        const plan = cachedPlans.find((p) => p.cacheKey === planCacheKey);
        if (plan) {
            await handleOpenPackage(plan);
        } else {
            setCompany(session.company);
            setPosition(session.position);
            setRound(session.round);
            setSearchQuery(`${session.company}, ${session.position}, ${session.round}`);
            setHasSearched(true);
            setPrepPhase("package");
            const cached = await loadEnhancedCache(session.company, session.position, session.round);
            applyCachedPlanData(cached);
        }
    };

    const handleRecipeSelect = (recipe: Recipe) => {
        switch (recipe.type) {
            case "navigate":
                if (recipe.navigateTo) router.push(recipe.navigateTo);
                break;
            case "dialog":
                if (recipe.id === "setup") setSetupRecipeOpen(true);
                if (recipe.id === "build-stories") setStoryRecipeOpen(true);
                if (recipe.id === "add-sources") setSourcesRecipeOpen(true);
                break;
            case "action":
                if (recipe.id === "prepare-interview") setPrepareRecipeOpen(true);
                break;
        }
    };

    if (!isAuthChecked) {
        return <LoadingState message="Verifying session..." />;
    }

    // Removed blocking check for user/guest to allow open access

    if (!hasSearched) {
        let mainContent: ReactNode;

        if (prepPhase === "landing" && !showSearchPlans) {
            mainContent = (
                <PrepLanding
                    cachedPlans={cachedPlans}
                    resumableSessions={resumableSessions}
                    onStartNew={() => {
                        setPrepJobContext(emptyPrepJobContext("", "", ""));
                        setPrepPhase("setup");
                    }}
                    onSearch={() => setShowSearchPlans(true)}
                    onResume={handleResumeSession}
                    onOpenPackage={handleOpenPackage}
                />
            );
        } else if (prepPhase === "setup") {
            mainContent = (
                <PrepSetupFlow
                    jobContext={prepJobContext}
                    onJobContextChange={setPrepJobContext}
                    prepSettings={prepSettings}
                    onPrepSettingsChange={setPrepSettings}
                    resume={resume}
                    stories={stories}
                    sources={sources}
                    isFetchingJob={isFetchingJob}
                    onFetchJobContext={async () => {
                        const url = prepJobContext.identity.sourceUrl;
                        if (!url) return;
                        setIsFetchingJob(true);
                        setSearchError(null);
                        try {
                            const res = await fetchUrlContent(url);
                            if (res.data) {
                                setPrepJobContext((ctx) => ({
                                    ...ctx,
                                    content: { ...ctx.content, originalJd: res.data },
                                }));
                                const parsed = await parseSearchQuery(
                                    `Extract company name and job title from: ${res.data.substring(0, 1000)}`,
                                );
                                if (parsed?.company && parsed?.position) {
                                    setPrepJobContext((ctx) => ({
                                        ...ctx,
                                        identity: {
                                            ...ctx.identity,
                                            companyName: parsed.company,
                                            jobTitle: parsed.position,
                                        },
                                    }));
                                }
                            } else {
                                setSearchError(res.error || "Failed to fetch job posting");
                            }
                        } catch {
                            setSearchError("Failed to fetch job posting");
                        } finally {
                            setIsFetchingJob(false);
                        }
                    }}
                    onContinue={() => {
                        const { companyName, jobTitle } = prepJobContext.identity;
                        const roundVal = prepJobContext.interview.round;
                        setCompany(companyName);
                        setPosition(jobTitle);
                        setRound(roundVal);
                        setJobUrl(prepJobContext.identity.sourceUrl ?? "");
                        setJobContext(prepJobContext.content.originalJd ?? "");
                        if (companyName || jobTitle || roundVal) {
                            setSearchQuery([companyName, jobTitle, roundVal].filter(Boolean).join(", "));
                        }
                        setPrepPhase("mode");
                    }}
                    onBack={() => setPrepPhase("landing")}
                />
            );
        } else if (prepPhase === "mode") {
            mainContent = loading ? (
                <div className="w-full max-w-2xl flex flex-col items-center py-12">
                    <LoadingState message={loadingText || LOADING_STEPS.generating} />
                </div>
            ) : (
                <PrepModeSelection
                    jobContext={prepJobContext}
                    isAuthenticated={!!user}
                    onSelectMode={handlePrepModeSelect}
                    onBack={() => setPrepPhase("setup")}
                />
            );
        } else if (prepPhase === "session") {
            mainContent = (
                <div className="w-full max-w-2xl">
                    <LoadingState message="Preparing your session…" />
                </div>
            );
        } else {
            mainContent = (
                <div className={`w-full max-w-2xl transition-all duration-500 ${loading ? 'opacity-50' : ''}`}>
                    {showSearchPlans && (
                        <div className="mb-6">
                            <Button variant="ghost" size="sm" onClick={() => setShowSearchPlans(false)} className="-ml-2">
                                Back
                            </Button>
                        </div>
                    )}
                    {/* Title — the single BETA badge lives in the sidebar lockup (AppShell). */}
                    <div className="mb-12 text-center">
                        <div className="mb-3">
                            <h1 className="text-[40px] sm:text-[56px] font-semibold tracking-tighter leading-none">
                                Intervu
                            </h1>
                        </div>
                        <p className="text-muted-foreground text-base">
                            Your job application workspace
                        </p>
                    </div>

                    <MotivationalBanner />

                    <div className="group relative">
                        {/* Left side: PrepSettings icon */}
                        <div data-tour="prep-settings" className="absolute left-3 inset-y-0 flex items-center">
                            <PrepSettings
                                settings={prepSettings}
                                onChange={setPrepSettings}
                                jobUrl={jobUrl}
                                onJobUrlChange={setJobUrl}
                                jobContext={jobContext}
                                onJobContextChange={setJobContext}
                                isFetchingJob={isFetchingJob}
                                onFetchJobContext={handleFetchJobContext}
                            />
                        </div>
                        <Input
                            data-tour="search-input"
                            type="text"
                            placeholder="e.g. Google PM final round"
                            className="h-14 text-base border-border/50 focus-visible:border-foreground bg-transparent pl-12 pr-14 transition-colors"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
                            autoFocus
                            disabled={loading}
                        />
                        {/* Right side: submit arrow */}
                        <div className="absolute right-2 inset-y-0 flex items-center">
                            <button
                                data-tour="analyze-button"
                                onClick={() => handleAnalyze()}
                                disabled={loading}
                                className="group/btn flex items-center justify-center w-8 sm:w-auto sm:justify-start h-8 sm:px-2 rounded-md bg-brand text-brand-foreground disabled:opacity-50 hover:bg-brand/90 transition-all"
                            >
                                {loading ? (
                                    <div className="w-4 h-4 border-2 border-white/80 border-t-transparent rounded-full animate-spin" />
                                ) : (
                                    <ArrowRight weight="bold" size={18} className="shrink-0" />
                                )}
                                <span className="hidden sm:grid grid-cols-[0fr] group-hover/btn:grid-cols-[1fr] transition-all duration-200">
                                    <span className="overflow-hidden whitespace-nowrap text-sm font-medium pl-1.5">Analyze</span>
                                </span>
                            </button>
                        </div>
                    </div>

                    <div className="px-1 mt-3 mb-6">
                        <p className="text-muted-foreground/80 text-xs tracking-wide leading-relaxed">
                            Try &ldquo;Amazon SDE intern behavioral&rdquo; or &ldquo;McKinsey case interview&rdquo;
                        </p>
                    </div>

                    {/* Recipe Grid */}
                    <div className="mb-6">
                        <RecipeGrid context={recipeContext} onSelectRecipe={handleRecipeSelect} />
                    </div>

                    {/* Error Message */}
                    {searchError && (
                        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm mb-4 animate-in fade-in slide-in-from-top-1">
                            <WarningCircle size={18} weight="fill" />
                            <span>{searchError}</span>
                        </div>
                    )}

                </div>
            );
        }

        return (
            <div className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-6 bg-background transition-all duration-500">
                {/* Top Right Actions */}
                <div className="absolute top-4 right-4 flex items-center gap-2">
                </div>
                <AuthPopover
                    open={authPopoverOpen}
                    onOpenChange={(open) => {
                        if (!open && !authedPrepRef.current) {
                            pendingPrepRef.current = clearPendingPrep(pendingPrepRef.current);
                        }
                        setAuthPopoverOpen(open);
                    }}
                    onAuthed={() => {
                        authedPrepRef.current = true;
                        maybeReplayPrepStart();
                    }}
                    showTrigger={false}
                />

                {mainContent}

                {/* Footer hint */}
                {(prepPhase === "landing" && !showSearchPlans) || showSearchPlans ? (
                    <div className="mt-8 flex flex-col items-center gap-2 text-muted-foreground text-xs">
                        {showSearchPlans && (
                            <span>Press <kbd className="px-1.5 py-0.5 border border-border rounded">Enter</kbd> to begin</span>
                        )}
                        {!user && (
                            <button
                                onClick={() => setAuthPopoverOpen(true)}
                                className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                            >
                                Log in to save your progress across devices
                            </button>
                        )}
                    </div>
                ) : null}

                <ContextModal
                    isOpen={isContextOpen}
                    onClose={() => setIsContextOpen(false)}
                    context={context}
                    setContext={setContext}
                    onSave={handleSaveContext}
                />

                {/* Recipe Wizards */}
                <SetupRecipeWizard
                    isOpen={setupRecipeOpen}
                    dismissCount={setupDismissCountRef.current}
                    onClose={() => {
                        setSetupRecipeOpen(false);
                        localStorage.setItem('intervu-welcome-dismissed', 'true');
                    }}
                    resume={resume}
                    onResumeChange={setResume}
                    stories={stories}
                    onStoriesChange={setStories}
                />
                <StoryBankRecipeWizard
                    isOpen={storyRecipeOpen}
                    onClose={() => setStoryRecipeOpen(false)}
                    stories={stories}
                    onStoriesChange={setStories}
                />
                <PrepareInterviewDialog
                    isOpen={prepareRecipeOpen}
                    onClose={() => setPrepareRecipeOpen(false)}
                    onSubmit={(query: string) => {
                        setPrepareRecipeOpen(false);
                        setSearchQuery(query);
                        setTimeout(() => handleAnalyze(), 100);
                    }}
                />
                <AddSourcesRecipeDialog
                    isOpen={sourcesRecipeOpen}
                    onClose={() => setSourcesRecipeOpen(false)}
                    sources={sources}
                    onSourcesChange={setSources}
                />
            </div >
        );
    }



    // ... existing code ...

    // Sidebar Groups (collapsible)
    const sidebarGroups = [
        {
            id: "group-strategy",
            label: "Strategy",
            children: [
                { id: "section-match", label: "Tell Me About Yourself", icon: UserIcon },
                { id: "section-questions", label: "Questions", icon: Question },
                { id: "section-reverse", label: "Reverse Questions", icon: ChatCircleDots },
                { id: "section-starred", label: "Starred", icon: Star },
            ]
        },
        {
            id: "group-knowledge",
            label: "Knowledge",
            children: [
                { id: "section-knowledge", label: "External Sources", icon: Globe },
                { id: "section-stories", label: "STAR Stories", icon: BookOpen },
            ]
        },
        ...(isTechnicalRole ? [{
            id: "group-technical",
            label: "Technical",
            children: [
                { id: "section-technical", label: "Technical Concepts", icon: GraduationCap },
                { id: "section-coding", label: "Coding Workspace", icon: Code },
                { id: "section-system-design", label: "System Design", icon: Lightbulb },
            ]
        }] : [])
    ];

    return (
        <PageLayout
            fullWidth
            header={
                <Header
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                    onAnalyze={() => handleAnalyze(false)}
                    isAnalyzing={loading}
                    onExportPDF={() => setIsExportingPDF(true)}
                    isExportingPDF={isExportingPDF}
                    onReset={handleReset}
                    error={error || searchError}
                    user={user}
                    title="Intervu"
                    onOpenSidebar={() => setIsMobileSidebarOpen(prev => !prev)}
                    onRegenerateAll={() => handleAnalyze(true)}
                    isRegeneratingAll={isRegeneratingAll}
                    prepSettings={prepSettings}
                    onPrepSettingsChange={setPrepSettings}
                    jobUrl={jobUrl}
                    onJobUrlChange={setJobUrl}
                    jobContext={jobContext}
                    onJobContextChange={setJobContext}
                    isFetchingJob={isFetchingJob}
                    onFetchJobContext={handleFetchJobContext}
                    hasPendingChanges={hasPendingChanges}
                />
            }
            className="w-full"
        >
            {viewState === "empty" && (
                <>
                    <PrivacyNotice />
                    <EmptyState />
                    <div className="max-w-3xl mx-auto px-4 pb-12">
                        <RecipeGrid context={recipeContext} onSelectRecipe={handleRecipeSelect} />
                    </div>
                </>
            )}
            {viewState === "loading" && (
                <div className="flex flex-col items-center justify-center space-y-6 py-20 animate-in fade-in">
                    <LoadingState message={loadingText} />
                    <div className="w-full max-w-sm">
                        <ProgressBar progress={progress} />
                    </div>
                </div>
            )}
            {viewState === "error" && (
                <div className="flex flex-col items-center justify-center py-20 animate-in fade-in">
                    <div className="border border-destructive/20 bg-destructive/5 text-destructive px-6 py-5 rounded-lg max-w-lg w-full">
                        <h3 className="font-semibold text-base mb-2 text-center">Analysis Error</h3>
                        <p className="text-sm opacity-90 mb-4 text-center">{error || "Something went wrong."}</p>

                        {/* Action buttons */}
                        <div className="flex flex-col gap-2">
                            <Button
                                variant="outline"
                                className="w-full bg-background hover:bg-destructive/5 border-destructive/20"
                                onClick={() => {
                                    setError(null);
                                    setViewState("empty");
                                    handleAnalyze();
                                }}
                            >
                                Try Again
                            </Button>

                            <Button
                                variant="ghost"
                                className="w-full text-muted-foreground"
                                onClick={() => setViewState("empty")}
                            >
                                Go Back
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {viewState === "dashboard" && (
                <div className="w-full px-6 md:px-8 pt-4 pb-8 animate-in fade-in duration-500">
                    {/* Three-Column Layout: Sidebar | Main | Recon */}
                    <div className="flex flex-col lg:flex-row gap-4 relative lg:h-[calc(100vh-5rem)] lg:overflow-hidden">
                        {/* Left Sidebar - Navigation */}
                        <DashboardSidebar
                            activeSection={activeSection}
                            onSelectSection={setActiveSection}
                            groups={sidebarGroups}
                            bottomContent={reconData ? (
                                <CompanyRecon
                                    data={reconData}
                                />
                            ) : null}
                            isOpen={isMobileSidebarOpen}
                            onClose={() => setIsMobileSidebarOpen(false)}
                        />

                        {/* Center Column - Interview Content */}
                        <div ref={centerColumnRef} className="flex-1 min-w-0 space-y-4 lg:h-[calc(100vh-5rem)] lg:overflow-y-auto lg:custom-scrollbar">

                            {/* Context Badges - Indicators of what's fueling the AI */}
                            <div className="flex items-center gap-2 px-1 flex-wrap">
                                {/* Context chips use the shared status-token palette (lib/ui/status-tokens.ts)
                                    so the three context types stay visually distinct AND legible in dark mode. */}
                                {resume && resume.length > 50 && (
                                    <div className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium shadow-sm", STATUS_PILL.applied)}>
                                        <FileText size={12} weight="fill" />
                                        <span>Resume Context</span>
                                    </div>
                                )}
                                {jobContext && jobContext.length > 20 && (
                                    <div className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium shadow-sm", STATUS_PILL.offer)}>
                                        <LinkIcon size={12} weight="bold" />
                                        <span>Job Post Context</span>
                                    </div>
                                )}
                                <div className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium shadow-sm", STATUS_PILL.intv)}>
                                    <Globe size={12} weight="fill" />
                                    <span>Web Knowledge</span>
                                </div>
                                {!user && (
                                    <button
                                        onClick={() => setAuthPopoverOpen(true)}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/50 text-muted-foreground text-[10px] font-medium border border-border/50 hover:bg-muted hover:text-foreground transition-colors"
                                    >
                                        <Plugs size={12} />
                                        <span>Log in to save this prep</span>
                                    </button>
                                )}
                            </div>

                            {/* Match Section - Always mounted, hidden when not active */}
                            <div
                                id="section-match"
                                className={activeSection === "section-match" ? "animate-in fade-in slide-in-from-bottom-4 duration-500" : "hidden"}
                            >
                                {matchData ? (
                                    <MatchSection
                                        data={matchData}
                                        onAddMatch={handleAddMatch}
                                        onRemoveMatch={handleRemoveMatch}
                                        allowedMatches={resumeCompanies}
                                        jobContext={jobContext}
                                    />
                                ) : loading || isRegeneratingMatch ? (
                                    /* Loading state - show skeleton while fetching */
                                    <SectionLoader message="Generating your personalized match strategy..." />
                                ) : resume.length > 20 ? (
                                    /* Has resume but no match data - something went wrong */
                                    <section className="animate-in fade-in pt-6">
                                        <div className="flex items-center gap-3 mb-6">
                                            <div className="w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center text-brand">
                                                <UserIcon size={20} weight="fill" />
                                            </div>
                                            <div>
                                                <h2 className="text-xl font-semibold">Match Strategy</h2>
                                                <p className="text-sm text-muted-foreground">Your pitch, tailored to the role</p>
                                            </div>
                                        </div>
                                        <div className="flex flex-col items-center justify-center py-8 px-6 bg-muted/20 rounded-xl border border-dashed border-border">
                                            <p className="text-sm text-muted-foreground text-center mb-4">
                                                Strategy not generated yet. Click below to generate a personalized match strategy.
                                            </p>
                                            <Button
                                                variant="default"
                                                onClick={async () => {
                                                    if (!company || !position || !round) return;
                                                    setIsRegeneratingMatch(true);
                                                    try {
                                                        const storiesText = getStoriesContext();
                                                        // Pass empty array for companies to allow AI to select best matches
                                                        const res = await fetchMatch(company, position, round, resume, storiesText, getSourcesContext(), jobContext, modelConfig, []);
                                                        if (res.data) setMatchData(res.data);
                                                    } catch (e) {
                                                        console.error("Failed to generate match:", e);
                                                    } finally {
                                                        setIsRegeneratingMatch(false);
                                                    }
                                                }}
                                                disabled={isRegeneratingMatch}
                                            >
                                                {isRegeneratingMatch ? "Generating..." : "Generate Strategy"}
                                            </Button>
                                        </div>
                                    </section>
                                ) : (
                                    /* No resume - show prompt to add one */
                                    <section className="animate-in fade-in pt-6">
                                        <div className="flex items-center gap-3 mb-6">
                                            <div className="w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center text-brand">
                                                <UserIcon size={20} weight="fill" />
                                            </div>
                                            <div>
                                                <h2 className="text-xl font-semibold">Match Strategy</h2>
                                                <p className="text-sm text-muted-foreground">Your pitch, tailored to the role</p>
                                            </div>
                                        </div>
                                        <div className="flex flex-col items-center justify-center py-16 px-6 bg-muted/20 rounded-xl border border-dashed border-border">
                                            <WarningCircle size={48} className="text-muted-foreground/50 mb-4" />
                                            <h3 className="text-lg font-semibold mb-2">Resume Required</h3>
                                            <p className="text-sm text-muted-foreground text-center max-w-md mb-6">
                                                Add your resume in the Resume Builder to generate a personalized match strategy for this role.
                                            </p>
                                            <Link href="/resume-builder">
                                                <Button variant="default">
                                                    <FileText size={16} className="mr-2" />
                                                    Go to Resume Builder
                                                </Button>
                                            </Link>
                                        </div>
                                    </section>
                                )}
                            </div>

                            {/* STAR Stories Section */}
                            {activeSection === "section-stories" && (
                                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                    <div className="flex items-center justify-between mb-2">
                                        <div>
                                            <h2 className="text-2xl font-bold tracking-tight">STAR Stories</h2>
                                            <p className="text-muted-foreground">Manage your behavioral interview stories</p>
                                        </div>
                                    </div>
                                    <StoryManager
                                        stories={stories}
                                        onChange={(newStories) => {
                                            setStories(newStories);
                                            // Auto-save happens via existing effect on stories
                                            saveStories(newStories);
                                        }}
                                    />
                                </div>
                            )}

                            {/* Knowledge Sources Section */}
                            {activeSection === "section-knowledge" && (
                                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                    <div className="flex items-center justify-between mb-2">
                                        <div>
                                            <h2 className="text-2xl font-bold tracking-tight">Knowledge Sources</h2>
                                            <p className="text-muted-foreground">Manage context documents and URLs for the AI</p>
                                        </div>
                                    </div>
                                    <SourcesManager
                                        sources={sources}
                                        onChange={(newSources) => {
                                            setSources(newSources);
                                        }}
                                    />
                                </div>
                            )}

                            {/* Questions Grid - Always mounted, hidden when not active */}
                            <div
                                id="section-questions"
                                className={activeSection === "section-questions" ? "animate-in fade-in slide-in-from-bottom-4 duration-500" : "hidden"}
                            >
                                {questionsData ? (
                                    <QuestionsGrid
                                        questions={[
                                            ...questionsData.questions,
                                            ...(systemDesignData?.questions || [])
                                        ]}
                                        onGenerateStrategy={handleGenerateStrategy}
                                        company={company}
                                        position={position}
                                        round={round}
                                        favoritedMap={favoritedMap}
                                        onToggleFavorite={handleToggleFavorite}
                                        isLoggedIn={!!user}
                                        onRequireAuth={() => setAuthPopoverOpen(true)}
                                    />
                                ) : (
                                    <SectionLoader message="Loading interview questions..." />
                                )}
                            </div>

                            {/* Starred Questions Section */}
                            {activeSection === "section-starred" && (
                                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                                    <StarredQuestionsSection isLoggedIn={!!user} />
                                </div>
                            )}

                            {/* Technical Knowledge Section - Always mounted when applicable */}
                            {(isTechnicalRole || technicalData) && (
                                <div
                                    id="section-knowledge"
                                    className={activeSection === "section-knowledge" ? "animate-in fade-in slide-in-from-bottom-4 duration-500" : "hidden"}
                                >
                                    {technicalData ? (
                                        <>
                                            <div className="flex items-center gap-3 mb-6">
                                                <div className="w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center text-brand">
                                                    <GraduationCap size={20} weight="fill" />
                                                </div>
                                                <div>
                                                    <h2 className="text-xl font-semibold">Technical Knowledge</h2>
                                                    <p className="text-sm text-muted-foreground">Key concepts to review for this role</p>
                                                </div>
                                            </div>
                                            <KnowledgeSection
                                                data={technicalData}
                                                onExplain={async (q) => {
                                                    return await explainTechnicalConcept(q);
                                                }}
                                            />
                                        </>
                                    ) : (
                                        <SectionLoader message="Loading technical knowledge areas..." />
                                    )}
                                </div>
                            )}

                            {/* Coding Live Workspace - Only show for confirmed technical roles */}
                            {(isTechnicalRole) && (
                                <div
                                    id="section-coding"
                                    className={activeSection === "section-coding" ? "animate-in fade-in slide-in-from-bottom-4 duration-500" : "hidden"}
                                >
                                    {codingChallenges.length > 0 ? (
                                        <>
                                            <div className="flex items-center gap-3 mb-6">
                                                <div className="w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center text-brand">
                                                    <Code size={20} weight="fill" />
                                                </div>
                                                <div>
                                                    <h2 className="text-xl font-semibold">Coding Workspace</h2>
                                                    <p className="text-sm text-muted-foreground">{codingChallenges.length} coding challenge{codingChallenges.length !== 1 ? 's' : ''}</p>
                                                </div>
                                            </div>
                                            <CodingWorkspace challenges={codingChallenges} />
                                        </>
                                    ) : (
                                        <SectionLoader message="Generating coding challenge..." />
                                    )}
                                </div>
                            )}

                            {/* Reverse Questions - Always mounted */}
                            <div
                                id="section-reverse"
                                className={activeSection === "section-reverse" ? "animate-in fade-in slide-in-from-bottom-4 duration-500" : "hidden"}
                            >
                                {reverseData ? (
                                    <ReverseQuestions
                                        questions={reverseData.reverse_questions}
                                    />
                                ) : (
                                    <SectionLoader message="Generating questions to ask the interviewer..." />
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <ContextModal
                isOpen={isContextOpen}
                onClose={() => setIsContextOpen(false)}
                context={context}
                setContext={setContext}
                onSave={handleSaveContext}
            />

            {/* Coding Count Dialog */}
            <CodingCountDialog
                open={codingCountDialogOpen}
                onConfirm={(count) => {
                    setCodingCountDialogOpen(false);
                    codingCountResolverRef.current?.(count);
                    codingCountResolverRef.current = null;
                }}
                onSkip={() => {
                    setCodingCountDialogOpen(false);
                    codingCountResolverRef.current?.(0);
                    codingCountResolverRef.current = null;
                }}
            />
        </PageLayout>
    );
}
