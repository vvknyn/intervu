"use client";

import { chipVariants, ChipDismiss } from "@/components/ui/chip";
import { languageLabel, WRITTEN_LANGUAGES } from "@/lib/match/posting-language";
import { cn } from "@/lib/utils";

/** What to save for a new list of languages: `[]` when it is just the résumé's language again, so a résumé replaced later in another language is followed. */
export function storedLanguages(next: readonly string[], resumeDefault: readonly string[] | null): string[] {
    const follows = resumeDefault != null && next.length === resumeDefault.length && next.every((language) => resumeDefault.includes(language));
    return follows ? [] : [...next];
}

/**
 * The languages a person reads postings in, as the control that changes them (Settings › Job search, the foot of
 * For You, Today). A posting written in a language not listed here is left out of those lists with that reason
 * (`forYouLeftOut` "language"); adding the language brings it back, removing it takes it out. Nothing listed
 * means nothing is judged, so the last language cannot be removed.
 *
 * `languages` is what counts now (their choice, else their résumé's language: `CandidateSignals.languages`);
 * `onChange` gets the new list, and `[]` when it is just the résumé's language again, so a résumé replaced
 * later in another language is followed. `leftOut` is how many roles each language kept out of this list: a
 * button beside the chips brings one back in a tap, where the reason was read.
 */
export function LanguagesControl({
    languages,
    resumeDefault,
    leftOut,
    onChange,
    pending = false,
    testId,
    className,
}: {
    languages: readonly string[];
    /** What their résumé alone would read in; a list equal to it is stored as "follow the résumé". */
    resumeDefault: readonly string[] | null;
    leftOut?: Readonly<Record<string, number>>;
    onChange: (stored: string[]) => void;
    pending?: boolean;
    testId: string;
    className?: string;
}) {
    const change = (next: string[]) => onChange(storedLanguages(next, resumeDefault));
    const add = (language: string) => {
        if (language && !languages.includes(language)) change([...languages, language]);
    };
    const addable = WRITTEN_LANGUAGES.filter((language) => !languages.includes(language));
    const kept = Object.entries(leftOut ?? {})
        .filter(([language, n]) => n > 0 && !languages.includes(language))
        .sort((a, b) => b[1] - a[1]);

    return (
        <div
            className={cn("flex flex-wrap items-center justify-center gap-x-2 gap-y-2 text-sm text-muted-foreground", className)}
            data-testid={testId}
            aria-busy={pending}
        >
            <span id={`${testId}-label`}>Postings in</span>
            <ul className="flex flex-wrap items-center gap-2" aria-labelledby={`${testId}-label`}>
                {languages.map((language) => (
                    <li key={language}>
                        <span className={cn(chipVariants({ active: true }), "pr-1")} data-testid={`${testId}-chip-${language}`}>
                            {languageLabel(language)}
                            {languages.length > 1 ? (
                                <ChipDismiss
                                    label={`Stop showing postings written in ${languageLabel(language)}`}
                                    onClick={() => change(languages.filter((other) => other !== language))}
                                />
                            ) : (
                                <span className="w-2" aria-hidden />
                            )}
                        </span>
                    </li>
                ))}
            </ul>
            <select
                aria-label="Add a language"
                data-testid={`${testId}-add`}
                value=""
                disabled={pending || addable.length === 0}
                onChange={(event) => add(event.target.value)}
                className={cn(chipVariants({ interactive: true }), "appearance-none pr-3 text-base md:text-sm")}
            >
                <option value="">+ Add a language</option>
                {addable.map((language) => (
                    <option key={language} value={language}>
                        {languageLabel(language)}
                    </option>
                ))}
            </select>
            {kept.map(([language, n]) => (
                <button
                    key={language}
                    type="button"
                    data-testid={`${testId}-include-${language}`}
                    disabled={pending}
                    onClick={() => add(language)}
                    className={cn(chipVariants({ interactive: true }), "border-foreground")}
                >
                    Include {languageLabel(language)} ({n})
                </button>
            ))}
        </div>
    );
}
