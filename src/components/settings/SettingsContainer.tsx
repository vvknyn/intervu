"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { WarningOctagon, Trash } from "@phosphor-icons/react";
import { InlineSpinner } from "@/components/ui/wait-state";
import { deleteAccount, requestPasswordResetAction } from "@/actions/auth";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthPopover } from "@/components/auth/auth-popover";
import { onAuthChange, signOut, getCurrentUser, type User } from "@/lib/firebase/client-auth";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SettingsLoading } from "@/components/settings/SettingsLoading";
import { SETTINGS_MESSAGES } from "@/lib/copy";
import { SettingsInlineError } from "@/components/settings/SettingsInlineError";
import { AgentAccessSection } from "@/components/settings/AgentAccessSection";
import { AgentPreferencesSection } from "@/components/settings/AgentPreferencesSection";
import { EmailPreferencesSection } from "@/components/settings/EmailPreferencesSection";
import { LandingNotice } from "@/components/layout/LandingNotice";
import { FollowedCompaniesSection } from "@/components/settings/FollowedCompaniesSection";
import { YourResumeSection } from "@/components/settings/YourResumeSection";
import { cn } from "@/lib/utils";
import { incompleteEraseMessage } from "@/lib/account/erase-copy";

type AccountTab = "resume" | "prefs" | "account";

const ACCOUNT_SUBCOPY = "What your agent (and the board) need to know about you. Nothing else.";

// An unrecognized tab (including the retired `api-key`, which may still be
// bookmarked) lands on Resume rather than rendering an empty panel.
function parseAccountTab(value: string | null): AccountTab {
    if (value === "prefs" || value === "account") return value;
    return "resume";
}

function TabBar({ tab, onChange }: { tab: AccountTab; onChange: (t: AccountTab) => void }) {
    return (
        <Tabs value={tab} onValueChange={(v) => onChange(v as AccountTab)} className="mb-4">
            <TabsList variant="line">
                <TabsTrigger value="resume">Résumé</TabsTrigger>
                <TabsTrigger value="prefs">Preferences</TabsTrigger>
                <TabsTrigger value="account">Account</TabsTrigger>
            </TabsList>
        </Tabs>
    );
}

function SettingsCard({ children }: { children: React.ReactNode }) {
    return (
        <div className="panel-enter mb-3 rounded-panel border border-border bg-surface p-4 shadow-[var(--shadow-bevel-highlight)]">
            {children}
        </div>
    );
}

