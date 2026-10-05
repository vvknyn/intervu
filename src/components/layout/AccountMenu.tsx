"use client";

import { useState } from "react";
import Link from "next/link";
import { InlineSpinner } from "@/components/ui/wait-state";
import type { User } from "@/lib/firebase/client-auth";
import { UserAvatar } from "@/components/ui/user-avatar";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FeedbackModal } from "@/components/modals/FeedbackModal";
import { cn } from "@/lib/utils";
import { GHOST_JOB_RESEARCH_TITLE } from "@/lib/seo/ghost-job-term";
import { useShareControl } from "@/components/ui/share-action";
import { withShareRef } from "@/lib/share/share-decision";
import { getSiteUrl, SHARE_APP_TEXT, SITE_NAME } from "@/lib/seo/constants";
import { openSetupSheet, useOnboarding } from "@/hooks/use-onboarding";
import { setupStepsLeftLabel } from "@/lib/onboarding/copy";
import { SETUP_STEPS } from "@/lib/onboarding/state";

/** "Share Velai" account-menu entry — same share control as JobDetail's
 *  ShareAction (native sheet, clipboard fallback, honest failure), rendered
 *  as a plain DropdownMenuItem so it keeps this menu's own keyboard/click
 *  handling rather than nesting a second interactive element inside it.
 *  `onSelect` is prevented so the menu stays open long enough to show the
 *  transient "Copied"/"Couldn't share" text. */
function ShareVelaiMenuItem() {
    const { state, trigger } = useShareControl();
    const label = state === "copied" ? "Copied!" : state === "failed" ? "Couldn't share" : "Share Velai";

    return (
        <DropdownMenuItem
            onSelect={(e) => {
                e.preventDefault();
                trigger({ title: SITE_NAME, text: SHARE_APP_TEXT, url: withShareRef(getSiteUrl(), "app") });
            }}
        >
            {label}
        </DropdownMenuItem>
    );
}

export interface AccountMenuProps {
    user: User;
    /** Whether the visitor is currently on /settings or /account. */
    active: boolean;
    signingOut: boolean;
    onSignOut: () => void;
}

/**
 * The signed-in header's account trigger + menu. Extracted out of TopBar so
 * the identity chrome (avatar, dropdown contents) is one real component the
 * `/mock/header-identity` fixture can render directly — TopBar itself
 * self-hides on every `/mock/*` route (`shouldHideSiteChrome`), so a fixture
 * can't mount `<TopBar />` to preview this.
 *
 * The 40×40 button is the hit target (rulebook: min touch/click target);
 * the 32px `UserAvatar` inside it is the visible mark, matching the mark's
 * own 32px in the brand lockup.
 */
export function AccountMenu({ user, active, signingOut, onSignOut }: AccountMenuProps) {
    // Feedback opens after the menu closes: menus sit a layer above dialogs, so a menu left open would cover it.
    const [feedbackOpen, setFeedbackOpen] = useState(false);
    // A new account's setup, once the welcome strip has stopped showing (or was put off).
    const onboarding = useOnboarding();
    const setupLeft = onboarding.open ? SETUP_STEPS.length - onboarding.answered : 0;
    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button
                        type="button"
                        data-testid="topbar-avatar"
                        title={user.displayName || user.email || "Account"}
                        aria-label="Account menu"
                        aria-current={active ? "page" : undefined}
                        className={cn(
                            "ctl-md ctl-square inline-flex shrink-0 items-center justify-center rounded-pill transition-opacity outline-none hover:opacity-80 designed-focus-ring focus-visible:outline-none", // control-type-allow: an avatar, not a labelled button — round like the picture it frames
                            active && "ring-2 ring-live",
                        )}
                    >
                        <UserAvatar name={user.displayName} email={user.email} pictureUrl={user.pictureUrl} size={32} />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 border-border bg-surface-2 shadow-[var(--shadow-overlay)]">
                    {setupLeft > 0 ? (
                        <>
                            <DropdownMenuItem data-testid="account-menu-finish-setup" onSelect={() => openSetupSheet("menu")}>
                                Finish setup ({setupStepsLeftLabel(setupLeft)})
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                        </>
                    ) : null}
                    <DropdownMenuItem asChild>
                        <Link href="/settings">Account</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                        <Link href="/research/ghost-jobs">{GHOST_JOB_RESEARCH_TITLE}</Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setFeedbackOpen(true)}>Feedback</DropdownMenuItem>
                    <ShareVelaiMenuItem />
                    <DropdownMenuItem asChild className="text-muted-foreground">
                        <Link href="/privacy">Privacy & Terms</Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        onSelect={onSignOut}
                        disabled={signingOut}
                        className="text-danger-text"
                    >
                        {signingOut ? (
                            <span className="flex items-center gap-2">
                                <InlineSpinner />
                                Signing out…
                            </span>
                        ) : (
                            "Sign out"
                        )}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            <FeedbackModal open={feedbackOpen} onOpenChange={setFeedbackOpen} />
        </>
    );
}
