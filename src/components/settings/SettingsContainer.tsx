"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleNotch, WarningOctagon, Trash } from "@phosphor-icons/react";
import { deleteAccount } from "@/actions/auth";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthPopover } from "@/components/auth/auth-popover";
import { onAuthChange, signOut as firebaseSignOut, getCurrentUser, sendResetEmail, type User } from "@/lib/firebase/client-auth";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { SettingsLoading } from "@/components/settings/SettingsLoading";
import { SETTINGS_MESSAGES } from "@/lib/copy";
import { AgentAccessSection } from "@/components/settings/AgentAccessSection";
import { AgentPreferencesSection } from "@/components/settings/AgentPreferencesSection";
import { EmailPreferencesSection } from "@/components/settings/EmailPreferencesSection";
import { YourResumeSection } from "@/components/settings/YourResumeSection";
import { cn } from "@/lib/utils";

type AccountTab = "resume" | "prefs" | "account";

const ACCOUNT_SUBCOPY = "What your agent (and the board) need to know about you. Nothing else.";

// An unrecognized tab (including the retired `api-key`, which may still be
// bookmarked) lands on Resume rather than rendering an empty panel.
function parseAccountTab(value: string | null): AccountTab {
    if (value === "prefs" || value === "account") return value;
    return "resume";
}

