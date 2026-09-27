"use client";

// design-lint-allow-file: isolated Concept A public poster — pixel-matched dark
// landing face with cream postcard stack; not app chrome or token surfaces.

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

const POSTCARDS: Postcard[] = [
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
];

/** Decorative stack lines — no text nodes (fan overlap breaks axe bg resolution). */
function PostcardCard({ style }: Pick<Postcard, "style">) {
    return (
        <div
            className={cn(
                "absolute w-[min(268px,72vw)] sm:w-[260px] rounded-panel px-4 py-3.5 sm:px-5 sm:py-4",
                "bg-surface-postcard text-surface-postcard-foreground shadow-[var(--shadow-postcard)]",
            )}
            style={style}
        >
            <div className="mb-3 flex items-center gap-2">
                <BrandMark className="h-5 w-5 opacity-90" />
                <span className="h-px flex-1 max-w-[72px] bg-border" aria-hidden />
            </div>
            <div
                className="h-3.5 w-[88%] rounded-none bg-surface-postcard-foreground"
                aria-hidden
                data-testid="concept-a-postcard-title"
            />
            <div className="mt-2 h-2.5 w-[58%] rounded-none bg-surface-postcard-muted" aria-hidden />
            <div className="mt-3.5 flex items-center gap-1.5" aria-hidden>
                <span className="size-1.5 rounded-pill bg-live-on-postcard instrument-breathe" />
                <span className="h-2.5 w-9 rounded-none bg-live-on-postcard" />
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
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        const main = document.querySelector("main");
        const prevMainDisplay = main?.style.display ?? "";
        // In-flow shell + spacer share the hero bbox; axe counts them as obscuring the portaled h1.
        if (main) main.style.display = "none";
        return () => {
            document.body.style.overflow = prevOverflow;
            if (main) main.style.display = prevMainDisplay;
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
                "bg-surface-poster text-surface-poster-foreground",
            )}
        >
            <header className="relative z-20 flex items-center justify-between bg-surface-poster px-5 sm:px-10 lg:px-14 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
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
                <div className="relative z-30 flex flex-col justify-center max-w-xl lg:max-w-[520px] shrink-0 bg-surface-poster pt-6 lg:pt-0 lg:w-[46%]">
                    <h1 className="flex w-fit flex-col gap-2 bg-surface-poster text-poster-hero font-semibold leading-none">
                        <span className="block overflow-hidden h-[1em]">Skip the job</span>
                        <span className="block overflow-hidden h-[1em]">board dump.</span>
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
                    className="relative z-0 flex-1 min-h-[280px] sm:min-h-[360px] lg:min-h-[480px] w-full overflow-hidden lg:w-[54%] poster-noise"
                    aria-hidden
                >
                    {POSTCARDS.map((card) => (
                        <PostcardCard key={card.title} style={card.style} />
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
