import { ChatCircleDots, CaretLeft, CaretRight, Lightning, ArrowsClockwise, CircleNotch, BookOpen, Code, Users, Briefcase, Icon, Network, SpeakerHigh, Microphone, Star } from "@phosphor-icons/react";
import { useSpeechToText } from "@/hooks/use-speech-to-text";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import MarkdownIt from "markdown-it";
import { QuestionItem, CompanyReconData, QuestionsData } from "@/types";
import { cn } from "@/lib/utils";
import { DashboardSection } from "./DashboardSection";
import { toast } from "@/lib/toast";
import { classifySentinel, sentinelMessage } from "@/lib/llm/sentinels";
import { STATUS_PILL, difficultyTone } from "@/lib/ui/status-tokens";
import type {
    PrepSessionMode,
    PrepSessionAction,
    PrepSessionQuestionProgress,
} from "@/lib/prep/session-progress";
import { isRevealGenerationFailure } from "@/lib/prep/session-progress";

interface QuestionsGridProps {
    questions: QuestionItem[];
    onGenerateStrategy: (index: number, question: QuestionItem) => Promise<string>;
    company: string;
    position: string;
    round: string;
    reconData?: CompanyReconData;
    favoritedMap?: Record<string, string>;
    onToggleFavorite?: (question: string, isFavorited: boolean, favoriteId?: string) => void;
    isLoggedIn?: boolean;
    /** Open the login popover when an AI action returns AUTH_REQUIRED. */
    onRequireAuth?: () => void;
    sessionMode?: PrepSessionMode;
    sessionQuestionIds?: string[];
    sessionIndex?: number;
    onSessionIndexChange?: (index: number) => void;
    externalDispatch?: (action: PrepSessionAction) => void;
    sessionProgress?: Record<string, PrepSessionQuestionProgress>;
    jobContextText?: string;
    onSessionContinue?: () => void;
}

import { generateAnswerCritique } from "@/actions/generate-context";
import { AnswerCritique } from "@/types";
import { Textarea } from "@/components/ui/textarea";

