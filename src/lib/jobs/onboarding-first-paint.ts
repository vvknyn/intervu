/** localStorage key + document classes for Concept A first paint (SSR + blocking script). */
export const ONBOARDING_COMPLETED_STORAGE_KEY = "velai.onboarding.completed";

export const ONBOARDING_COMPLETE_HTML_CLASS = "velai-onboarding-complete";
export const JOBS_SKIP_LANDING_HTML_CLASS = "velai-jobs-skip-landing";
/** Body mirror — survives Next `<html>` hydration resets that drop the html class. */
export const JOBS_SKIP_LANDING_BODY_CLASS = "velai-jobs-skip-landing";
/** Set on `<html>` before TopBar paints on /jobs when Step 1 should show. */
export const CONCEPT_A_LANDING_PENDING_HTML_CLASS = "concept-a-landing-pending";

/** Hide SSR Concept A poster once the client route gate or onboarding advances. */
export function hideJobsSsrLanding(): void {
    if (typeof document === "undefined") return;
    document.documentElement.classList.add(JOBS_SKIP_LANDING_HTML_CLASS);
    document.body.classList.add(JOBS_SKIP_LANDING_BODY_CLASS);
    if (readOnboardingCompletedFromStorage()) {
        document.documentElement.classList.remove(CONCEPT_A_LANDING_PENDING_HTML_CLASS);
    }
    document.body.classList.remove("concept-a-landing-active");
}

/** Restore the SSR poster after Back from the account card to Step 1. */
export function restoreJobsSsrLanding(): void {
    if (typeof document === "undefined") return;
    document.documentElement.classList.remove(JOBS_SKIP_LANDING_HTML_CLASS);
    document.body.classList.remove(JOBS_SKIP_LANDING_BODY_CLASS);
    if (!readOnboardingCompletedFromStorage()) {
        document.documentElement.classList.add(CONCEPT_A_LANDING_PENDING_HTML_CLASS);
        document.body.classList.add("concept-a-landing-active");
    }
    window.dispatchEvent(new Event("velai-onboarding-storage"));
}

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
        hideJobsSsrLanding();
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

/** `/jobs/<slug>` is a shared job, not the Concept A hub. The hub poster and
 *  chrome-hide classes must not apply there — the jobs layout wraps both routes. */
export function isSharedJobPath(pathname: string): boolean {
    return pathname.startsWith("/jobs/") && pathname.length > "/jobs/".length;
}

/** Keep the site header on a shared job and hide the hub poster that the
 *  shared `jobs` layout also mounts. */
export function revealSharedJobHeader(): void {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.classList.add(JOBS_SKIP_LANDING_HTML_CLASS);
    root.classList.remove(CONCEPT_A_LANDING_PENDING_HTML_CLASS);
    document.body.classList.add(JOBS_SKIP_LANDING_BODY_CLASS);
    document.body.classList.remove("concept-a-landing-active");
}

/** Inline script — runs in `<head>` before body chrome paints (pathname-gated).
 *  Exact `/jobs` may hide the site header for Step 1. Any `/jobs/<slug>` shared
 *  job keeps that header and suppresses the hub poster. */
export const JOBS_ONBOARDING_HEAD_SCRIPT = `(function(){try{var p=location.pathname;if(p!=="/jobs"&&p.indexOf("/jobs/")!==0)return;function onBody(fn){if(document.body)fn();else document.addEventListener("DOMContentLoaded",fn,{once:true});}if(p.indexOf("/jobs/")===0&&p.length>"/jobs/".length){document.documentElement.classList.add("${JOBS_SKIP_LANDING_HTML_CLASS}");document.documentElement.classList.remove("${CONCEPT_A_LANDING_PENDING_HTML_CLASS}");onBody(function(){document.body.classList.add("${JOBS_SKIP_LANDING_BODY_CLASS}");document.body.classList.remove("concept-a-landing-active");});return;}var done=localStorage.getItem("${ONBOARDING_COMPLETED_STORAGE_KEY}")==="1";if(done){document.documentElement.classList.add("${ONBOARDING_COMPLETE_HTML_CLASS}");}else{document.documentElement.classList.add("${CONCEPT_A_LANDING_PENDING_HTML_CLASS}");}onBody(function(){if(done){document.body.classList.remove("concept-a-landing-active");}else{document.body.classList.add("concept-a-landing-active");}});}catch(e){var path=location.pathname;if(path.indexOf("/jobs/")===0&&path.length>"/jobs/".length){document.documentElement.classList.add("${JOBS_SKIP_LANDING_HTML_CLASS}");return;}if(path!=="/jobs")return;document.documentElement.classList.add("${CONCEPT_A_LANDING_PENDING_HTML_CLASS}");function fallback(){if(document.body)document.body.classList.add("concept-a-landing-active");}fallback();if(!document.body)document.addEventListener("DOMContentLoaded",fallback,{once:true});}})();`;
