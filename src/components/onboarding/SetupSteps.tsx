"use client";

/**
 * Setup's three steps for a new account: what you want, where you can work,
 * and new roles by email. Each asks one thing, starts from what the account
 * already holds, saves the moment it's answered, and can be skipped. They
 * write the same fields Settings › Preferences and Save search write, so
 * there is no second copy of anyone's answers.
 *
 * One component for both places setup appears: the sheet the welcome strip
 * opens (`variant="sheet"`), and /jobs itself when the account landed there
 * (`variant="page"`). Rules: lib/onboarding/state.ts and steps.ts.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, UploadSimple } from "@phosphor-icons/react";
import { saveAgentPreferencesAction } from "@/actions/agent-preferences";
import { countNewSinceAction } from "@/actions/jobs";
import { saveSavedSearchAction } from "@/actions/saved-searches";
import { Button } from "@/components/ui/button";
import { ToggleChip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { InlineSpinner } from "@/components/ui/wait-state";
import { rememberAgentPreferences } from "@/hooks/use-agent-preferences";
import { answerStep, noteSetupFacts, useOnboarding, type StepVia } from "@/hooks/use-onboarding";
import { captureEvent } from "@/lib/analytics/events";
import { resumeImporterHref } from "@/lib/auth/post-auth-destination";
import { isMintedLoginEmail } from "@/lib/auth/minted-email";
import { getSignedInUser } from "@/lib/firebase/client-auth";
import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";
import { invalidateSavedSearchesCache } from "@/lib/jobs/use-saved-searches";
import { readLocalAiResume } from "@/lib/local-ai/resume-storage";
import {
    nextOpenStep,
    PLACE_SOURCE_LINE,
    relocationAnswer,
    relocationChoiceOf,
    setupSearch,
    startingPlace,
    type RelocationChoice,
} from "@/lib/onboarding/steps";
import { firstOpenStep, SETUP_STEPS, type SetupStep, type StepOutcome, type StepOutcomes } from "@/lib/onboarding/state";
import type { OnboardingView } from "@/lib/onboarding/store";
import { cn } from "@/lib/utils";

const STEP_TITLE: Record<SetupStep, string> = {
    resume: "What you want",
    place: "Where you can work",
    email: "New roles by email",
};

const WEEK_MS = 7 * 86_400_000;

export interface SetupStepsProps {
    variant: "sheet" | "page";
    /** On /jobs the importer opens in place; elsewhere "Add your résumé" goes to /jobs with it open. */
    onUploadResume?: () => void;
    /** The /jobs search on screen ("?q=…"), offered by step 3 when no roles are known. */
    currentSearchHref?: string | null;
    /** Every step answered. */
    onFinished: () => void;
}

export function SetupSteps({ variant, onUploadResume, currentSearchHref = null, onFinished }: SetupStepsProps) {
    const { view, outcomes } = useOnboarding();
    const [step, setStep] = useState<SetupStep | null>(() => (outcomes ? firstOpenStep(outcomes) : null));
    // The résumé kept in this browser (a guest's, carried into the account) reads like one on file.
    const local = useMemo(() => readLocalAiResume(), []);

    if (!view || !outcomes) return null;
    const current: SetupStep = step ?? firstOpenStep(outcomes) ?? "resume";
    const resumeTitle = view.resumeTitle ?? (local?.data.profile?.profession?.trim() || null);
    const resumeLocation = view.resumeLocation ?? (local?.data.profile?.location?.trim() || null);

    const answer = (s: SetupStep, outcome: StepOutcome, via?: StepVia) => {
        const after: StepOutcomes = { ...outcomes, [s]: outcome };
        answerStep(s, outcome, via);
        const next = nextOpenStep(after, s);
        if (next) setStep(next);
        else onFinished();
    };

    return (
        <div data-testid="setup-steps" data-step={current} className="space-y-4">
            <ol aria-label="Setup steps" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                {SETUP_STEPS.map((s, i) => (
                    <li
                        key={s}
                        data-testid="setup-step-marker"
                        data-step={s}
                        data-outcome={outcomes[s] ?? "open"}
                        aria-current={s === current ? "step" : undefined}
                        className={cn(
                            "inline-flex items-center gap-1.5",
                            s === current ? "font-semibold text-foreground" : "text-muted-foreground",
                        )}
                    >
                        <span
                            aria-hidden
                            className={cn(
                                "mono-data flex size-5 items-center justify-center rounded-pill border text-xs",
                                outcomes[s] === "done" ? "border-transparent bg-muted" : "border-border",
                            )}
                        >
                            {outcomes[s] === "done" ? <Check /> : i + 1}
                        </span>
                        <span>
                            {STEP_TITLE[s]}
                            {outcomes[s] === "skipped" ? <span className="text-muted-foreground"> (skipped)</span> : null}
                            {outcomes[s] === "done" ? <span className="sr-only"> (done)</span> : null}
                        </span>
                    </li>
                ))}
            </ol>

            {current === "resume" ? (
                <ResumeStep
                    key="resume"
                    view={view}
                    resumeOnFile={view.facts.resumeOnFile || Boolean(local)}
                    resumeTitle={resumeTitle}
                    resumeDate={view.resumeUpdatedAt ?? local?.updatedAt ?? null}
                    onUploadResume={onUploadResume}
                    onAnswer={(outcome, via) => answer("resume", outcome, via)}
                />
            ) : current === "place" ? (
                <PlaceStep
                    key="place"
                    view={view}
                    resumeLocation={resumeLocation}
                    onAnswer={(outcome, via) => answer("place", outcome, via)}
                />
            ) : (
                <EmailStep
                    key="email"
                    view={view}
                    resumeTitle={resumeTitle}
                    resumeLocation={resumeLocation}
                    currentSearchHref={currentSearchHref}
                    variant={variant}
                    onBack={() => setStep("resume")}
                    onAnswer={(outcome, via) => answer("email", outcome, via)}
                />
            )}
        </div>
    );
}