export function SettingsContainer() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const tab = parseAccountTab(searchParams.get("tab"));
    const [user, setUser] = useState<User | null>(null);
    const [authPopoverOpen, setAuthPopoverOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [deleteConfirmText, setDeleteConfirmText] = useState("");
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    // Set when the account is gone but some processors could not be reached.
    const [eraseNotice, setEraseNotice] = useState<string | null>(null);
    const isSigningOut = useRef(false);
    const deleteTriggerRef = useRef<HTMLButtonElement>(null);
    const [resetEmail, setResetEmail] = useState("");
    const [isResetting, setIsResetting] = useState(false);
    const [resetMessage, setResetMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
    const [resumeEditorOpen, setResumeEditorOpen] = useState(false);

    // `requestPasswordResetAction` always resolves `{success:true}` (it never
    // leaks whether the account/email exists), so there is no error branch to
    // sniff here anymore — the try/catch this replaced existed only to force
    // Firebase's `auth/user-not-found` into the same neutral message.
    const handlePasswordReset = async () => {
        const email = (resetEmail || user?.email || "").trim();
        if (!email) return;
        setIsResetting(true);
        setResetMessage(null);
        await requestPasswordResetAction({ email });
        setResetMessage({ type: "success", text: SETTINGS_MESSAGES.resetLinkSent });
        setTimeout(() => setResetMessage(null), 5000);
        setIsResetting(false);
    };

    const handleSignOut = async () => {
        isSigningOut.current = true;
        localStorage.clear();
        await signOut();
    };

    const handleDeleteAccount = async () => {
        if (deleteConfirmText !== "DELETE") return;
        setIsDeleting(true);
        try {
            localStorage.clear();
            const result = await deleteAccount();
            if (result.error) {
                setDeleteError(result.error);
                setIsDeleting(false);
                return;
            }
            if (result.incomplete?.length) {
                // Say what is left before signing out; the Sign out button finishes the job.
                setEraseNotice(incompleteEraseMessage(result.incomplete));
                setIsDeleting(false);
                return;
            }
            // The WorkOS user is already gone server-side; this only clears
            // the session cookie still sitting in the browser (same route
            // `handleSignOut` above uses).
            await signOut();
        } catch (e: unknown) {
            setDeleteError(
                e instanceof Error ? e.message : SETTINGS_MESSAGES.accountDeleteFailed,
            );
            setIsDeleting(false);
        }
    };

    useEffect(() => {
        const currentUser = getCurrentUser();
        if (currentUser) {
            setUser(currentUser);
            setResetEmail(currentUser.email ?? "");
        }
        const unsubscribe = onAuthChange((nextUser) => {
            if (isSigningOut.current) return;
            setUser(nextUser);
            if (nextUser?.email) setResetEmail(nextUser.email);
            if (nextUser) router.refresh();
        });
        return () => unsubscribe();
    }, [router]);

    useEffect(() => {
        if (isSigningOut.current) return;
        setIsLoading(false);
    }, [user?.uid]);

    const selectTab = (next: AccountTab) => {
        const path = next === "resume" ? "/settings" : `/settings?tab=${next}`;
        router.replace(path, { scroll: false });
    };

    // Merged gate: while loading, and while there is genuinely no user,
    // render the same loading state rather than a separate "log in to
    // manage your account" UI — middleware already refuses an unauthenticated
    // request before it reaches this component (isAuthGatedProductPath in
    // lib/auth/product-routes.ts), so a resolved !user here is not a normal
    // state to design a prompt for. Everything below this line can treat
    // `user` as defined.
    if (isLoading || !user) {
        return <SettingsLoading />;
    }

    return (
        <PageLayout fullWidth>
            <div
                // page-scale-allow: the open résumé editor runs edge to edge below lg, and the form tabs keep their centred 3xl column
                className={cn(
                    "mx-auto transition-all",
                    resumeEditorOpen
                        ? "max-w-6xl px-0 pb-[calc(var(--mobile-tabbar-h)+env(safe-area-inset-bottom,0px))] lg:px-8 lg:pb-6 xl:max-w-7xl xl:px-10"
                        : cn("px-4 pb-16 pt-6 sm:px-8 xl:px-10", tab === "resume" ? "max-w-6xl xl:max-w-7xl" : "max-w-3xl"),
                )}
            >
                {!resumeEditorOpen && (
                    <>
                        <div className="mb-5">
                            <PageHeader title="Settings" description={ACCOUNT_SUBCOPY} bare size="display" />
                        </div>
                        <TabBar tab={tab} onChange={selectTab} />
                    </>
                )}

                {tab === "resume" && (
                    <YourResumeSection
                        user={user}
                        onLoginClick={() => setAuthPopoverOpen(true)}
                        embedded
                        onEditorActiveChange={setResumeEditorOpen}
                    />
                )}

                {tab === "prefs" && (
                    <>
                        <SettingsCard>
                            <AgentPreferencesSection user={user} onLoginClick={() => setAuthPopoverOpen(true)} embedded />
                        </SettingsCard>
                    </>
                )}

                {tab === "account" && (
                    <>
                        <SettingsCard>
                            <h2 className="mb-1 text-base font-semibold leading-snug">Sign-in details</h2>
                            <p className="mb-4 text-sm text-muted-foreground">
                                Email is how we reach you for resets. Password stays with you.
                            </p>
                            <dl className="mb-4 space-y-2 text-xs">
                                <div className="flex gap-3.5">
                                    <dt className="w-28 shrink-0 text-muted-foreground">Email</dt>
                                    <dd className="min-w-0 break-words">{user.email}</dd>
                                </div>
                                <div className="flex gap-3.5">
                                    <dt className="w-28 shrink-0 text-muted-foreground">Username</dt>
                                    <dd className="min-w-0 break-words">{user.displayName || user.email?.split("@")[0]}</dd>
                                </div>
                            </dl>
                            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                                <Button onClick={() => void handlePasswordReset()} disabled={isResetting} className="w-full sm:w-auto">
                                    {isResetting ? "Sending…" : "Send password reset link"}
                                </Button>
                                <Button variant="outline" onClick={() => void handleSignOut()} className="w-full sm:w-auto">
                                    Sign out
                                </Button>
                            </div>
                            {resetMessage && (
                                <p className={`mt-2 text-xs ${resetMessage.type === "success" ? "text-foreground" : "text-danger-text"}`}>
                                    {resetMessage.text}
                                </p>
                            )}
                        </SettingsCard>

                        <SettingsCard>
                            <EmailPreferencesSection user={user} />
                        </SettingsCard>

                        <SettingsCard>
                            <FollowedCompaniesSection />
                        </SettingsCard>

                        <SettingsCard>
                            <AgentAccessSection user={user} onLoginClick={() => setAuthPopoverOpen(true)} />
                        </SettingsCard>

                        <SettingsCard>
                            <h2 className="mb-1 text-base font-semibold leading-snug">Danger zone</h2>
                            <p className="mb-4 text-sm text-muted-foreground">Permanent. No recovery.</p>
                            <Button
                                ref={deleteTriggerRef}
                                variant="outline"
                                onClick={() => {
                                    setDeleteError(null);
                                    setShowDeleteDialog(true);
                                }}
                                className="border-danger-text bg-transparent text-danger-text hover:bg-surface-hover"
                            >
                                Delete account
                            </Button>
                        </SettingsCard>
                    </>
                )}

                <AuthPopover open={authPopoverOpen} onOpenChange={setAuthPopoverOpen} showTrigger={false} trigger="user" />

                <Dialog
                    open={showDeleteDialog}
                    onOpenChange={(open) => {
                        if (!open && eraseNotice) {
                            void signOut();
                            return;
                        }
                        setShowDeleteDialog(open);
                        if (!open) {
                            setDeleteConfirmText("");
                            setDeleteError(null);
                        }
                    }}
                >
                    <DialogContent
                        className="rounded-panel"
                        onCloseAutoFocus={(event) => {
                            event.preventDefault();
                            deleteTriggerRef.current?.focus();
                        }}
                    >
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <WarningOctagon size={20} className="text-danger-text" />
                                Delete Account
                            </DialogTitle>
                            <DialogDescription>
                                This will permanently delete your account and all your data. This action cannot be undone.
                            </DialogDescription>
                        </DialogHeader>
                        {eraseNotice ? (
                            <>
                                <p className="py-2 text-sm text-foreground" role="alert">{eraseNotice}</p>
                                <DialogFooter>
                                    <Button onClick={() => void signOut()}>Sign out</Button>
                                </DialogFooter>
                            </>
                        ) : (
                            <>
                        <div className="space-y-3 py-2">
                            <p className="text-sm text-muted-foreground">
                                Type <span className="font-semibold text-foreground">DELETE</span> to confirm:
                            </p>
                            <Input
                                value={deleteConfirmText}
                                onChange={(e) => setDeleteConfirmText(e.target.value)}
                                placeholder="Type DELETE to confirm"
                                aria-invalid={deleteError ? true : undefined}
                            />
                            {deleteError && <SettingsInlineError>{deleteError}</SettingsInlineError>}
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setShowDeleteDialog(false)} disabled={isDeleting}>
                                Cancel
                            </Button>
                            <Button
                                variant="destructive"
                                onClick={handleDeleteAccount}
                                disabled={deleteConfirmText !== "DELETE" || isDeleting}
                                className="gap-2"
                            >
                                {isDeleting ? <InlineSpinner size={16} /> : <Trash size={16} />}
                                {isDeleting ? "Deleting…" : "Delete Forever"}
                            </Button>
                        </DialogFooter>
                            </>
                        )}
                    </DialogContent>
                </Dialog>
                <LandingNotice surface="settings" />
            </div>
        </PageLayout>
    );
}
