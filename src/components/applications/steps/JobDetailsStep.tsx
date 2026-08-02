"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
    Link as LinkIcon,
    FileText,
    Buildings,
    Briefcase,
    WarningCircle,
    ClipboardText,
    ArrowRight
} from "@phosphor-icons/react";
import { ApplicationDraft } from "../ApplicationWizard";
import { fetchUrlContent } from "@/actions/fetch-url";
import { JobAnalysis } from "@/types/resume";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { McpHandoffNote } from "@/components/mcp/McpHandoffNote";

interface JobDetailsStepProps {
    draft: ApplicationDraft;
    onUpdate: (updates: Partial<ApplicationDraft>) => void;
}

export function JobDetailsStep({ draft, onUpdate }: JobDetailsStepProps) {
    const [inputMode, setInputMode] = useState<"url" | "text">(draft.jobUrl ? "url" : "text");
    const [jobUrl, setJobUrl] = useState(draft.jobUrl || "");
    const [jobText, setJobText] = useState(draft.jobText || "");
    const [companyName, setCompanyName] = useState(draft.jobAnalysis?.companyName || "");
    const [positionTitle, setPositionTitle] = useState(draft.jobAnalysis?.positionTitle || "");
    const [isFetching, setIsFetching] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [urlFetchFailed, setUrlFetchFailed] = useState(false);

    // Keeps the existing JobAnalysis shape intact (required fields filled with
    // sane defaults) so the wizard's step-1 gate, ReviewStep, and
    // ResumeTailoringStep's versionName default all keep working unchanged.
    const updateJobDetails = (company: string, position: string) => {
        const jobAnalysis: JobAnalysis = {
            ...draft.jobAnalysis,
            companyName: company,
            positionTitle: position,
            jobText: jobText || draft.jobAnalysis?.jobText || "",
            extractedRequirements: [],
            extractedSkills: draft.jobAnalysis?.extractedSkills || [],
            cultureIndicators: draft.jobAnalysis?.cultureIndicators || [],
            seniorityLevel: draft.jobAnalysis?.seniorityLevel || "",
        };
        onUpdate({ jobAnalysis });
    };

    const handleCompanyChange = (value: string) => {
        setCompanyName(value);
        updateJobDetails(value, positionTitle);
    };

    const handlePositionChange = (value: string) => {
        setPositionTitle(value);
        updateJobDetails(companyName, value);
    };

    const handleJobUrlChange = (value: string) => {
        setJobUrl(value);
        onUpdate({ jobUrl: value });
    };

    const handleJobTextChange = (value: string) => {
        setJobText(value);
        onUpdate({ jobText: value });
    };

    const handleFetchUrl = async () => {
        if (!jobUrl) return;
        setIsFetching(true);
        setError(null);
        setUrlFetchFailed(false);

        try {
            const fetchResult = await fetchUrlContent(jobUrl);
            if (fetchResult.error) {
                setUrlFetchFailed(true);
                return;
            }
            const text = fetchResult.data || "";
            setJobText(text);
            onUpdate({ jobUrl, jobText: text });
        } catch (e: unknown) {
            setError((e as Error).message || "Failed to fetch job posting");
        } finally {
            setIsFetching(false);
        }
    };

    const hasDetails = !!(companyName.trim() && positionTitle.trim());

    return (
        <div className="space-y-6">
            <div className="mb-6">
                <h2 className="text-xl md:text-2xl font-semibold tracking-tight">Job Details</h2>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                    Paste the job posting and tell us who it's for.
                </p>
            </div>

            {/* Input Section */}
            <div className="bg-card rounded-xl shadow-[var(--shadow-sm)] overflow-hidden">
                <Tabs value={inputMode} onValueChange={(val) => setInputMode(val as "url" | "text")} className="w-full">
                    <div className="border-b border-border/50 bg-muted/20 px-6 py-2">
                        <TabsList className="grid w-full grid-cols-2 max-w-[400px]">
                            <TabsTrigger value="url">
                                <LinkIcon className="mr-2 h-4 w-4" />
                                Paste URL
                            </TabsTrigger>
                            <TabsTrigger value="text">
                                <FileText className="mr-2 h-4 w-4" />
                                Paste Text
                            </TabsTrigger>
                        </TabsList>
                    </div>

                    <div className="p-6">
                        <TabsContent value="url" className="mt-0 space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="jobUrl">Job Posting URL</Label>
                                <Input
                                    id="jobUrl"
                                    type="url"
                                    placeholder="https://careers.google.com/jobs/..."
                                    value={jobUrl}
                                    onChange={(e) => handleJobUrlChange(e.target.value)}
                                    className="h-11"
                                    disabled={isFetching}
                                    autoFocus
                                />
                                <p className="text-xs text-muted-foreground">
                                    We'll fetch the posting text from this link.
                                </p>
                            </div>
                        </TabsContent>

                        <TabsContent value="text" className="mt-0 space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="jobText">Job Description</Label>
                                <Textarea
                                    id="jobText"
                                    placeholder="Paste the full job description here..."
                                    value={jobText}
                                    onChange={(e) => handleJobTextChange(e.target.value)}
                                    className="min-h-[240px] resize-y font-mono text-sm leading-relaxed"
                                />
                            </div>
                        </TabsContent>

                        {error && (
                            <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-destructive shrink-0" />
                                {error}
                            </div>
                        )}

                        {urlFetchFailed && (
                            <div className="mt-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
                                <div className="flex items-start gap-3">
                                    <WarningCircle size={20} className="text-amber-600 shrink-0 mt-0.5" weight="fill" />
                                    <div className="flex-1 space-y-2">
                                        <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                                            Couldn&apos;t fetch content from this URL
                                        </p>
                                        <p className="text-xs text-amber-700 dark:text-amber-300">
                                            The site may block automated access. Copy the job posting text from the page and paste it here instead.
                                        </p>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="gap-1.5 mt-1"
                                            onClick={() => {
                                                setInputMode("text");
                                                setUrlFetchFailed(false);
                                            }}
                                        >
                                            <ClipboardText size={14} />
                                            Switch to Paste Text
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {inputMode === "url" && (
                            <Button
                                onClick={handleFetchUrl}
                                disabled={isFetching || !jobUrl}
                                className="w-full mt-6 h-11"
                                size="lg"
                                variant="outline"
                            >
                                {isFetching ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-foreground/30 border-t-foreground rounded-full animate-spin mr-2" />
                                        Fetching...
                                    </>
                                ) : (
                                    <>
                                        <LinkIcon size={18} className="mr-2" />
                                        Fetch Posting Text
                                    </>
                                )}
                            </Button>
                        )}
                    </div>
                </Tabs>
            </div>

            {/* Manual Company / Position — this is the tracker's own record, not AI extraction */}
            <div className="bg-card rounded-xl shadow-[var(--shadow-sm)] p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="companyName" className="flex items-center gap-2">
                            <Buildings size={14} />
                            Company Name
                        </Label>
                        <Input
                            id="companyName"
                            value={companyName}
                            onChange={(e) => handleCompanyChange(e.target.value)}
                            placeholder="e.g. Google"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="positionTitle" className="flex items-center gap-2">
                            <Briefcase size={14} />
                            Position Title
                        </Label>
                        <Input
                            id="positionTitle"
                            value={positionTitle}
                            onChange={(e) => handlePositionChange(e.target.value)}
                            placeholder="e.g. Senior Software Engineer"
                        />
                    </div>
                </div>
            </div>

            <McpHandoffNote />

            {/* Completion nudge */}
            {hasDetails && (
                <div className="bg-brand/5 border border-brand/20 rounded-xl p-4 flex items-center gap-3">
                    <ArrowRight size={20} className="text-brand shrink-0" weight="bold" />
                    <p className="text-sm font-medium text-foreground">
                        Click <span className="font-bold">Continue</span> to attach your resume.
                    </p>
                </div>
            )}
        </div>
    );
}
