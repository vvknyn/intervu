import { BrandMark, BRAND_LOCKUP_WORDMARK_CLASS } from "@/components/brand/BrandMark";
import { Button } from "@/components/ui/button";
import { AUTH_CTA_LABEL } from "@/lib/auth/auth-gate-copy";
import { CATEGORY_HUB_PACK_COUNT } from "@/lib/jobs/category-hub-count";
import { cn } from "@/lib/utils";
import {
    CONCEPT_A_POSTCARD_CLASS,
    CONCEPT_A_POSTCARD_STACK_CLASS,
    POSTCARDS,
} from "@/components/onboarding/concept-a-postcards";

function PostcardCard({
    title,
    meta,
    style,
    index,
}: (typeof POSTCARDS)[number] & { index: number }) {
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
                <BrandMark className="h-5 w-5 opacity-90" pixelSize={20} />
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

export interface ConceptALandingFaceProps {
    id?: string;
    /** When false, CTAs are inert until client hydration attaches handlers. */
    interactive?: boolean;
    onStart?: () => void;
    onSignIn?: () => void;
}

/**
 * Shared Concept A Step 1 markup — used by SSR shell and client fallback.
 * Pixel-identical to the approved fan geometry (POSTCARDS constants).
 */
export function ConceptALandingFace({
    id,
    interactive = false,
    onStart,
    onSignIn,
}: ConceptALandingFaceProps) {
    return (
        <div
            id={id}
            data-testid="concept-a-landing"
            className={cn(
                "fixed inset-0 z-[var(--z-landing-poster)] flex flex-col",
                "bg-surface-poster text-surface-poster-foreground poster-noise",
            )}
        >
            <header className="relative z-20 flex items-center justify-between px-5 sm:px-10 lg:px-14 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
                <div className="flex items-center gap-2.5" data-testid="concept-a-brand">
                    <BrandMark className="h-8 w-8" pixelSize={32} priority />
                    <span
                        data-rulebook-exempt
                        className={[BRAND_LOCKUP_WORDMARK_CLASS, "text-title-sm sm:text-title font-semibold leading-none"].join(" ")}
                    >
                        Velai
                    </span>
                </div>
                <button
                    type="button"
                    onClick={interactive ? onSignIn : undefined}
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
                        onClick={interactive ? onStart : undefined}
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
}
