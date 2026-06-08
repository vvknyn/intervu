"use client";

import {
    UploadSimple,
    MagnifyingGlass,
    Target,
    Compass,
    ArrowRight,
    Briefcase,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type GateStep = "ask" | "choose";

interface JobsEntryGateProps {
    step: GateStep;
    /** Short resume label for the choose screen (e.g. the profession). */
    resumeLabel?: string | null;
    /** True while the Explore AI suggestion call is in flight. */
    exploring?: boolean;
    onUpload: () => void;
    onSearchOnly: () => void;
    onMatch: () => void;
    onExplore: () => void;
    onDifferentResume: () => void;
    onBrowseAll: () => void;
}

/** Low-emphasis "skip the gate" link shown on both screens. */
function BrowseAll({ onClick }: { onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className="mt-6 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
            or browse all live roles
            <ArrowRight size={12} />
        </button>
    );
}

/**
 * The front gate for /jobs. Two presentational screens — ASK (upload your
 * resume?) and CHOOSE (Match vs Explore) — wired entirely through callbacks.
 * Lives apart from the 850-line page so the gate stays self-contained.
 */
export function JobsEntryGate({
    step,
    resumeLabel,
    exploring = false,
    onUpload,
    onSearchOnly,
    onMatch,
    onExplore,
    onDifferentResume,
    onBrowseAll,
}: JobsEntryGateProps) {
    if (step === "ask") {
        return (
            <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-16 text-center sm:py-24">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/10 text-brand">
                    <Briefcase size={26} weight="duotone" />
                </div>
                <h2 className="mt-5 text-2xl font-bold tracking-tight">Tailor jobs to your resume?</h2>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                    Add your résumé and we&apos;ll line up roles that fit your background — or ones that
                    stretch you in a good direction. Prefer to drive yourself? Search instead.
                </p>
                <div className="mt-7 flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row">
                    <Button variant="brand" onClick={onUpload} className="gap-2">
                        <UploadSimple size={17} weight="bold" />
                        Upload résumé
                    </Button>
                    <Button variant="outline" onClick={onSearchOnly} className="gap-2">
                        <MagnifyingGlass size={16} />
                        No, I&apos;ll search
                    </Button>
                </div>
                <BrowseAll onClick={onBrowseAll} />
            </div>
        );
    }

    // step === "choose"
    return (
        <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-14 text-center sm:py-20">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>
                    Using{" "}
                    <span className="font-medium text-foreground">{resumeLabel?.trim() || "your resume"}</span>
                </span>
                <span className="text-border">·</span>
                <button onClick={onDifferentResume} className="font-medium text-brand hover:underline">
                    use a different resume
                </button>
            </div>
            <h2 className="mt-3 text-2xl font-bold tracking-tight">How do you want to look?</h2>

            <div className="mt-7 grid w-full gap-4 sm:grid-cols-2">
                {/* Match */}
                <button
                    onClick={onMatch}
                    disabled={exploring}
                    className={cn(
                        "group flex flex-col items-start rounded-2xl border border-border bg-card p-5 text-left transition-all",
                        "hover:border-brand/40 hover:shadow-sm disabled:opacity-60",
                    )}
                >
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand/10 text-brand">
                        <Target size={22} weight="duotone" />
                    </div>
                    <div className="mt-4 text-base font-semibold">Match my resume</div>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        Live roles closest to your title and experience level.
                    </p>
                    <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        Free · instant
                        <ArrowRight size={13} className="opacity-0 transition-opacity group-hover:opacity-100" />
                    </div>
                </button>

                {/* Explore */}
                <button
                    onClick={onExplore}
                    disabled={exploring}
                    className={cn(
                        "group flex flex-col items-start rounded-2xl border border-border bg-card p-5 text-left transition-all",
                        "hover:border-brand/40 hover:shadow-sm disabled:cursor-wait disabled:opacity-80",
                    )}
                >
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand/10 text-brand">
                        {exploring ? (
                            <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand/20 border-t-brand" />
                        ) : (
                            <Compass size={22} weight="duotone" />
                        )}
                    </div>
                    <div className="mt-4 text-base font-semibold">Explore adjacent roles</div>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        {exploring
                            ? "Finding roles you're well-positioned for…"
                            : "Tangential roles you're well-positioned for but might not search."}
                    </p>
                    <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        Uses 1 AI credit
                        <ArrowRight size={13} className="opacity-0 transition-opacity group-hover:opacity-100" />
                    </div>
                </button>
            </div>

            <BrowseAll onClick={onBrowseAll} />
        </div>
    );
}
