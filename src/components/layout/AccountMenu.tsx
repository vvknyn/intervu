"use client";

import Link from "next/link";
import { Moon, Sun, CircleNotch } from "@phosphor-icons/react";
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
            className="rounded-none"
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
    mode: "light" | "dark";
    /** Defers the dark-mode row until after hydration — see ThemeProvider. */
    mounted: boolean;
    toggleMode: () => void;
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
export function AccountMenu({ user, active, signingOut, onSignOut, mode, mounted, toggleMode }: AccountMenuProps) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    data-testid="topbar-avatar"
                    title={user.displayName || user.email || "Account"}
                    aria-label="Account menu"
                    aria-current={active ? "page" : undefined}
                    className={cn(
                        "inline-flex h-10 w-10 shrink-0 items-center justify-center transition-opacity outline-none hover:opacity-80 focus-visible:outline-2 focus-visible:outline-brand focus-visible:-outline-offset-2",
                        active && "ring-2 ring-brand",
                    )}
                >
                    <UserAvatar name={user.displayName} email={user.email} pictureUrl={user.pictureUrl} size={32} />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem asChild>
                    <Link href="/settings">Account</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                    <Link href="/research/ghost-jobs">{GHOST_JOB_RESEARCH_TITLE}</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <FeedbackModal>
                    <DropdownMenuItem onSelect={(e) => e.preventDefault()}>Feedback</DropdownMenuItem>
                </FeedbackModal>
                <ShareVelaiMenuItem />
                <DropdownMenuItem asChild className="text-muted-foreground">
                    <Link href="/privacy">Privacy & Terms</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {mounted && (
                    <DropdownMenuItem
                        onSelect={(e) => {
                            e.preventDefault();
                            toggleMode();
                        }}
                    >
                        <span className="flex w-full items-center gap-2">
                            {mode === "dark" ? <Sun /> : <Moon />}
                            <span>Dark mode</span>
                            <span className="ml-auto text-xs text-muted-foreground">
                                {mode === "dark" ? "On" : "Off"}
                            </span>
                        </span>
                    </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onSelect={onSignOut}
                    disabled={signingOut}
                    className="text-danger-text dark:text-danger-text"
                >
                    {signingOut ? (
                        <span className="flex items-center gap-2">
                            <CircleNotch className="animate-spin" aria-hidden />
                            Signing out…
                        </span>
                    ) : (
                        "Sign out"
                    )}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
