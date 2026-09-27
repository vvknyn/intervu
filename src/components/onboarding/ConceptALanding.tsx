"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { BrandMark, BRAND_LOCKUP_WORDMARK_CLASS } from "@/components/brand/BrandMark";
import { Button } from "@/components/ui/button";
import { AUTH_CTA_LABEL } from "@/lib/auth/auth-gate-copy";
import { CATEGORY_HUB_PACK_COUNT } from "@/lib/jobs/category-hub-count";
import { cn } from "@/lib/utils";

type Postcard = {
    title: string;
    meta: string;
    /** CSS transform pieces — tuned to match Concept A mock stack */
    style: CSSProperties;
};

/** Owner-approved fan geometry — guarded by unit tests; do not recompose without review. */
export const POSTCARDS = [
    {
        title: "Remote AI Roles",
        meta: "Remote · Full-time",
        style: {
            top: "6%",
            left: "18%",
            transform: "rotate(-11deg)",
            zIndex: 1,
        },
    },
    {
        title: "Product Designer",
        meta: "New York, NY · Full-time",
        style: {
            top: "18%",
            left: "48%",
            transform: "rotate(8deg)",
            zIndex: 2,
        },
    },
    {
        title: "Growth Marketing Lead",
        meta: "Remote · MA · Full-time",
        style: {
            top: "52%",
            left: "42%",
            transform: "rotate(12deg)",
            zIndex: 3,
        },
    },
    {
        title: "Data Scientist",
        meta: "Boston, MA · Full-time",
        style: {
            top: "58%",
            left: "8%",
            transform: "rotate(-7deg)",
            zIndex: 4,
        },
    },
    {
        title: "Software Engineer",
        meta: "San Francisco, CA · Full-time",
        style: {
            top: "26%",
            left: "20%",
            transform: "rotate(-3deg)",
            zIndex: 5,
        },
    },
] as const satisfies readonly Postcard[];

export const CONCEPT_A_POSTCARD_CLASS = "concept-a-postcard";
export const CONCEPT_A_POSTCARD_STACK_CLASS = "concept-a-postcard-stack";

/** Document body class while Step 1 portal is mounted; pairs with globals.css site-chrome hide. */
export const CONCEPT_A_LANDING_BODY_CLASS = "concept-a-landing-active";

function PostcardCard({
    title,
    meta,
    style,
    index,
}: Postcard & { index: number }) {
    return (
        <div
            data-testid={`concept-a-postcard-${index}`}
            className={cn(
                "absolute rounded-panel px-4 py-3.5 sm:px-5 sm:py-4",
                CONCEPT_A_POSTCARD_CLASS,
                "bg-surface-postcard text-surface-postcard-foreground shadow-[var(--shadow-postcard)]",
            )}
            style={style}
        >
            <div className="mb-3 flex items-center gap-2">
                <BrandMark className="h-5 w-5 opacity-90" />
                <span className="h-px flex-1 max-w-[72px] bg-border" aria-hidden />
            </div>
            <p
                data-testid={`concept-a-postcard-${index}-title`}
                className="text-sm sm:text-lg font-semibold leading-snug text-surface-postcard-foreground whitespace-normal"
            >
                {title}
            </p>
            <p
                data-testid={`concept-a-postcard-${index}-meta`}
                className="mt-1 text-caption sm:text-xs leading-snug text-surface-postcard-muted"
            >
                {meta}
            </p>
            <div className="mt-3.5 flex items-center gap-1.5">
                <span
                    className="size-1.5 rounded-pill bg-live-on-postcard instrument-breathe"
                    aria-hidden
                />
                <span
                    data-testid={`concept-a-postcard-${index}-live`}
                    className="text-caption font-semibold text-live-on-postcard"
                >
                    Live
                </span>
            </div>
        </div>
    );
}

export interface ConceptALandingProps {
    onStart: () => void;
    onSignIn: () => void;
}

/**
 * Public signed-out Step 1 — full-bleed Concept A (charcoal poster + cream
 * postcard stack). Portaled to document.body so site TopBar never shows behind
 * it. An in-flow min-h-[100dvh] spacer keeps the landing parent from
 * collapsing while Step 1 is up.
 */
export function ConceptALanding({ onStart, onSignIn }: ConceptALandingProps) {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        document.body.classList.add(CONCEPT_A_LANDING_BODY_CLASS);
        return () => {
            document.body.style.overflow = prev;
            document.body.classList.remove(CONCEPT_A_LANDING_BODY_CLASS);
        };
    }, []);

    const spacer = (
        <div
            className="min-h-[100dvh] w-full"
            aria-hidden
            data-testid="landing-onboarding-step-1-spacer"
        />
    );

    if (!mounted) return spacer;

    const face = (
        <div
            data-testid="concept-a-landing"
            className={cn(
                "fixed inset-0 z-[var(--z-landing-poster)] flex flex-col",
                "bg-surface-poster text-surface-poster-foreground poster-noise",
            )}
        >
            <header className="relative z-20 flex items-center justify-between px-5 sm:px-10 lg:px-14 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
                <div className="flex items-center gap-2.5" data-testid="concept-a-brand">
                    <BrandMark className="h-8 w-8" />
                    <span
                        data-rulebook-exempt
                        className={[BRAND_LOCKUP_WORDMARK_CLASS, "text-title-sm sm:text-title font-semibold leading-none"].join(" ")}
                    >
                        Velai
                    </span>
                </div>
                <button
                    type="button"
                    onClick={onSignIn}
                    className="text-sm sm:text-base font-normal text-surface-poster-muted hover:text-surface-poster-foreground transition-colors"
                    data-testid="concept-a-sign-in"
                >
                    {AUTH_CTA_LABEL}
                </button>
            </header>

            <div className="relative z-10 flex flex-1 flex-col lg:flex-row items-stretch lg:items-center px-5 sm:px-10 lg:px-14 pb-10 lg:pb-16 gap-8 lg:gap-6 min-h-0">
                <div className="flex flex-col justify-center max-w-xl lg:max-w-[520px] shrink-0 pt-6 lg:pt-0 lg:w-[46%]">
                    <h1 className="text-poster-hero font-semibold">
                        Skip the job
                        <br />
                        board dump.
                    </h1>
                    <p className="mt-5 sm:mt-6 text-base sm:text-lg lg:text-xl font-semibold leading-snug max-w-md text-live">
                        {CATEGORY_HUB_PACK_COUNT} Job Packs from live employer career pages
                    </p>
                    <Button
                        type="button"
                        onClick={onStart}
                        data-testid="concept-a-cta"
                        variant="accent"
                        size="accent"
                        className="mt-7 sm:mt-8 self-start active:scale-[0.99]"
                    >
                        Start with your résumé →
                    </Button>
                </div>

                <div
                    className={cn(
                        "relative flex-1 min-h-[280px] sm:min-h-[360px] lg:min-h-[480px] w-full overflow-visible lg:w-[54%]",
                        CONCEPT_A_POSTCARD_STACK_CLASS,
                    )}
                    aria-hidden
                    role="presentation"
                    data-testid="concept-a-postcard-stack"
                >
                    {POSTCARDS.map((card, index) => (
                        <PostcardCard key={card.title} {...card} index={index} />
                    ))}
                </div>
            </div>
        </div>
    );

    return (
        <>
            {spacer}
            {createPortal(face, document.body)}
        </>
    );
}
