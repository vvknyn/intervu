"use client";

/**
 * "Needs you" on the packs home's Today header: the visitor's moves, soonest
 * first, each with one button. The list and its wording come from
 * `lib/jobs/for-you/needs-you.ts`; `useNeedsYouRemote` is the one account
 * read (`listNeedsYouAction`), and `NeedsYouView` is the layout alone, so
 * `/mock/today` renders every state without it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check } from "@phosphor-icons/react";
import { listNeedsYouAction } from "@/actions/needs-you";
import { Button } from "@/components/ui/button";
import { SubTitle } from "@/components/ui/heading";
import { LoadFailedState } from "@/components/ui/load-failed-state";
import { WaitBar, WaitState } from "@/components/ui/wait-state";
import { freshHubProbeMemo } from "@/lib/jobs/for-you/hub-counts";
import { readWithRetry, settleEnvelope } from "@/lib/load-result";
import { NEEDS_YOU_MAX_ITEMS, type NeedsYouItem, type NeedsYouRemote, type StarterStep } from "@/lib/jobs/for-you/needs-you";
import { cn } from "@/lib/utils";

/** Where the account side stands: `none` for a guest, whose list is their device tracker alone. */
export type NeedsYouRemoteState =
    | { kind: "none" }
    | { kind: "loading" }
    | { kind: "failed" }
    | { kind: "ready"; data: NeedsYouRemote };

/** The last read, repainted on a return to the hub (the Today search's rule). */
let needsYouMemo: { key: string; at: number; complete: true; data: NeedsYouRemote } | null = null;

/**
 * The account read, once the tracker has loaded (its saved roles are part of
 * the read) and again only when the baseline or those roles change.
 */
export function useNeedsYouRemote({
    enabled,
    accountKey,
    sinceIso,
    savedJobIds,
    nowMs,
}: {
    /** Signed in with the tracker loaded. */
    enabled: boolean;
    /** Whose account: a new sign-in never repaints another account's memo. */
    accountKey: string;
    sinceIso: string;
    savedJobIds: string[];
    nowMs: number;
}): { state: NeedsYouRemoteState; retry: () => void } {
    const [attempt, setAttempt] = useState(0);
    const memoKey = `${accountKey}\0${sinceIso}\0${savedJobIds.join(",")}`;
    const requestKey = `${memoKey}\0${attempt}`;
    const [settled, setSettled] = useState<{ key: string; state: NeedsYouRemoteState } | null>(null);

    const state = useMemo<NeedsYouRemoteState>(() => {
        if (!enabled) return { kind: "loading" };
        if (settled?.key === requestKey) return settled.state;
        const memo = attempt === 0 ? freshHubProbeMemo(needsYouMemo, memoKey, nowMs) : null;
        return memo ? { kind: "ready", data: memo.data } : { kind: "loading" };
    }, [enabled, settled, requestKey, attempt, memoKey, nowMs]);

    // The read takes the latest inputs; `memoKey` carries their content, so a new array with the same ids never re-reads.
    const inputsRef = useRef({ sinceIso, savedJobIds });
    useEffect(() => {
        inputsRef.current = { sinceIso, savedJobIds };
    }, [sinceIso, savedJobIds]);

    useEffect(() => {
        if (!enabled) return;
        if (attempt === 0 && freshHubProbeMemo(needsYouMemo, memoKey, Date.now())) return;
        let cancelled = false;
        // One quiet retry before the panel says it failed, like every other account
        // list (lib/server-list-cache.ts): a single dropped read is not worth a Retry button.
        void readWithRetry(() => settleEnvelope(listNeedsYouAction(inputsRef.current))).then((res) => {
            if (cancelled) return;
            if (!res.ok) {
                setSettled({ key: requestKey, state: { kind: "failed" } });
                return;
            }
            needsYouMemo = { key: memoKey, at: Date.now(), complete: true, data: res.data };
            setSettled({ key: requestKey, state: { kind: "ready", data: res.data } });
        });
        return () => {
            cancelled = true;
        };
    }, [enabled, memoKey, requestKey, attempt]);

    return { state, retry: () => setAttempt((n) => n + 1) };
}

const DOT_TONE: Record<NeedsYouItem["tone"], string> = {
    warn: "bg-warn",
    brand: "bg-brand",
    muted: "bg-muted-foreground",
};