export function QuestionsGrid({
    questions,
    onGenerateStrategy,
    company,
    position,
    round,
    reconData,
    favoritedMap = {},
    onToggleFavorite,
    isLoggedIn = false,
    onRequireAuth,
    sessionMode,
    sessionQuestionIds,
    sessionIndex,
    onSessionIndexChange,
    externalDispatch,
    sessionProgress,
    jobContextText,
    onSessionContinue,
}: QuestionsGridProps) {
    const isSessionMode = sessionMode !== undefined;
    // Strategies stored by Question ID
    const [strategies, setStrategies] = useState<{ [key: string]: string }>({});
    const [loadingStrategies, setLoadingStrategies] = useState<{ [key: string]: boolean }>({});

    // Practice Mode State
    const [isPracticeMode, setIsPracticeMode] = useState(false);
    const [userAnswers, setUserAnswers] = useState<{ [key: string]: string }>({});
    const [critiques, setCritiques] = useState<{ [key: string]: AnswerCritique }>({});
    const [isAnalyzing, setIsAnalyzing] = useState<{ [key: string]: boolean }>({});

    // Voice State
    const [isSpeaking, setIsSpeaking] = useState(false);
    // const [isListening, setIsListening] = useState(false); // Managed by hook now
    const [selectedVoice, setSelectedVoice] = useState<string>("");
    const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);

    // --- HOISTED STATE & MEMOS ---

    // Carousel State
    const [currentIndex, setCurrentIndex] = useState(0);
    const [activeTab, setActiveTab] = useState<QuestionItem['category'] | 'All'>('All');

    // Helper for Title Case
    const toTitleCase = (str: string) => {
        return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
    };

    // Dynamic Categories Logic
    const presentCategories = useMemo(() => {
        const cats = new Set(questions.map(q => q.category).filter(Boolean));
        return Array.from(cats);
    }, [questions]);

    // Icon Mapping
    const iconMap: Record<string, Icon> = {
        'Behavioral': Users,
        'Knowledge': BookOpen,
        'Coding': Code,
        'Case Study': Briefcase,
        'System Design': Network,
        'Product Management': Briefcase,
        'Pm': Briefcase,
        'Execution': Lightning,
        'Technical': Code,
        'Strategy': ArrowsClockwise,
        'General': ChatCircleDots,
        'Leadership': Users,
    };

    const categories: { id: QuestionItem['category'] | 'All', label: string, icon: Icon }[] = useMemo(() => {
        const dynamicCats = presentCategories.map(cat => {
            if (!cat) return null;
            const normalizedTitle = toTitleCase(cat);
            let label = normalizedTitle;
            if (normalizedTitle === 'Pm') label = 'Product Management';
            if (label === 'Product Management') label = 'PM';
            const IconComponent = iconMap[cat] || iconMap[normalizedTitle] || Lightning;
            return { id: cat, label: normalizedTitle, icon: IconComponent };
        }).filter((c): c is { id: string, label: string, icon: Icon } => c !== null);

        return [{ id: 'All', label: 'All', icon: Lightning }, ...dynamicCats.sort((a, b) => a.label.localeCompare(b.label))];
    }, [presentCategories]);

    const sessionOrderedQuestions = useMemo(() => {
        if (!sessionQuestionIds) return questions;
        const byId = new Map(questions.map((q) => [q.id, q]));
        return sessionQuestionIds
            .map((id) => byId.get(id))
            .filter((q): q is QuestionItem => !!q);
    }, [questions, sessionQuestionIds]);

    // Filter Logic
    const filteredQuestions = useMemo(() => {
        if (isSessionMode) return sessionOrderedQuestions;
        if (activeTab === 'All') return questions;
        return questions.filter(q => q.category === activeTab);
    }, [questions, activeTab, isSessionMode, sessionOrderedQuestions]);

    const effectiveIndex = isSessionMode && sessionIndex !== undefined ? sessionIndex : currentIndex;
    const currentQuestion = filteredQuestions[effectiveIndex];
    const hasNext = effectiveIndex < filteredQuestions.length - 1;
    const hasPrev = effectiveIndex > 0;
    const effectivePracticeMode = isSessionMode ? sessionMode === "practice" : isPracticeMode;

    const handleSkipPracticeQuestion = useCallback(() => {
        if (!currentQuestion) return;
        externalDispatch?.({ type: "SKIP", questionId: currentQuestion.id });
        onSessionContinue?.();
    }, [currentQuestion, externalDispatch, onSessionContinue]);

    // Reset carousel index when category changes
    useEffect(() => {
        if (!isSessionMode) setCurrentIndex(0);
    }, [activeTab, isSessionMode]);

    // Hydrate session progress from persisted state
    useEffect(() => {
        if (!sessionProgress) return;
        const answers: { [key: string]: string } = {};
        const crits: { [key: string]: AnswerCritique } = {};
        const restoredStrategies: { [key: string]: string } = {};
        for (const [id, progress] of Object.entries(sessionProgress)) {
            if (progress.answerText) answers[id] = progress.answerText;
            if (progress.critique) crits[id] = progress.critique;
            if (progress.revealedContent) restoredStrategies[id] = progress.revealedContent;
        }
        setUserAnswers((prev) => ({ ...answers, ...prev }));
        setCritiques((prev) => ({ ...crits, ...prev }));
        if (Object.keys(restoredStrategies).length > 0) {
            setStrategies((prev) => ({ ...restoredStrategies, ...prev }));
        }
    }, [sessionProgress]);

    // Stop speaking when question changes
    useEffect(() => {
        if (isSpeaking) {
            window.speechSynthesis.cancel();
            setIsSpeaking(false);
        }
    }, [effectiveIndex, activeTab]);

    // --- END HOISTED ---

    // --- END HOISTED ---

    const handleSpeak = (text: string) => {
        if ('speechSynthesis' in window) {
            if (isSpeaking) {
                window.speechSynthesis.cancel();
                setIsSpeaking(false);
            } else {
                // Get available voices
                const voices = window.speechSynthesis.getVoices();

                // Prioritize "natural" sounding voices
                // 1. Google US English (often very good)
                // 2. Any "Premium" or "Enhanced" voice (Mac specific)
                // 3. Default
                const preferredVoice = voices.find(v => v.name.includes("Google US English"))
                    || voices.find(v => v.name.includes("Premium"))
                    || voices.find(v => v.name.includes("Enhanced"))
                    || voices.find(v => v.lang === 'en-US');

                const utterance = new SpeechSynthesisUtterance(text);
                if (preferredVoice) {
                    utterance.voice = preferredVoice;
                }

                utterance.rate = 1.0;
                utterance.pitch = 1.0;

                utterance.onend = () => setIsSpeaking(false);
                window.speechSynthesis.speak(utterance);
                setIsSpeaking(true);
            }
        }
    };

    // --- Voice Hook ---
    const { isListening, isProcessing, startListening, stopListening, error: voiceError } = useSpeechToText({
        onResult: (text) => {
            if (currentQuestion) {
                setUserAnswers(prev => ({
                    ...prev,
                    [currentQuestion.id]: (prev[currentQuestion.id] || "") + " " + text
                }));
            }
        },
        onError: (err) => {
            toast.error(`Voice input error: ${err}`);
        }
    });

    const toggleListening = () => {
        if (isListening) {
            stopListening();
        } else {
            startListening();
        }
    };



    const handleAnalyzeAnswer = async (question: QuestionItem) => {
        const answer = userAnswers[question.id];
        if (!answer || answer.trim().length < 10) {
            toast.info("Please provide a longer answer (at least 10 characters) to get a proper critique.");
            return;
        }

        setIsAnalyzing(prev => ({ ...prev, [question.id]: true }));
        externalDispatch?.({ type: "SET_ANSWER", questionId: question.id, answerText: answer });
        try {
            const res = await generateAnswerCritique(question, answer, {
                company,
                position,
                round,
                reconData,
                jobContextText,
            });
            if (res.data) {
                setCritiques(prev => ({ ...prev, [question.id]: res.data! }));
                externalDispatch?.({ type: "SET_CRITIQUE", questionId: question.id, critique: res.data });
            } else if (res.error) {
                // SECTION C sentinel UX: the cost/auth gate's prefixed errors come
                // through here verbatim. AUTH_REQUIRED → login popover; OUT_OF_CREDITS → toast.
                const sentinel = classifySentinel(res.error);
                if (sentinel === "auth") {
                    onRequireAuth?.();
                    toast.info(sentinelMessage(res.error) || "Sign in to use the built-in AI.");
                } else if (sentinel === "credits") {
                    toast.error(sentinelMessage(res.error), 7000);
                } else {
                    toast.error(`Analysis failed: ${res.error}`);
                }
            }
        } catch (e) {
            console.error(e);
            const sentinel = classifySentinel(e);
            if (sentinel === "auth") {
                onRequireAuth?.();
                toast.info(sentinelMessage(e) || "Sign in to use the built-in AI.");
            } else if (sentinel === "credits") {
                toast.error(sentinelMessage(e), 7000);
            } else {
                toast.error("An error occurred while analyzing the answer. Please try again.");
            }
        } finally {
            setIsAnalyzing(prev => ({ ...prev, [question.id]: false }));
        }
    };



    const md = new MarkdownIt({
        html: true,
        breaks: true,
        linkify: true,
    });

    const handleNext = () => {
        if (!hasNext) return;
        if (isSessionMode && onSessionIndexChange) {
            onSessionIndexChange(effectiveIndex + 1);
        } else {
            setCurrentIndex((prev) => prev + 1);
        }
    };

    const handlePrev = () => {
        if (!hasPrev) return;
        if (isSessionMode && onSessionIndexChange) {
            onSessionIndexChange(effectiveIndex - 1);
        } else {
            setCurrentIndex((prev) => prev - 1);
        }
    };

    // Expanded State
    const [isExpanded, setIsExpanded] = useState(false);

    // Reset expanded state when question changes
    useEffect(() => {
        setIsExpanded(false);
    }, [effectiveIndex, activeTab]);

    const toggleExpand = () => setIsExpanded(prev => !prev);

    // Keyboard navigation
    useEffect(() => {
        if (isSessionMode) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            // Avoid interfering with inputs if any
            if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;

            if (e.key === 'ArrowRight') handleNext();
            if (e.key === 'ArrowLeft') handlePrev();

            // Expand/Collapse with Space or Enter if focused or generally available
            // Arrow Down to expand, Arrow Up to collapse (optional)
            if (e.key === 'ArrowDown' || e.key === ' ') {
                if (hasStrategy && !isExpanded) {
                    setIsExpanded(true);
                    e.preventDefault();
                }
            }
            if (e.key === 'ArrowUp' || e.key === 'Escape') {
                if (hasStrategy && isExpanded) {
                    setIsExpanded(false);
                    e.preventDefault();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown as any);
        return () => window.removeEventListener('keydown', handleKeyDown as any);
    }, [hasNext, hasPrev, isSessionMode]);

    const handleStrategy = async (question: QuestionItem) => {
        if (strategies[question.id] || loadingStrategies[question.id]) {
            // If already generated, just expand
            if (strategies[question.id]) setIsExpanded(true);
            return;
        }

        setLoadingStrategies(prev => ({ ...prev, [question.id]: true }));
        try {
            const rawStrategy = await onGenerateStrategy(0, question);
            if (isRevealGenerationFailure(rawStrategy)) {
                const sentinel = classifySentinel(rawStrategy);
                if (sentinel === "auth") {
                    onRequireAuth?.();
                    toast.info(sentinelMessage(rawStrategy) || "Sign in to use the built-in AI.");
                } else if (sentinel === "credits") {
                    toast.error(sentinelMessage(rawStrategy), 7000);
                } else {
                    toast.error("Could not generate a suggested answer. Please try again.");
                }
                return;
            }
            const parsedStrategy = md.render(rawStrategy);
            setStrategies(prev => ({ ...prev, [question.id]: parsedStrategy }));
            setIsExpanded(true); // Auto-expand on success
            externalDispatch?.({
                type: "REVEAL",
                questionId: question.id,
                revealedContent: parsedStrategy,
            });
        } catch (e) {
            console.error(e);
            const sentinel = classifySentinel(e);
            if (sentinel === "auth") {
                onRequireAuth?.();
                toast.info(sentinelMessage(e) || "Sign in to use the built-in AI.");
            } else if (sentinel === "credits") {
                toast.error(sentinelMessage(e), 7000);
            } else {
                toast.error("Could not generate a suggested answer. Please try again.");
            }
        } finally {
            setLoadingStrategies(prev => ({ ...prev, [question.id]: false }));
        }
    };

    // Derived State for UI
    const isLoading = currentQuestion ? loadingStrategies[currentQuestion.id] : false;
    const hasStrategy = currentQuestion ? strategies[currentQuestion.id] : false;
    const userAnswer = currentQuestion ? userAnswers[currentQuestion.id] || "" : "";
    const critique = currentQuestion ? critiques[currentQuestion.id] : null;
    const analyzing = currentQuestion ? isAnalyzing[currentQuestion.id] : false;

    if (!currentQuestion) {
        return (
            <DashboardSection title="Questions for You" subtitle="Practice answering common interview questions" icon={ChatCircleDots}>
                <div className="text-center py-20 text-muted-foreground bg-muted/20 rounded-xl">
                    No questions found for this category.
                </div>
            </DashboardSection>
        );
    }

    // Session mode gets its own squared frame (docs-mockup.html Comp E2) with
    // no duplicate "Questions for You" chrome — PrepSessionView already
    // supplies the session's own title/counter above this. Outside a
    // session, this stays DashboardSection's existing rounded card unchanged.
    const cardInner = (
        <div className="relative group">
            <div
                className={cn(
                    "min-h-[320px] flex flex-col items-center text-center transition-all relative",
                    isSessionMode
                        ? "border border-border border-l-[3px] border-l-foreground bg-card p-5 md:p-6"
                        : "bg-muted/10 rounded-2xl p-4 md:p-5 shadow-[var(--shadow-sm)]",
                )}
            >

                    {/* Left/Right Nav - hidden in focused session mode */}
                    {!isSessionMode && (
                    <div className="absolute top-1/2 -translate-y-1/2 left-2 z-10 md:left-4">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-10 w-10 md:h-12 md:w-12 rounded-full hover:bg-background/80 hover:shadow-sm text-muted-foreground hover:text-foreground transition-all"
                            onClick={handlePrev}
                            disabled={!hasPrev}
                            aria-label="Previous question"
                        >
                            <CaretLeft size={20} className="md:w-6 md:h-6" />
                        </Button>
                    </div>
                    )}
                    {!isSessionMode && (
                    <div className="absolute top-1/2 -translate-y-1/2 right-2 z-10 md:right-4">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-10 w-10 md:h-12 md:w-12 rounded-full hover:bg-background/80 hover:shadow-sm text-muted-foreground hover:text-foreground transition-all"
                            onClick={handleNext}
                            disabled={!hasNext}
                            aria-label="Next question"
                        >
                            <CaretRight size={20} className="md:w-6 md:h-6" />
                        </Button>
                    </div>
                    )}

                    {/* Progress */}
                    {!isSessionMode && (
                    <div className="mb-4 flex items-center justify-center gap-2">
                        <span className="text-[10px] font-medium text-muted-foreground bg-background px-2 py-1 rounded-full shadow-sm">
                            {effectiveIndex + 1} / {filteredQuestions.length}
                        </span>
                        {currentQuestion.difficulty && (
                            <span className={cn(
                                "text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded-full",
                                // Token-backed difficulty colors (lib/ui/status-tokens.ts) — covers
                                // the full junior→director+ scale and is dark-mode correct.
                                STATUS_PILL[difficultyTone(currentQuestion.difficulty)],
                            )}>
                                {currentQuestion.difficulty}
                            </span>
                        )}
                    </div>
                    )}

                    {/* Question Header - Centered Content Area */}
                    <div className="relative mb-4 flex flex-col items-center gap-4 max-w-2xl px-8 md:px-12">
                        {/* Star / Favorite */}
                        <button
                            onClick={() => {
                                if (!currentQuestion) return;
                                const favId = favoritedMap[currentQuestion.question];
                                if (onToggleFavorite) {
                                    onToggleFavorite(currentQuestion.question, !!favId, favId);
                                }
                                externalDispatch?.({ type: "TOGGLE_STAR", questionId: currentQuestion.id });
                            }}
                            className="absolute -left-2 top-0 md:-left-8 p-2 rounded-full text-muted-foreground/40 hover:text-yellow-500 hover:bg-yellow-500/5 transition-colors"
                            title={favoritedMap[currentQuestion.question] ? "Unstar Question" : "Star Question"}
                            aria-label={favoritedMap[currentQuestion.question] ? "Unstar question" : "Star question"}
                        >
                            <Star size={18} weight={favoritedMap[currentQuestion.question] ? "fill" : "regular"} className={favoritedMap[currentQuestion.question] ? "text-yellow-500" : ""} />
                        </button>
                        {/* Read Aloud */}
                        <button
                            onClick={() => handleSpeak(currentQuestion.question)}
                            className="absolute -right-2 top-0 md:-right-8 p-2 rounded-full text-muted-foreground/40 hover:text-brand hover:bg-brand/5 transition-colors"
                            title={isSpeaking ? "Stop Speaking" : "Read Aloud"}
                            aria-label={isSpeaking ? "Stop reading question aloud" : "Read question aloud"}
                        >
                            <SpeakerHigh size={18} weight={isSpeaking ? "fill" : "regular"} className={isSpeaking ? "animate-pulse" : ""} />
                        </button>

                        {/* docs-mockup.html Comp E2 asks for a "FROM THE POSTING · …"
                            source line above the question, but `QuestionItem`
                            (types/index.ts) carries no per-question excerpt/quote
                            field to source it from — rendering one here would be a
                            fabricated line, not a restyle. Deliberately omitted;
                            wiring a real per-question source quote is a
                            data-layer follow-up (question generation would need
                            to persist which JD sentence prompted each question). */}
                        <h3 className="text-xl md:text-2xl font-medium leading-snug text-foreground tracking-tight">
                            {currentQuestion.question}
                        </h3>
                    </div>

                    {/* Action Area */}
                    <div className="mt-auto w-full mx-auto px-4 pb-4 max-w-3xl">
                        {effectivePracticeMode ? (
                            <div className="w-full text-left space-y-6 animate-in fade-in slide-in-from-bottom-4">
                                {!critique ? (
                                    <>
                                        <div className="relative pt-2">
                                            <div className="mb-2 ml-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                                Your Answer
                                            </div>
                                            <Textarea
                                                placeholder={`How would you answer this? (Speak naturally, focusing on ${company}'s context...)`}
                                                className="min-h-[150px] resize-none text-sm p-4 bg-background/50 focus-visible:ring-1 focus-visible:ring-brand/20 transition-all font-sans rounded-xl shadow-[var(--shadow-sm)]"
                                                value={userAnswer}
                                                onChange={(e) => setUserAnswers(prev => ({ ...prev, [currentQuestion.id]: e.target.value }))}
                                            />
                                            {/* Voice Input Button */}
                                            <button
                                                onClick={toggleListening}
                                                disabled={isProcessing}
                                                className={cn(
                                                    "absolute bottom-4 right-4 p-2 rounded-full transition-all shadow-sm z-10",
                                                    isListening
                                                        ? "bg-red-500 text-white animate-pulse"
                                                        : isProcessing
                                                            ? "bg-yellow-500/20 text-yellow-600 animate-pulse"
                                                            : "bg-background shadow-sm text-muted-foreground hover:text-foreground hover:shadow-md"
                                                )}
                                                title={isProcessing ? "Processing Audio..." : isListening ? "Stop Listening" : "Voice Input"}
                                                aria-label={isProcessing ? "Processing audio" : isListening ? "Stop voice input" : "Start voice input"}
                                            >
                                                {isProcessing ? (
                                                    <CircleNotch size={18} className="animate-spin" />
                                                ) : (
                                                    <Microphone size={18} weight={isListening ? "fill" : "regular"} />
                                                )}
                                            </button>
                                        </div>
                                        <div className="flex justify-between items-center gap-3">
                                            {isSessionMode && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={handleSkipPracticeQuestion}
                                                    className="text-xs text-muted-foreground hover:text-foreground"
                                                    data-testid="prep-practice-skip"
                                                >
                                                    Skip
                                                </Button>
                                            )}
                                            <div className={cn("flex justify-end", !isSessionMode && "w-full")}>
                                            <Button
                                                onClick={() => handleAnalyzeAnswer(currentQuestion)}
                                                disabled={analyzing || userAnswer.length < 10}
                                                className="bg-brand text-brand-foreground hover:bg-brand/90 disabled:opacity-50 shadow-sm transition-all text-xs font-semibold px-6 py-2 h-auto rounded-lg"
                                            >
                                                {analyzing ? (
                                                    <><CircleNotch className="animate-spin mr-2" /> Listening...</>
                                                ) : (
                                                    "How did I do?"
                                                )}
                                            </Button>
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    // Squared system (docs-mockup.html Comp E2 "critique block
                                    // structured WHAT LANDS / WHAT'S MISSING with mono labels
                                    // (green/rust)"): `reaction` (the real strength the model
                                    // names) → WHAT LANDS; `the_one_thing` (the real
                                    // highest-leverage gap) → WHAT'S MISSING. `say_it_like_this`/
                                    // `encouragement`/`scoreLabel` are real fields too — kept below,
                                    // not fabricated additions, just not part of the two-label frame.
                                    <div className="border border-border bg-card overflow-hidden animate-in fade-in zoom-in-95 duration-300">
                                        <div className="p-6 md:p-8">
                                            <div className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-verdict-live">
                                                What lands
                                            </div>
                                            <p className="mt-1.5 text-base md:text-lg leading-relaxed text-foreground font-medium whitespace-pre-line">
                                                {critique.reaction}
                                            </p>
                                            {isSessionMode && critique.scoreLabel && (
                                                <span className="inline-block mt-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-brand/70 bg-brand/10 px-2.5 py-1">
                                                    {critique.scoreLabel}
                                                </span>
                                            )}
                                        </div>

                                        {critique.the_one_thing && (
                                            <div className="border-t border-border px-6 md:px-8 py-6">
                                                <div className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-verdict-caution">
                                                    What&apos;s missing
                                                </div>
                                                <p className="mt-1.5 text-sm leading-relaxed text-foreground/80">
                                                    {critique.the_one_thing}
                                                </p>
                                            </div>
                                        )}

                                        {critique.say_it_like_this && (
                                            <div className="mx-6 md:mx-8 mb-6 border border-border/60 bg-background/70 p-5">
                                                <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                                                    Say it like this
                                                </div>
                                                <p className="text-sm leading-relaxed text-foreground/90 italic whitespace-pre-line">
                                                    &ldquo;{critique.say_it_like_this}&rdquo;
                                                </p>
                                            </div>
                                        )}

                                        {isSessionMode && critique.encouragement && (
                                            <div className="px-6 md:px-8 pb-6">
                                                <p className="text-sm text-foreground/70">
                                                    {critique.encouragement}
                                                </p>
                                            </div>
                                        )}

                                        <div className="px-6 md:px-8 py-5 border-t border-border flex items-center justify-between gap-4">
                                            {!isSessionMode && (
                                            <div className="flex items-center gap-3 min-w-0">
                                                {critique.scoreLabel && (
                                                    <span className="shrink-0 font-mono text-[10px] font-semibold uppercase tracking-wider text-brand/70 bg-brand/10 px-2.5 py-1">
                                                        {critique.scoreLabel}
                                                    </span>
                                                )}
                                                <p className="text-sm text-foreground/70 truncate">
                                                    {critique.encouragement}
                                                </p>
                                            </div>
                                            )}
                                            {isSessionMode ? (
                                                <div className="flex items-center justify-end gap-2 w-full">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => {
                                                            setCritiques(prev => {
                                                                const next = { ...prev };
                                                                delete next[currentQuestion.id];
                                                                return next;
                                                            });
                                                            externalDispatch?.({ type: "RETRY", questionId: currentQuestion.id });
                                                        }}
                                                        className="text-xs hover:text-brand"
                                                    >
                                                        Retry
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        onClick={() => onSessionContinue?.()}
                                                        className="text-xs bg-brand text-brand-foreground hover:bg-brand/90"
                                                    >
                                                        Continue
                                                    </Button>
                                                </div>
                                            ) : (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => setCritiques(prev => {
                                                        const next = { ...prev };
                                                        delete next[currentQuestion.id];
                                                        return next;
                                                    })}
                                                    className="text-xs shrink-0 hover:text-brand"
                                                >
                                                    Try again
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            // Existing "Learn" Mode (Reveal Answer)
                            !hasStrategy ? (
                                <Button
                                    size="lg"
                                    onClick={() => handleStrategy(currentQuestion)}
                                    disabled={isLoading}
                                    className="w-full md:w-auto px-8 relative overflow-hidden transition-all hover:scale-105 active:scale-95 shadow-md bg-foreground text-background hover:bg-foreground/90"
                                >
                                    {isLoading ? (
                                        <>
                                            <CircleNotch className="animate-spin mr-2" /> Generating Answer...
                                        </>
                                    ) : (
                                        <>
                                            <Lightning weight="fill" className="mr-2" /> Reveal Suggested Answer
                                        </>
                                    )}
                                </Button>
                            ) : (
                                <div className="w-full text-left animate-in slide-in-from-bottom-4 transition-all duration-300">
                                    <Button
                                        variant="outline"
                                        onClick={toggleExpand}
                                        className="w-full justify-between mb-2 group h-auto py-3 px-4 hover:bg-muted/30 rounded-xl shadow-sm"
                                    >
                                        <div className="flex items-center gap-2 text-brand font-semibold text-xs uppercase tracking-wider">
                                            <Lightning weight="fill" className={cn("transition-transform duration-300", isExpanded ? "rotate-180" : "")} />
                                            Suggested Answer
                                        </div>
                                        <span className="text-[10px] text-muted-foreground group-hover:text-brand transition-colors">
                                            {isExpanded ? "Collapse" : "Expand"}
                                        </span>
                                    </Button>

                                    {isExpanded && (
                                        <div className="bg-muted/30 rounded-xl p-6 animate-in fade-in zoom-in-95 duration-200 shadow-[var(--shadow-sm)]">
                                            <div
                                                className="prose prose-sm max-w-none dark:prose-invert
                                                prose-p:text-foreground/80 prose-p:leading-relaxed prose-p:my-2 prose-p:text-sm
                                                prose-strong:text-foreground prose-strong:font-semibold
                                                prose-headings:text-foreground prose-headings:font-bold prose-headings:mt-4 prose-headings:mb-2"
                                                dangerouslySetInnerHTML={{ __html: strategies[currentQuestion.id] }}
                                            />
                                        </div>
                                    )}
                                </div>
                            )
                        )}
                    </div>
                </div>

                {/* Context/Hint */}
                {!isSessionMode && (
                <div className="text-center mt-3 text-[10px] text-muted-foreground/80">
                    Use arrow keys to navigate • Generated based on role & company context
                </div>
                )}
            </div>
    );

    if (isSessionMode) {
        return cardInner;
    }

    return (
        <DashboardSection
            title="Questions for You"
            subtitle="Practice answering common interview questions"
            icon={ChatCircleDots}
            action={
                <div className="flex items-center gap-3">
                    {/* Mode Toggle */}
                    <div className="flex items-center bg-muted/50 p-1 rounded-lg">
                        <button
                            onClick={() => setIsPracticeMode(false)}
                            className={cn(
                                "px-3 py-1 text-[10px] font-semibold rounded-md transition-all duration-200",
                                !isPracticeMode
                                    ? "bg-brand text-brand-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                            )}
                        >
                            Learn
                        </button>
                        <button
                            onClick={() => setIsPracticeMode(true)}
                            className={cn(
                                "px-3 py-1 text-[10px] font-semibold rounded-md transition-all duration-200 flex items-center gap-1.5",
                                isPracticeMode
                                    ? "bg-brand text-brand-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                            )}
                        >
                            <Lightning size={10} weight={isPracticeMode ? "fill" : "bold"} />
                            Practice
                        </button>
                    </div>

                    {/* Category Select Dropdown */}
                    <Select
                        value={activeTab}
                        onValueChange={(val) => setActiveTab(val as any)}
                    >
                        <SelectTrigger className="w-[160px] h-8 text-xs font-medium bg-background">
                            <SelectValue placeholder="Category" />
                        </SelectTrigger>
                        <SelectContent align="end">
                            {categories.map(cat => (
                                <SelectItem key={cat.id} value={cat.id} className="text-xs">
                                    <div className="flex items-center gap-2 max-w-[140px]">
                                        <cat.icon size={14} className={cn("shrink-0", activeTab === cat.id ? "text-brand" : "text-muted-foreground")} />
                                        <span className="truncate">{cat.label}</span>
                                    </div>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            }
        >
            {cardInner}
        </DashboardSection>
    );
}
