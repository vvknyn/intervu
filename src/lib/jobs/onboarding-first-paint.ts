/** localStorage key + document classes for Concept A first paint (SSR + blocking script). */
export const ONBOARDING_COMPLETED_STORAGE_KEY = "velai.onboarding.completed";

export const ONBOARDING_COMPLETE_HTML_CLASS = "velai-onboarding-complete";
export const JOBS_SKIP_LANDING_HTML_CLASS = "velai-jobs-skip-landing";
/** Set on `<html>` before TopBar paints on /jobs when Step 1 should show. */
export const CONCEPT_A_LANDING_PENDING_HTML_CLASS = "concept-a-landing-pending";

export function readOnboardingCompletedFromStorage(): boolean {
    if (typeof window === "undefined") return false;
    try {
        return window.localStorage.getItem(ONBOARDING_COMPLETED_STORAGE_KEY) === "1";
    } catch {
        return false;
    }
}

export function writeOnboardingCompletedInStorage(): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(ONBOARDING_COMPLETED_STORAGE_KEY, "1");
        document.documentElement.classList.add(ONBOARDING_COMPLETE_HTML_CLASS);
        document.documentElement.classList.add(JOBS_SKIP_LANDING_HTML_CLASS);
        document.documentElement.classList.remove(CONCEPT_A_LANDING_PENDING_HTML_CLASS);
        window.dispatchEvent(new Event("velai-onboarding-storage"));
    } catch {
        /* private mode */
    }
}

export function subscribeOnboardingCompleted(onStoreChange: () => void): () => void {
    if (typeof window === "undefined") return () => {};
    window.addEventListener("storage", onStoreChange);
    window.addEventListener("velai-onboarding-storage", onStoreChange);
    return () => {
        window.removeEventListener("storage", onStoreChange);
        window.removeEventListener("velai-onboarding-storage", onStoreChange);
    };
}

/** Inline script — runs in `<head>` before body chrome paints (pathname-gated). */
export const JOBS_ONBOARDING_HEAD_SCRIPT = `(function(){try{var p=location.pathname;if(p!=="/jobs"&&p.indexOf("/jobs/")!==0)return;var done=localStorage.getItem("${ONBOARDING_COMPLETED_STORAGE_KEY}")==="1";if(done){document.documentElement.classList.add("${ONBOARDING_COMPLETE_HTML_CLASS}");}else{document.documentElement.classList.add("${CONCEPT_A_LANDING_PENDING_HTML_CLASS}");}}catch(e){document.documentElement.classList.add("${CONCEPT_A_LANDING_PENDING_HTML_CLASS}");}})();`;

/** Inline script — runs at jobs layout parse time (legacy body class for hydration). */
export const JOBS_ONBOARDING_FIRST_PAINT_SCRIPT = `(function(){try{var done=localStorage.getItem("${ONBOARDING_COMPLETED_STORAGE_KEY}")==="1";if(done){document.documentElement.classList.add("${ONBOARDING_COMPLETE_HTML_CLASS}");}else{document.body.classList.add("concept-a-landing-active");}}catch(e){document.body.classList.add("concept-a-landing-active");}})();`;