export function NeedsYouView({
    items,
    remote,
    steps,
    guest,
    onItem,
    onStep,
    onTracker,
    onShowMore,
    onRetry,
}: {
    /** Most urgent first; past `NEEDS_YOU_MAX_ITEMS` the rest wait behind "Show N more". */
    items: NeedsYouItem[];
    remote: NeedsYouRemoteState["kind"];
    /** A new account's first steps, shown when nothing else needs them. */
    steps: StarterStep[] | null;
    guest: boolean;
    onItem: (item: NeedsYouItem) => void;
    onStep: (step: StarterStep) => void;
    /** "Open tracker" on the empty list. */
    onTracker: () => void;
    onShowMore: () => void;
    onRetry: () => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const shown = expanded ? items : items.slice(0, NEEDS_YOU_MAX_ITEMS);
    const hidden = items.length - shown.length;
    const loading = remote === "loading";
    const starter = !loading && remote !== "failed" && items.length === 0 && steps != null;
    return (
        <section id="today-needs-you" data-testid="today-needs-you" aria-labelledby="today-needs-you-title" className="min-w-0 scroll-mt-24">
            <div className="flex items-baseline justify-between gap-3 border-b border-border poster-list-inset-x py-2 text-sm text-muted-foreground">
                <SubTitle id="today-needs-you-title">Needs you</SubTitle>
                {items.length > 0 ? (
                    <span data-testid="today-needs-you-count">{items.length} to do</span>
                ) : starter ? (
                    <span>Get started</span>
                ) : null}
            </div>

            {shown.length > 0 ? (
                <ul aria-label="Needs you">
                    {shown.map((item) => (
                        <NeedsYouRow key={item.key} item={item} onClick={() => onItem(item)} />
                    ))}
                </ul>
            ) : null}

            {loading ? (
                <WaitState
                    label="Checking your saved searches and companies"
                    data-testid="today-needs-you-loading"
                    skeleton={
                        <div className="poster-list-inset-x pt-3">
                            <div className="space-y-2 border-b border-border pb-3">
                                <WaitBar className="h-4 w-2/3" />
                                <WaitBar className="h-3 w-1/2" />
                            </div>
                        </div>
                    }
                />
            ) : remote === "failed" ? (
                <div className="poster-list-inset-x pt-3">
                    <LoadFailedState
                        title="We can't check your saved searches right now."
                        onRetry={onRetry}
                        testId="today-needs-you-failed"
                    />
                </div>
            ) : starter && steps ? (
                <ol aria-label="Get started" data-testid="today-starter">
                    {steps.map((step, i) => (
                        <StarterRow key={step.key} step={step} index={i + 1} onClick={() => onStep(step)} />
                    ))}
                </ol>
            ) : items.length === 0 ? (
                <div data-testid="today-needs-you-empty" className="space-y-3 poster-list-inset-x py-6">
                    <p className="text-sm text-foreground">Nothing needs you right now.</p>
                    {guest ? (
                        <p className="text-sm text-muted-foreground">
                            Save or apply to roles and their follow-ups and interviews land here.
                        </p>
                    ) : null}
                    <Button asChild variant="outline">
                        <Link href="/yours" data-testid="today-needs-you-tracker" onClick={onTracker}>
                            Open tracker
                        </Link>
                    </Button>
                </div>
            ) : null}

            {hidden > 0 ? (
                <div className="poster-list-inset-x pt-3">
                    <Button
                        type="button"
                        variant="ghost"
                        data-testid="today-needs-you-more"
                        onClick={() => {
                            onShowMore();
                            setExpanded(true);
                        }}
                    >
                        Show {hidden} more
                    </Button>
                </div>
            ) : null}
        </section>
    );
}

function ActionLink({ href, testId, onClick, children }: { href: string; testId: string; onClick: () => void; children: string }) {
    // An in-page anchor ("#today-new") scrolls; everything else is a route. A text
    // button, like the picks' Apply beside it: a bordered button on every line of
    // the list was most of what made Today read as busy.
    return (
        <Button asChild variant="ghost" size="sm" className="-mr-3">
            {href.startsWith("#") ? (
                <a href={href} data-testid={testId} onClick={onClick}>
                    {children}
                </a>
            ) : (
                <Link href={href} data-testid={testId} onClick={onClick}>
                    {children}
                </Link>
            )}
        </Button>
    );
}

function NeedsYouRow({ item, onClick }: { item: NeedsYouItem; onClick: () => void }) {
    return (
        <li data-testid="today-needs-you-item" data-kind={item.kind} className="poster-list-inset-x pt-3">
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-border pb-3">
                <span aria-hidden className={cn("size-2 shrink-0 rounded-pill", DOT_TONE[item.tone])} />
                <div className="min-w-0">
                    <p className="text-sm font-semibold leading-snug text-foreground">{item.title}</p>
                    <p className="line-clamp-2 text-sm text-muted-foreground">{item.detail}</p>
                </div>
                <ActionLink href={item.href} testId="today-needs-you-action" onClick={onClick}>
                    {item.action}
                </ActionLink>
            </div>
        </li>
    );
}

function StarterRow({ step, index, onClick }: { step: StarterStep; index: number; onClick: () => void }) {
    return (
        <li data-testid="today-starter-step" data-step={step.key} data-done={step.done} className="poster-list-inset-x pt-3">
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-border pb-3">
                <span
                    aria-hidden
                    className={cn(
                        "mono-data flex size-6 items-center justify-center rounded-pill border text-xs",
                        step.done ? "border-transparent bg-muted text-muted-foreground" : "border-border text-foreground",
                    )}
                >
                    {step.done ? <Check aria-hidden /> : index}
                </span>
                <p className={cn("text-sm leading-snug", step.done ? "text-muted-foreground line-through" : "text-foreground")}>
                    {step.label}
                    {step.done ? <span className="sr-only"> (done)</span> : null}
                </p>
                {step.done ? null : (
                    <ActionLink href={step.href} testId="today-starter-action" onClick={onClick}>
                        {step.action}
                    </ActionLink>
                )}
            </div>
        </li>
    );
}
