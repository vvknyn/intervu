"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ConceptALandingFace } from "@/components/onboarding/ConceptALandingFace";
import { ConceptALandingHydration } from "@/components/onboarding/ConceptALandingHydration";
import { CONCEPT_A_POSTCARD_CLASS, CONCEPT_A_POSTCARD_STACK_CLASS, POSTCARDS } from "@/components/onboarding/concept-a-postcards";

export { POSTCARDS, CONCEPT_A_POSTCARD_CLASS, CONCEPT_A_POSTCARD_STACK_CLASS };

/** Document body class while Step 1 portal is mounted; pairs with globals.css site-chrome hide. */
export const CONCEPT_A_LANDING_BODY_CLASS = "concept-a-landing-active";

export interface ConceptALandingProps {
    onStart: () => void;
    onSignIn: () => void;
}

const SSR_SHELL_ID = "concept-a-ssr";

/**
 * Public signed-out Step 1 — full-bleed Concept A (charcoal poster + cream
 * postcard stack). Prefer the SSR shell from `jobs/layout` + hydration bridge;
 * fall back to a client portal when tests mount without the layout shell.
 */
export function ConceptALanding({ onStart, onSignIn }: ConceptALandingProps) {
    const [ssrShell, setSsrShell] = useState<boolean | null>(null);

    useLayoutEffect(() => {
        setSsrShell(Boolean(document.getElementById(SSR_SHELL_ID)));
    }, []);

    useEffect(() => {
        if (ssrShell) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        document.body.classList.add(CONCEPT_A_LANDING_BODY_CLASS);
        return () => {
            document.body.style.overflow = prev;
            document.body.classList.remove(CONCEPT_A_LANDING_BODY_CLASS);
        };
    }, [ssrShell]);

    if (ssrShell === null) {
        return <div className="min-h-[100dvh] w-full" aria-hidden data-testid="landing-onboarding-step-1-spacer" />;
    }

    if (ssrShell) {
        return <ConceptALandingHydration onStart={onStart} onSignIn={onSignIn} />;
    }

    const face = (
        <ConceptALandingFace interactive onStart={onStart} onSignIn={onSignIn} />
    );

    return createPortal(face, document.body);
}
