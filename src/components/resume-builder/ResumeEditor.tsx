"use client";

import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ResumeData } from "@/types/resume";
import { LiveResumePreview } from "./LiveResumePreview";
import { EditingPanel } from "./EditingPanel";
import { Button } from "@/components/ui/button";
import { exportToDocx } from "@/lib/export-docx";
import { printResume } from "@/lib/resume/print-resume";

type SyncStatus = 'saved' | 'saving' | 'offline' | 'error';

// SSR-safe "has mounted" check (avoids the setState-in-effect anti-pattern —
// `document.body` doesn't exist during SSR, so the print portal can only
// render once we're definitely on the client).
const subscribeNever = () => () => {};
function useMounted(): boolean {
    return useSyncExternalStore(subscribeNever, () => true, () => false);
}

interface ResumeEditorProps {
    data: ResumeData;
    onUpdate: (data: Partial<ResumeData>) => void;
    onClear: () => void;
    onImport?: () => void;
    syncStatus?: 'saved' | 'saving' | 'offline' | 'error';
    originalData?: ResumeData | null; // For highlighting diff in tailored mode
    isTailoredMode?: boolean; // Highlight changes in editing panel
    versionsToggle?: React.ReactNode; // Optional custom component to render in top-right
}

export function ResumeEditor({ data, onUpdate, onClear, onImport, syncStatus = 'saved', versionsToggle, originalData, isTailoredMode }: ResumeEditorProps) {
    const [selectedSection, setSelectedSection] = useState<string | null>(null);
    const handleDownloadWord = async () => {
        await exportToDocx(data);
    };

    // Portal target for the print copy only exists client-side.
    const mounted = useMounted();

    const [mobileTab, setMobileTab] = useState<'preview' | 'edit'>('edit');

    return (
        // Sized to fill the hub's paper-card wrapper (ResumeBuilder.tsx) rather
        // than a full viewport — this component used to BE the whole page.
        <div className="flex h-[78vh] min-h-[600px] flex-col bg-card">
            {/* Toolbar — squared system (docs-mockup.html Comp D "toolbar to
                the button family", THE RULES #3): every action is one of the
                three button weights instead of a bare underlined link. Sync
                status stays mono text (it's a status, not an action) and
                reuses the same verdict tones the ledger's VERDICT CELL uses
                (live = saved, risk = error) rather than colored cloud icons. */}
            <div className="border-b border-border bg-card z-40">
                <div className="max-w-[1600px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
                    <div className="min-w-0 truncate font-mono text-[11.5px]">
                        {syncStatus === 'saving' && <span className="text-muted-foreground">saving…</span>}
                        {syncStatus === 'saved' && <span className="text-verdict-live">saved</span>}
                        {syncStatus === 'offline' && (
                            <span className="text-muted-foreground">
                                saved on this device — <a href="/login" className="underline underline-offset-2 hover:text-foreground transition-colors duration-100">log in</a> to sync
                            </span>
                        )}
                        {syncStatus === 'error' && <span className="text-verdict-risk">sync error</span>}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        {onImport && (
                            <Button variant="quiet" size="sm" onClick={onImport} className="hidden sm:inline-flex">
                                Import
                            </Button>
                        )}

                        <Button
                            variant="quiet"
                            size="sm"
                            onClick={onClear}
                            className="hidden sm:inline-flex text-verdict-risk hover:text-verdict-risk"
                        >
                            Clear
                        </Button>

                        {versionsToggle}

                        <Button variant="quiet" size="sm" onClick={printResume} className="hidden sm:inline-flex">
                            Print / PDF
                        </Button>

                        <Button size="sm" onClick={handleDownloadWord}>.docx</Button>
                    </div>
                </div>

                {/* Mobile Tab Switcher */}
                <div className="lg:hidden border-t border-border px-4 py-2">
                    <div className="flex items-center gap-5 font-mono text-[12px]">
                        <button
                            onClick={() => setMobileTab('edit')}
                            className={mobileTab === 'edit' ? "text-foreground underline underline-offset-4" : "text-muted-foreground hover:text-foreground"}
                        >
                            editor
                        </button>
                        <button
                            onClick={() => setMobileTab('preview')}
                            className={mobileTab === 'preview' ? "text-foreground underline underline-offset-4" : "text-muted-foreground hover:text-foreground"}
                        >
                            preview
                        </button>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-hidden relative">
                <div className="max-w-[1600px] mx-auto h-full flex lg:gap-0">
                    {/* Left: Live Preview (Hidden on mobile unless active) */}
                    <div className={`
                        lg:w-[45%] lg:block lg:border-r border-border bg-muted/30 overflow-y-auto overflow-x-hidden p-4 lg:p-6
                        absolute inset-0 lg:static z-20 lg:z-auto bg-background lg:bg-muted/30
                        ${mobileTab === 'preview' ? 'block' : 'hidden'}
                    `}>
                        {/* Mobile Zoom Wrapper */}
                        <div className="min-w-[8.5in] lg:min-w-0 transform origin-top-left scale-[0.45] sm:scale-[0.6] md:scale-[0.75] lg:scale-[0.82] xl:scale-[0.92] 2xl:scale-100 h-full">
                            <LiveResumePreview
                                data={data}
                                onEdit={(section) => {
                                    setSelectedSection(section);
                                    setMobileTab('edit'); // Switch to edit on click
                                }}
                                selectedSection={selectedSection}
                                originalData={originalData} // Pass for diff highlighting
                            />
                        </div>
                    </div>

                    {/* Right: Editing Panel (Hidden on mobile unless active) */}
                    <div className={`
                        flex-1 overflow-hidden bg-background
                        absolute inset-0 lg:static z-20 lg:z-auto
                        ${mobileTab === 'edit' ? 'block' : 'hidden'}
                    `}>
                        <EditingPanel
                            selectedSection={selectedSection}
                            data={data}
                            onUpdate={onUpdate}
                            onNavigateSection={(section) => setSelectedSection(section)}
                        />
                    </div>
                </div>
            </div>

            {/* Print-only copy: untransformed (no scale() wrapper), portaled to
                <body> so it sits outside the app shell. Only #resume-print-root
                is made visible when `html.printing-resume` is set — see the
                scoped @media print rule in globals.css. */}
            {mounted &&
                createPortal(
                    <div id="resume-print-root" className="hidden">
                        <LiveResumePreview data={data} onEdit={() => {}} selectedSection={null} printMode />
                    </div>,
                    document.body,
                )}
        </div>
    );
}