type Answer = (outcome: StepOutcome, via?: StepVia) => void;

function StepError({ message }: { message: string | null }) {
    if (!message) return null;
    return (
        <p role="alert" className="text-sm text-danger-text">
            {message}
        </p>
    );
}

function SkipButton({ onClick, label = "Skip" }: { onClick: () => void; label?: string }) {
    return (
        <Button type="button" variant="ghost" data-testid="setup-skip" onClick={onClick}>
            {label}
        </Button>
    );
}

/** Saves roles to Settings › Preferences › Roles and the shared preferences copy. */
async function saveRoles(roles: string): Promise<boolean> {
    const res = await saveAgentPreferencesAction({ search: { query: roles } }).catch(() => null);
    const uid = getSignedInUser()?.uid;
    if (!res?.data) return false;
    if (uid) rememberAgentPreferences(uid, res.data);
    noteSetupFacts({ roles });
    return true;
}

function formatDay(iso: string | null): string | null {
    if (!iso) return null;
    const at = new Date(iso);
    return Number.isNaN(at.getTime()) ? null : at.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ResumeStep({
    view,
    resumeOnFile,
    resumeTitle,
    resumeDate,
    onUploadResume,
    onAnswer,
}: {
    view: OnboardingView;
    resumeOnFile: boolean;
    resumeTitle: string | null;
    resumeDate: string | null;
    onUploadResume?: () => void;
    onAnswer: Answer;
}) {
    const initial = view.facts.roles ?? (resumeOnFile ? (resumeTitle ?? "") : "");
    const [roles, setRoles] = useState(initial);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async () => {
        const typed = roles.trim().replace(/\s+/g, " ");
        if (!typed) {
            if (resumeOnFile) return onAnswer("done", "resume");
            return setError("Type the roles you'd search for, or skip this step.");
        }
        // Unchanged roles (saved ones, or the résumé's title) answer the step without a write.
        if (typed === initial.trim().replace(/\s+/g, " ")) return onAnswer("done", view.facts.roles ? "roles" : "resume");
        setSaving(true);
        setError(null);
        const ok = await saveRoles(typed);
        setSaving(false);
        if (!ok) return setError("Couldn't save your roles. Try again, or skip this step.");
        onAnswer("done", "roles");
    };

    const added = formatDay(resumeDate);
    return (
        <section aria-labelledby="setup-resume-title" className="space-y-3">
            <h3 id="setup-resume-title" className="text-base font-semibold text-foreground">
                {resumeOnFile ? "Your résumé is on file" : "What kind of role are you after?"}
            </h3>
            {resumeOnFile ? (
                <p className="text-sm text-muted-foreground">
                    {added ? `Added ${added}. ` : ""}It ranks every list and decides each role&apos;s fit label.
                </p>
            ) : (
                <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                        Add your résumé and every list is ranked by how well each role fits it. It&apos;s read in this
                        browser. Saving it to your account needs a paid month.
                    </p>
                    {onUploadResume ? (
                        <Button type="button" data-testid="setup-add-resume" onClick={onUploadResume}>
                            <UploadSimple aria-hidden />
                            Add your résumé
                        </Button>
                    ) : (
                        <Button asChild data-testid="setup-add-resume">
                            <Link href={resumeImporterHref()}>
                                <UploadSimple aria-hidden />
                                Add your résumé
                            </Link>
                        </Button>
                    )}
                </div>
            )}
            <div className="space-y-1.5">
                <Label htmlFor="setup-roles">{resumeOnFile ? "Roles you're after" : "Or type the roles you'd search for"}</Label>
                <Input
                    id="setup-roles"
                    data-testid="setup-roles"
                    value={roles}
                    onChange={(e) => setRoles(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") void submit();
                    }}
                    placeholder="e.g. registered nurse, primary school teacher"
                    maxLength={200}
                    autoComplete="off"
                />
                {resumeOnFile && resumeTitle && !view.facts.roles ? (
                    <p className="text-xs text-muted-foreground">Read from your résumé. Change it to search for other roles.</p>
                ) : null}
            </div>
            <StepError message={error} />
            <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant={resumeOnFile ? "default" : "outline"} data-testid="setup-roles-save" disabled={saving} onClick={() => void submit()}>
                    {saving ? <InlineSpinner /> : null}
                    {resumeOnFile ? "Continue" : "Save roles"}
                </Button>
                <SkipButton onClick={() => onAnswer("skipped")} />
            </div>
        </section>
    );
}

const RELOCATION_OPTIONS: { choice: RelocationChoice; label: string }[] = [
    { choice: "no", label: "No" },
    { choice: "anywhere", label: "Yes, anywhere" },
    { choice: "to", label: "Yes, to…" },
];

function PlaceStep({ view, resumeLocation, onAnswer }: { view: OnboardingView; resumeLocation: string | null; onAnswer: Answer }) {
    const start = useMemo(
        () => startingPlace({ settings: view.facts.location, resume: resumeLocation, connectionCountry: view.connectionCountry }),
        [view.facts.location, resumeLocation, view.connectionCountry],
    );
    const startRelocation = useMemo(() => relocationChoiceOf(view.relocation), [view.relocation]);
    const [place, setPlace] = useState(start.value);
    const [remoteOnly, setRemoteOnly] = useState(view.facts.remoteOnly);
    const [relocation, setRelocation] = useState<RelocationChoice | null>(startRelocation.choice);
    const [relocationPlaces, setRelocationPlaces] = useState(startRelocation.places);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async () => {
        const location = place.trim().replace(/\s+/g, " ");
        if (!location && !remoteOnly) return setError("Add a place, or turn on Only remote roles, or skip this step.");
        const relocationText = relocation ? relocationAnswer(relocation, relocationPlaces) : null;
        if (relocation === "to" && !relocationText) return setError("Say where you'd move to, or pick another answer.");
        setSaving(true);
        setError(null);
        const res = await saveAgentPreferencesAction({
            search: { location, remoteOnly },
            ...(relocationText ? { answers: { relocation: relocationText } } : {}),
        }).catch(() => null);
        setSaving(false);
        if (!res?.data) return setError("Couldn't save where you work. Try again, or skip this step.");
        const uid = getSignedInUser()?.uid;
        if (uid) rememberAgentPreferences(uid, res.data);
        noteSetupFacts({ location: location || null, remoteOnly });
        onAnswer("done", location ? "place" : "remote");
    };

    const sourceLine = place.trim() === start.value && start.source ? PLACE_SOURCE_LINE[start.source] : null;
    return (
        <section aria-labelledby="setup-place-title" className="space-y-3">
            <h3 id="setup-place-title" className="text-base font-semibold text-foreground">
                Where can you work?
            </h3>
            <p className="text-sm text-muted-foreground">
                Roles you can&apos;t take from where you are read &quot;Outside&quot; your country and rank last.
            </p>
            <div className="space-y-1.5">
                <Label htmlFor="setup-place">City, region or country</Label>
                <Input
                    id="setup-place"
                    data-testid="setup-place"
                    value={place}
                    onChange={(e) => setPlace(e.target.value)}
                    placeholder="e.g. Toronto, Ontario"
                    maxLength={200}
                    autoComplete="off"
                />
                {sourceLine ? (
                    <p data-testid="setup-place-source" className="text-xs text-muted-foreground">
                        {sourceLine}
                    </p>
                ) : null}
            </div>
            <div className="flex items-center justify-between gap-3">
                <span id="setup-remote-label" className="text-sm text-foreground">
                    Only remote roles
                </span>
                <Switch checked={remoteOnly} onChange={() => setRemoteOnly((v) => !v)} aria-label="Only remote roles" />
            </div>
            <fieldset className="space-y-2">
                <legend className="text-sm text-foreground">Would you move for the right role?</legend>
                <div role="radiogroup" aria-label="Would you move for the right role?" className="flex flex-wrap gap-2">
                    {RELOCATION_OPTIONS.map((o) => (
                        <ToggleChip
                            key={o.choice}
                            role="radio"
                            selected={relocation === o.choice}
                            data-testid={`setup-relocation-${o.choice}`}
                            onClick={() => setRelocation((c) => (c === o.choice ? null : o.choice))}
                        >
                            {o.label}
                        </ToggleChip>
                    ))}
                </div>
                {relocation === "to" ? (
                    <Input
                        aria-label="Where you'd move to"
                        data-testid="setup-relocation-places"
                        value={relocationPlaces}
                        onChange={(e) => setRelocationPlaces(e.target.value)}
                        placeholder="e.g. United Kingdom, Germany"
                        maxLength={200}
                        autoComplete="off"
                    />
                ) : null}
            </fieldset>
            <StepError message={error} />
            <div className="flex flex-wrap items-center gap-2">
                <Button type="button" data-testid="setup-place-save" disabled={saving} onClick={() => void submit()}>
                    {saving ? <InlineSpinner /> : null}
                    Save and continue
                </Button>
                <SkipButton onClick={() => onAnswer("skipped")} />
            </div>
        </section>
    );
}

function EmailStep({
    view,
    resumeTitle,
    resumeLocation,
    currentSearchHref,
    variant,
    onBack,
    onAnswer,
}: {
    view: OnboardingView;
    resumeTitle: string | null;
    resumeLocation: string | null;
    currentSearchHref: string | null;
    variant: "sheet" | "page";
    onBack: () => void;
    onAnswer: Answer;
}) {
    const search = useMemo(
        () =>
            setupSearch({
                roles: view.facts.roles ?? resumeTitle,
                place: view.facts.location ?? resumeLocation,
                remoteOnly: view.facts.remoteOnly,
                currentSearchHref,
            }),
        [view.facts.roles, view.facts.location, view.facts.remoteOnly, resumeTitle, resumeLocation, currentSearchHref],
    );
    const [count, setCount] = useState<CorpusCount | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // A login address the sign-up minted has no inbox behind it: name no address.
    const accountEmail = getSignedInUser()?.email ?? null;
    const email = accountEmail && !isMintedLoginEmail(accountEmail) ? accountEmail : null;

    useEffect(() => {
        if (!search) return;
        let cancelled = false;
        void countNewSinceAction({ scope: "saved", params: search.state }, new Date(Date.now() - WEEK_MS).toISOString())
            .then((c) => {
                if (!cancelled) setCount(c);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [search]);

    const submit = async () => {
        if (!search) return;
        setSaving(true);
        setError(null);
        const res = await saveSavedSearchAction({ name: search.name, href: search.href }).catch(() => null);
        setSaving(false);
        if (!res || res.error) return setError("Couldn't set up the email. Try again, or skip this step.");
        invalidateSavedSearchesCache();
        captureEvent("saved_search_created", { surface: "setup", signed_in: true });
        noteSetupFacts({ savedSearches: 1 });
        onAnswer("done", "saved_search");
    };

    return (
        <section aria-labelledby="setup-email-title" className="space-y-3">
            <h3 id="setup-email-title" className="text-base font-semibold text-foreground">
                Get new roles by email?
            </h3>
            {search ? (
                <>
                    <div className="rounded-panel border border-border p-3">
                        <p data-testid="setup-email-search" className="text-sm font-semibold text-foreground">
                            {search.name}
                        </p>
                        <p data-testid="setup-email-count" className="text-sm text-muted-foreground">
                            {count === null
                                ? "Counting roles posted in the last 7 days…"
                                : count.value > 0
                                  ? `${formatCorpusCount(count)} posted in the last 7 days.`
                                  : "None posted in the last 7 days. The email only comes when there are new ones."}
                        </p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        We&apos;ll email {email ?? "you"} once a week with the new ones. It&apos;s a saved search, so you
                        can change or remove it under Search, and every email has an unsubscribe link.
                    </p>
                    <StepError message={error} />
                    <div className="flex flex-wrap items-center gap-2">
                        <Button type="button" data-testid="setup-email-yes" disabled={saving} onClick={() => void submit()}>
                            {saving ? <InlineSpinner /> : null}
                            Email me new roles like these each week
                        </Button>
                        <SkipButton onClick={() => onAnswer("skipped")} label="No thanks" />
                    </div>
                </>
            ) : (
                <>
                    <p className="text-sm text-muted-foreground">
                        Tell us the roles you want in step 1 first, and this offers a weekly email of new ones.
                        {variant === "page" ? " Or search below and use Save search." : ""}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                        <Button type="button" variant="outline" onClick={onBack}>
                            Back to step 1
                        </Button>
                        <SkipButton onClick={() => onAnswer("skipped")} label="No thanks" />
                    </div>
                </>
            )}
        </section>
    );
}
