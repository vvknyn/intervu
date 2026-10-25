"use client";

import { useEffect, useState } from "react";
import { fetchResumeData } from "@/actions/resume";
import { LanguagesControl } from "@/components/jobs/LanguagesControl";
import { Label } from "@/components/ui/label";
import { LoadFailedState } from "@/components/ui/load-failed-state";
import { reloadAgentPreferences, useAgentPreferences } from "@/hooks/use-agent-preferences";
import { useLanguageChoice } from "@/hooks/use-language-choice";
import { resolveCandidateSignals, resumeDefaultLanguages } from "@/lib/jobs/candidate-signals";
import { storedResumeData } from "@/lib/resume/stored-resume-data";
import type { ResumeData } from "@/types/resume";

/**
 * Settings › Job search › the languages they read postings in. It starts as their résumé's language and saves the
 * moment it is changed (not with the form's Save): For You, Today, the daily picks email and their agent all leave
 * out a role written in a language not listed here, and say so where they list.
 */
export function LanguagesSetting({ uid }: { uid: string }) {
    const { prefs, failed } = useAgentPreferences(uid);
    const language = useLanguageChoice(uid);
    // `undefined` while their résumé loads; `null` when they have none we can read.
    const [resume, setResume] = useState<ResumeData | null | undefined>(undefined);

    useEffect(() => {
        let cancelled = false;
        fetchResumeData()
            .then(({ data, text }) => {
                if (!cancelled) setResume(storedResumeData(data, text) ?? null);
            })
            .catch(() => {
                if (!cancelled) setResume(null);
            });
        return () => {
            cancelled = true;
        };
    }, [uid]);

    if (resume === undefined) return null;
    if (failed) {
        return (
            <LoadFailedState
                title="We can't load your saved language right now."
                onRetry={() => void reloadAgentPreferences(uid)}
                testId="settings-languages-load-failed"
            />
        );
    }
    const read = resolveCandidateSignals(resume, prefs).languages?.value ?? null;
    const resumeDefault = resumeDefaultLanguages(resume);
    return (
        <div className="space-y-2" data-testid="settings-languages-row">
            <Label id="settings-languages-title">Postings written in</Label>
            <p className="text-xs text-muted-foreground">
                {read
                    ? "For You, Today, your daily email and your agent leave out roles written in any other language, and say how many. Starts as your résumé's language; saved as you change it."
                    : "Once your résumé is added this starts as its language, and roles written in any other are left out. Until then roles in any language show; add one here to choose."}
            </p>
            <LanguagesControl
                languages={read ?? ["english"]}
                resumeDefault={resumeDefault}
                onChange={(stored) => void language.choose(stored)}
                pending={language.pending}
                testId="settings-languages"
                className="justify-start"
            />
        </div>
    );
}
