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
import { SecureStorage } from "@/lib/security";
import { SETTINGS_MESSAGES } from "@/lib/copy";
import { AgentAccessSection } from "@/components/settings/AgentAccessSection";
import { AgentPreferencesSection } from "@/components/settings/AgentPreferencesSection";
import { EmailPreferencesSection } from "@/components/settings/EmailPreferencesSection";
import { YourResumeSection } from "@/components/settings/YourResumeSection";
import { cn } from "@/lib/utils";

type AccountTab = "resume" | "prefs" | "account";

const ACCOUNT_SUBCOPY = "What your agent (and the board) need to know about you. Nothing else.";

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
        <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1" role="tablist">
            {tabs.map(({ key, label }) => (
                <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={tab === key}
                    onClick={() => onChange(key)}
                    className={cn(
                        "rounded-[9px] px-3.5 py-2 text-[13px] font-semibold text-muted-foreground transition-colors",
                        tab === key && "bg-foreground text-background",
                    )}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}

function SettingsCard({ children }: { children: React.ReactNode }) {
    return <div className="mb-3 rounded-2xl border border-border bg-card p-[18px]">{children}</div>;
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
        SecureStorage.clear();
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

    if (isLoading) {
        return (
            <PageLayout fullWidth>
                <div className="mx-auto flex max-w-[720px] flex-col items-center justify-center gap-3 px-5 py-16 text-muted-foreground sm:px-7">
                    <div className="h-5 w-5 animate-spin rounded-full border border-border border-t-foreground" />
                    <p className="text-sm">Loading account…</p>
                </div>
            </PageLayout>
        );
    }

    return (
        <PageLayout fullWidth>
            <div className="mx-auto max-w-[720px] px-5 pb-16 pt-6 sm:px-7">
                <div className="mb-5">
                    <PageHeader title="Account" description={ACCOUNT_SUBCOPY} size="display" bare />
                </div>
                {message && (
                    <div className={`mb-4 text-sm ${message.type === "success" ? "text-foreground" : "text-destructive"}`}>
                        {message.text}
                    </div>
                )}

                <TabBar tab={tab} onChange={selectTab} />

                {tab === "resume" && (
                    <SettingsCard>
                        <YourResumeSection user={user} onLoginClick={() => setAuthPopoverOpen(true)} embedded />
                    </SettingsCard>
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
                            {user ? (
                                <>
                                    <dl className="mb-4 grid grid-cols-[120px_1fr] gap-x-3.5 gap-y-2 text-[13px]">
                                        <dt className="font-mono text-[10px] uppercase tracking-[0.06em] text-[#8b939e]">Email</dt>
                                        <dd>{user.email}</dd>
                                        <dt className="font-mono text-[10px] uppercase tracking-[0.06em] text-[#8b939e]">Username</dt>
                                        <dd>{user.displayName || user.email?.split("@")[0]}</dd>
                                    </dl>
                                    <div className="flex flex-wrap gap-2">
                                        <Button onClick={() => void handlePasswordReset()} disabled={isResetting}>
                                            {isResetting ? "Sending…" : "Send password reset link"}
                                        </Button>
                                        <Button variant="outline" onClick={() => void handleSignOut()}>
                                            Sign out
                                        </Button>
                                    </div>
                                    {resetMessage && (
                                        <p className={`mt-2 text-[12px] ${resetMessage.type === "success" ? "text-foreground" : "text-destructive"}`}>
                                            {resetMessage.text}
                                        </p>
                                    )}
                                </>
                            ) : (
                                <p className="text-sm text-muted-foreground">
                                    <button onClick={() => setAuthPopoverOpen(true)} className="underline text-brand hover:text-brand/80">
                                        Log in
                                    </button>{" "}
                                    to manage your account.
                                </p>
                            )}
                        </SettingsCard>

                        {user && (
                            <SettingsCard>
                                <EmailPreferencesSection user={user} />
                            </SettingsCard>
                        )}

                        <SettingsCard>
                            <AgentAccessSection user={user} onLoginClick={() => setAuthPopoverOpen(true)} />
                        </SettingsCard>

                        {user && (
                            <SettingsCard>
                                <h2 className="mb-1 text-[15px] font-semibold tracking-[-0.02em]">Danger zone</h2>
                                <p className="mb-4 text-[13px] text-muted-foreground">Permanent. No recovery.</p>
                                <Button
                                    variant="outline"
                                    className="text-[#8a3a3a] border-[#e2c4c4] hover:text-[#8a3a3a]"
                                    onClick={() => setShowDeleteDialog(true)}
                                >
                                    Delete account
                                </Button>
                            </SettingsCard>
                        )}
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
                                Type <span className="font-mono font-semibold text-foreground">DELETE</span> to confirm:
                            </p>
                            <Input
                                value={deleteConfirmText}
                                onChange={(e) => setDeleteConfirmText(e.target.value)}
                                placeholder="Type DELETE to confirm"
                                className="font-mono"
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
