"use client";

import { useState, useCallback } from "react";
import { CodingChallenge } from "@/types";
import { Button } from "@/components/ui/button";
import Editor from "@monaco-editor/react";
import { Play, CheckCircle, Warning, CircleNotch } from "@phosphor-icons/react";
import { generateCodeFeedback } from "@/actions/generate-context";
import MarkdownIt from "markdown-it";
import { cn } from "@/lib/utils";

interface CodingWorkspaceProps {
    challenges: CodingChallenge[];
}

export function CodingWorkspace({ challenges }: CodingWorkspaceProps) {
    const [activeChallengeIndex, setActiveChallengeIndex] = useState(0);
    const [codeMap, setCodeMap] = useState<Record<number, string>>(() => {
        const map: Record<number, string> = {};
        challenges.forEach((c, i) => { map[i] = c.starter_code; });
        return map;
    });
    const [feedbackMap, setFeedbackMap] = useState<Record<number, string | null>>({});
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    const md = new MarkdownIt({ html: true, breaks: true, linkify: true });

    const challenge = challenges[activeChallengeIndex];
    const code = codeMap[activeChallengeIndex] ?? challenge?.starter_code ?? "";
    const feedback = feedbackMap[activeChallengeIndex] ?? null;

    const handleCodeChange = useCallback((value: string | undefined) => {
        setCodeMap(prev => ({ ...prev, [activeChallengeIndex]: value || "" }));
    }, [activeChallengeIndex]);

    const handleAnalyze = async () => {
        if (!challenge) return;
        setIsAnalyzing(true);
        setFeedbackMap(prev => ({ ...prev, [activeChallengeIndex]: null }));
        try {
            const result = await generateCodeFeedback(code, challenge.description);
            setFeedbackMap(prev => ({ ...prev, [activeChallengeIndex]: result }));
        } catch (e: any) {
            console.error(e);
            setFeedbackMap(prev => ({ ...prev, [activeChallengeIndex]: `Error: ${e.message || "Failed to analyze code."}` }));
        } finally {
            setIsAnalyzing(false);
        }
    };

    if (!challenge) return null;

    return (
        <div className="flex flex-col">
            {/* Tab Navigation - only show if multiple challenges */}
            {challenges.length > 1 && (
                <div className="flex items-center gap-1 px-2 py-2 bg-muted/20 border border-border rounded-t-xl overflow-x-auto">
                    {challenges.map((c, i) => (
                        <button
                            key={i}
                            onClick={() => setActiveChallengeIndex(i)}
                            className={cn(
                                "px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-all",
                                activeChallengeIndex === i
                                    ? "bg-brand text-brand-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                            )}
                        >
                            #{i + 1} {c.title ? (c.title.length > 20 ? c.title.slice(0, 20) + '...' : c.title) : `Challenge ${i + 1}`}
                        </button>
                    ))}
                </div>
            )}

            <section className={cn(
                "bg-card border border-border shadow-sm overflow-hidden flex flex-col lg:flex-row h-[600px] lg:h-[700px]",
                challenges.length > 1 ? "rounded-b-xl border-t-0" : "rounded-xl"
            )}>
                {/* Left Pane: Problem Description */}
                <div className="lg:w-1/3 p-6 border-b lg:border-b-0 lg:border-r border-border overflow-y-auto bg-muted/10">
                    <h3 className="text-xl font-bold mb-4">{challenge.title}</h3>

                    <div className="prose prose-sm dark:prose-invert max-w-none mb-6 text-muted-foreground">
                        <div dangerouslySetInnerHTML={{ __html: md.render(challenge.description) }} />
                    </div>

                    <div className="space-y-4">
                        <div>
                            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Examples</h4>
                            <div className="space-y-2">
                                {challenge.examples.map((ex: any, i) => (
                                    <div key={i} className="bg-background border border-border p-2 rounded text-xs font-mono whitespace-pre-wrap">
                                        {typeof ex === 'string' ? ex : (
                                            <>
                                                <span className="text-muted-foreground">In:</span> {ex.in || ex.input} <br />
                                                <span className="text-muted-foreground">Out:</span> {ex.out || ex.output}
                                            </>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div>
                            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Constraints</h4>
                            <ul className="list-disc list-inside text-xs text-muted-foreground space-y-1">
                                {challenge.constraints.map((c, i) => (
                                    <li key={i}>{c}</li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>

                {/* Right Pane: Editor & Feedback */}
                <div className="lg:w-2/3 flex flex-col">
                    <div className="flex-1 bg-[#1e1e1e] p-0 relative group flex flex-col">
                        <div className="h-10 bg-[#1e1e1e] flex items-center px-4 text-xs text-gray-400 border-b border-[#2d2d2d] select-none shrink-0">
                            <span className="font-mono">solution.js</span>
                        </div>

                        <div className="flex-1 relative bg-[#1e1e1e]">
                            <Editor
                                height="100%"
                                defaultLanguage="javascript"
                                value={code}
                                onChange={handleCodeChange}
                                theme="vs-dark"
                                loading={<div className="flex items-center justify-center h-full text-muted-foreground gap-2"><CircleNotch className="animate-spin" /> Loading Editor...</div>}
                                options={{
                                    minimap: { enabled: false },
                                    fontSize: 14,
                                    lineNumbers: "on",
                                    scrollBeyondLastLine: false,
                                    automaticLayout: true,
                                    padding: { top: 16, bottom: 16 },
                                    fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
                                    cursorBlinking: "smooth",
                                    smoothScrolling: true,
                                }}
                            />
                        </div>
                    </div>

                    {/* Bottom Bar / Feedback Area */}
                    <div className="border-t border-border bg-background p-4 flex-shrink-0">
                        {!feedback ? (
                            <div className="flex flex-col items-end gap-2 text-right">
                                {isAnalyzing && (
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground animate-pulse">
                                        <CircleNotch className="animate-spin" />
                                        <span>Running tests & analyzing code...</span>
                                    </div>
                                )}
                                <Button onClick={handleAnalyze} disabled={isAnalyzing} className="min-w-[140px]">
                                    {isAnalyzing ? "Processing..." : (
                                        <>
                                            <Play className="mr-2" size={16} weight="fill" /> Run & Analyze
                                        </>
                                    )}
                                </Button>
                            </div>
                        ) : (
                            <div className="animate-in slide-in-from-bottom-4 fade-in duration-300">
                                <div className="flex justify-between items-center mb-2">
                                    <h4 className="font-semibold text-sm flex items-center gap-2">
                                        <CheckCircle className="text-green-500" size={18} weight="fill" />
                                        AI Feedback
                                    </h4>
                                    <Button variant="ghost" size="sm" onClick={() => setFeedbackMap(prev => ({ ...prev, [activeChallengeIndex]: null }))} className="h-6 text-xs">
                                        Close
                                    </Button>
                                </div>
                                <div className="bg-muted/50 rounded-lg p-3 text-sm text-foreground/90 max-h-[150px] overflow-y-auto whitespace-pre-wrap">
                                    {feedback}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </section>
        </div>
    );
}
