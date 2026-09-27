"use client";

import { useEffect } from "react";
import { CONCEPT_A_LANDING_BODY_CLASS } from "@/components/onboarding/ConceptALanding";
import {
    JOBS_SKIP_LANDING_HTML_CLASS,
    ONBOARDING_COMPLETE_HTML_CLASS,
} from "@/lib/jobs/onboarding-first-paint";

export interface ConceptALandingHydrationProps {
    onStart: () => void;
    onSignIn: () => void;
}

/** Wire SSR Concept A controls after hydration — no duplicate portal face. */
export function ConceptALandingHydration({ onStart, onSignIn }: ConceptALandingHydrationProps) {
    useEffect(() => {
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        document.body.classList.add(CONCEPT_A_LANDING_BODY_CLASS);
        document.documentElement.classList.remove(JOBS_SKIP_LANDING_HTML_CLASS);
        document.documentElement.classList.remove(ONBOARDING_COMPLETE_HTML_CLASS);

        const signIn = document.querySelector<HTMLButtonElement>('[data-testid="concept-a-sign-in"]');
        const cta = document.querySelector<HTMLButtonElement>('[data-testid="concept-a-cta"]');

        const onSignInClick = (event: Event) => {
            event.preventDefault();
            onSignIn();
        };
        const onStartClick = (event: Event) => {
            event.preventDefault();
            onStart();
        };

        signIn?.addEventListener("click", onSignInClick);
        cta?.addEventListener("click", onStartClick);

        return () => {
            signIn?.removeEventListener("click", onSignInClick);
            cta?.removeEventListener("click", onStartClick);
            document.body.style.overflow = prevOverflow;
            document.body.classList.remove(CONCEPT_A_LANDING_BODY_CLASS);
        };
    }, [onStart, onSignIn]);

    return null;
}