function TabBar({ tab, onChange }: { tab: AccountTab; onChange: (t: AccountTab) => void }) {
    const tabs: { key: AccountTab; label: string }[] = [
        { key: "resume", label: "Resume" },
        { key: "prefs", label: "Preferences" },
        { key: "account", label: "Account" },
    ];
    return (
        <div className="mb-4 flex rounded-none border border-border bg-card p-1" role="tablist">
            {tabs.map(({ key, label }) => (
                <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={tab === key}
                    onClick={() => onChange(key)}
                    className={cn(
                        "flex-1 min-w-0 whitespace-nowrap rounded-none px-2 py-2 text-[13px] font-semibold text-muted-foreground transition-colors sm:px-3.5",
                        tab === key && "bg-foreground text-background font-bold",
                    )}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}

function SettingsCard({ children }: { children: React.ReactNode }) {
    return <div className="panel-enter mb-3 rounded-none border border-border bg-card p-[18px]">{children}</div>;
}

export function SettingsContainer() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const tab = parseAccountTab(searchParams.get("tab"));
    const [user, setUser] = useState<User | null>(null);
    const [authPopoverOpen, setAuthPopoverOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [deleteConfirmText, setDeleteConfirmText] = useState("");
    const [isDeleting, setIsDeleting] = useState(false);
    const isSigningOut = useRef(false);
    const [resetEmail, setResetEmail] = useState("");
    const [isResetting, setIsResetting] = useState(false);
    const [resetMessage, setResetMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
    const [resumeEditorOpen, setResumeEditorOpen] = useState(false);

    const handlePasswordReset = async () => {
        const email = (resetEmail || user?.email || "").trim();
        if (!email) return;
        setIsResetting(true);
        setResetMessage(null);
        try {
            await sendResetEmail(email);
            setResetMessage({ type: "success", text: SETTINGS_MESSAGES.resetLinkSent });
            setTimeout(() => setResetMessage(null), 5000);
        } catch (e: unknown) {
            const code = (e as { code?: string })?.code;
            if (code === "auth/user-not-found") {
                setResetMessage({ type: "success", text: SETTINGS_MESSAGES.resetLinkSent });
            } else {
                setResetMessage({ type: "error", text: SETTINGS_MESSAGES.resetLinkFailed });
            }
            setTimeout(() => setResetMessage(null), 5000);
        } finally {
            setIsResetting(false);
        }
    };

    const handleSignOut = async () => {
        isSigningOut.current = true;
        localStorage.clear();
        await firebaseSignOut();
        window.location.href = "/";
    };

    const handleDeleteAccount = async () => {
        if (deleteConfirmText !== "DELETE") return;
        setIsDeleting(true);
        try {
            localStorage.clear();
            const result = await deleteAccount();
            if (result.error) {
                setMessage({ type: "error", text: result.error });
                setIsDeleting(false);
                return;
            }
            router.push("/");
        } catch (e: unknown) {
            setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to delete account." });
            setIsDeleting(false);
        }
    };

    useEffect(() => {
        const currentUser = getCurrentUser();
        if (currentUser) {
            setUser(currentUser);
            setResetEmail(currentUser.email ?? "");
        }
        const unsubscribe = onAuthChange((firebaseUser) => {
            if (isSigningOut.current) return;
            setUser(firebaseUser);
            if (firebaseUser?.email) setResetEmail(firebaseUser.email);
            if (firebaseUser) router.refresh();
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
                className={cn(
                    "mx-auto transition-all",
                    resumeEditorOpen
                        ? "max-w-6xl px-0 pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] lg:px-8 lg:pb-6 xl:max-w-7xl xl:px-10"
                        : cn("px-4 pb-16 pt-6 sm:px-8 xl:px-10", tab === "resume" ? "max-w-6xl xl:max-w-7xl" : "max-w-[760px]"),
                )}
            >
                {!resumeEditorOpen && (
                    <>
                        <div className="mb-5">
                            <PageHeader title="Settings" description={ACCOUNT_SUBCOPY} size="display" bare />
                        </div>
                        {message && (
                            <div className={`mb-4 text-sm ${message.type === "success" ? "text-foreground" : "text-destructive"}`}>
                                {message.text}
                            </div>
                        )}
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
                    <SettingsCard>
                        <AgentPreferencesSection user={user} onLoginClick={() => setAuthPopoverOpen(true)} embedded />
                    </SettingsCard>
                )}

                {tab === "account" && (
                    <>
                        <SettingsCard>
                            <h2 className="mb-1 text-[15px] font-semibold tracking-[-0.02em]">Sign-in</h2>
                            <p className="mb-4 text-[13px] text-muted-foreground">
                                Email is how we reach you for resets. Password stays with you.
                            </p>
                            <dl className="mb-4 grid grid-cols-1 gap-y-2 text-[13px] sm:grid-cols-[120px_1fr] sm:gap-x-3.5 sm:gap-y-2">
                                <dt className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">Email</dt>
                                <dd className="min-w-0 break-words">{user.email}</dd>
                                <dt className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">Username</dt>
                                <dd className="min-w-0 break-words">{user.displayName || user.email?.split("@")[0]}</dd>
                            </dl>
                            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                                <Button onClick={() => void handlePasswordReset()} disabled={isResetting} className="w-full sm:w-auto rounded-none">
                                    {isResetting ? "Sending…" : "Send password reset link"}
                                </Button>
                                <Button variant="outline" onClick={() => void handleSignOut()} className="w-full sm:w-auto rounded-none">
                                    Sign out
                                </Button>
                            </div>
                            {resetMessage && (
                                <p className={`mt-2 text-[12px] ${resetMessage.type === "success" ? "text-foreground" : "text-destructive"}`}>
                                    {resetMessage.text}
                                </p>
                            )}
                        </SettingsCard>

                        <SettingsCard>
                            <EmailPreferencesSection user={user} />
                        </SettingsCard>

                        <SettingsCard>
                            <AgentAccessSection user={user} onLoginClick={() => setAuthPopoverOpen(true)} />
                        </SettingsCard>

                        <SettingsCard>
                            <h2 className="mb-1 text-[15px] font-semibold tracking-[-0.02em]">Danger zone</h2>
                            <p className="mb-4 text-[13px] text-muted-foreground">Permanent. No recovery.</p>
                            <Button
                                variant="outline"
                                className="text-destructive border-destructive/50 hover:text-destructive"
                                onClick={() => setShowDeleteDialog(true)}
                            >
                                Delete account
                            </Button>
                        </SettingsCard>
                    </>
                )}

                <AuthPopover open={authPopoverOpen} onOpenChange={setAuthPopoverOpen} showTrigger={false} />

                <Dialog
                    open={showDeleteDialog}
                    onOpenChange={(open) => {
                        setShowDeleteDialog(open);
                        if (!open) setDeleteConfirmText("");
                    }}
                >
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <WarningOctagon size={20} className="text-destructive" />
                                Delete Account
                            </DialogTitle>
                            <DialogDescription>
                                This will permanently delete your account and all your data. This action cannot be undone.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-3 py-2">
                            <p className="text-sm text-muted-foreground">
                                Type <span className="font-semibold text-foreground">DELETE</span> to confirm:
                            </p>
                            <Input
                                value={deleteConfirmText}
                                onChange={(e) => setDeleteConfirmText(e.target.value)}
                                placeholder="Type DELETE to confirm"
                                className=""
                            />
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
                                {isDeleting ? <CircleNotch size={16} className="animate-spin" /> : <Trash size={16} />}
                                {isDeleting ? "Deleting…" : "Delete Forever"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>
        </PageLayout>
    );
}
