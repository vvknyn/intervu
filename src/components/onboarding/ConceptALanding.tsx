"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { BrandMark } from "@/components/brand/BrandMark";
import { AUTH_CTA_LABEL } from "@/lib/auth/auth-gate-copy";

const LIVE = "#0E9F4E";
const BG = "#0B0D12";
const CREAM = "#F4F0E6";
const NAVY = "#0C1A33";
const META = "#4A5568";

type Postcard = {
    title: string;
    meta: string;
    /** CSS transform pieces — tuned to match Concept A mock stack */
    style: CSSProperties;
};

const POSTCARDS: Postcard[] = [
    {
        title: "Remote AI roles",
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

function PostcardCard({ title, meta, style }: Postcard) {
    return (
        <div
            className="absolute w-[min(240px,58%)] sm:w-[260px] rounded-[14px] px-4 py-3.5 sm:px-5 sm:py-4"
            style={{
                background: CREAM,
                boxShadow:
                    "0 18px 40px -12px rgba(0,0,0,0.55), 0 4px 12px rgba(0,0,0,0.25)",
                ...style,
            }}
        >
            <div className="mb-3 flex items-center gap-2">
                <BrandMark className="h-5 w-5 opacity-90" />
                <span
                    className="h-px flex-1 max-w-[72px]"
                    style={{ background: "rgba(12,26,51,0.12)" }}
                    aria-hidden
                />
            </div>
            <p
                className="text-[15px] sm:text-[17px] font-semibold leading-snug tracking-tight"
                style={{ color: NAVY }}
            >
                {title}
            </p>
            <p className="mt-1 text-[11px] sm:text-xs leading-snug" style={{ color: META }}>
                {meta}
            </p>
            <div className="mt-3.5 flex items-center gap-1.5">
                <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: LIVE, boxShadow: `0 0 6px ${LIVE}` }}
                    aria-hidden
                />
                <span
                    className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.08em]"
                    style={{ color: LIVE }}
                >
                    LIVE
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
 * postcard stack). Portaled to document.body so site TopBar / light grid
 * never show behind it. CTA still advances into the real auth + résumé gate.
 */
export function ConceptALanding({ onStart, onSignIn }: ConceptALandingProps) {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = prev;
        };
    }, []);

    if (!mounted) return null;

    const face = (
        <div
            data-testid="concept-a-landing"
            className="fixed inset-0 z-[100] flex flex-col text-white"
            style={{
                backgroundColor: BG,
                backgroundImage:
                    "radial-gradient(ellipse 80% 60% at 70% 40%, rgba(255,255,255,0.03), transparent 60%), url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E\")",
            }}
        >
            {/* Top bar ON the dark face */}
            <header className="relative z-20 flex items-center justify-between px-5 sm:px-10 lg:px-14 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
                <div className="flex items-center gap-2.5" data-testid="concept-a-brand">
                    <BrandMark className="h-8 w-8" />
                    <span
                        data-rulebook-exempt
                        className="text-[22px] sm:text-[24px] font-semibold tracking-tight text-white leading-none"
                    >
                        Velai
                    </span>
                </div>
                <button
                    type="button"
                    onClick={onSignIn}
                    className="text-sm sm:text-[15px] font-medium text-white/95 hover:text-white transition-colors"
                    data-testid="concept-a-sign-in"
                >
                    {AUTH_CTA_LABEL}
                </button>
            </header>

            {/* Hero + postcard stack */}
            <div className="relative z-10 flex flex-1 flex-col lg:flex-row items-stretch lg:items-center px-5 sm:px-10 lg:px-14 pb-10 lg:pb-16 gap-8 lg:gap-6 min-h-0">
                <div className="flex flex-col justify-center max-w-xl lg:max-w-[520px] shrink-0 pt-6 lg:pt-0 lg:w-[46%]">
                    <h1 className="text-[clamp(2.5rem,7vw,4.75rem)] font-semibold tracking-tight text-white leading-[1.05]">
                        Skip the job
                        <br />
                        board dump.
                    </h1>
                    <p
                        className="mt-5 sm:mt-6 text-base sm:text-lg lg:text-xl font-semibold leading-snug max-w-md"
                        style={{ color: LIVE }}
                    >
                        8 Job Packs from live employer career pages
                    </p>
                    <button
                        type="button"
                        onClick={onStart}
                        data-testid="concept-a-cta"
                        className="mt-7 sm:mt-8 inline-flex items-center justify-center self-start h-12 sm:h-[52px] px-7 sm:px-8 rounded-full text-[15px] sm:text-base font-semibold transition-transform active:scale-[0.99] hover:brightness-110"
                        style={{ backgroundColor: LIVE, color: "#0B0D12" }}
                    >
                        Start with your résumé →
                    </button>
                </div>

                <div
                    className="relative flex-1 min-h-[280px] sm:min-h-[360px] lg:min-h-[480px] w-full lg:w-[54%]"
                    aria-hidden
                >
                    {POSTCARDS.map((card) => (
                        <PostcardCard key={card.title} {...card} />
                    ))}
                </div>
            </div>
        </div>
    );

    return createPortal(face, document.body);
}
