"use client";

/**
 * Mounted once under the header (app/layout.tsx): points the setup store at
 * the signed-in account and renders the setup sheet.
 * Renders nothing for a guest or an account with no setup to offer.
 */
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { onAuthChange } from "@/lib/firebase/client-auth";
import { finishIfAllHeld, loadOnboarding, openSetupSheet, refreshOnboardingIfStale, useOnboarding } from "@/hooks/use-onboarding";
import { isSetupLink, withoutSetupLink } from "@/lib/onboarding/links";
import { shouldHideSiteChrome } from "@/components/layout/should-hide-site-chrome";
import { SetupSheet } from "./SetupSheet";

export function OnboardingRoot() {
    const pathname = usePathname();
    const { view, outcomes, open } = useOnboarding();
    const setupLinkPending = useRef(false);

    useEffect(() => onAuthChange((user) => loadOnboarding(user?.uid ?? null)), []);

    useEffect(() => {
        const onVisible = () => {
            if (document.visibilityState === "visible") refreshOnboardingIfStale();
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => document.removeEventListener("visibilitychange", onVisible);
    }, []);

    // Every step answered by what the account already holds (a search saved
    // from the toolbar, say): close setup without asking for a tap.
    useEffect(() => {
        if (view && outcomes) finishIfAllHeld();
    }, [view, outcomes]);

    // The welcome email's "Finish setup" (/jobs?setup=open). Taken off the
    // address at once, before /jobs rewrites its own URL, and acted on once
    // the account's setup is known. Read from the address rather than
    // useSearchParams so the root layout keeps rendering statically.
    useEffect(() => {
        const { pathname: path, search, hash } = window.location;
        if (!isSetupLink(path, search)) return;
        setupLinkPending.current = true;
        window.history.replaceState(window.history.state, "", withoutSetupLink(path, search, hash));
    }, [pathname]);

    useEffect(() => {
        if (!setupLinkPending.current || view === undefined) return;
        setupLinkPending.current = false;
        if (view && open) openSetupSheet("email");
    }, [view, open, pathname]);

    if (!view || shouldHideSiteChrome(pathname)) return null;
    return <SetupSheet />;
}
