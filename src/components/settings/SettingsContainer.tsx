"use client";

import { useState, useEffect, useRef } from "react";
import { fetchProfile } from "@/actions/profile";
import { CircleNotch, WarningOctagon, Trash } from "@phosphor-icons/react";
import { deleteAccount } from "@/actions/auth";
import { exportUserData } from "@/actions/account";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTheme } from "@/components/providers/ThemeProvider";
import { themes, themeNames } from "@/lib/themes";
import { AuthPopover } from "@/components/auth/auth-popover";
import { onAuthChange, signOut as firebaseSignOut, getCurrentUser, sendResetEmail, type User } from "@/lib/firebase/client-auth";
import { useRouter } from "next/navigation";
import { getAppConfig } from "@/actions/admin";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { SecureStorage } from "@/lib/security";
import { MotivationalBanner } from "@/components/ui/motivational-banner";
import { SETTINGS_MESSAGES, OUTPUT_PREF_DESCRIPTIONS } from "@/lib/copy";
import { ModelSettings } from "@/components/settings/ModelSettings";
import { FeedbackModal } from "@/components/modals/FeedbackModal";

interface OutputPreferences {
    strategyLength: "brief" | "standard" | "detailed";
    coverLetterLength: "short" | "standard" | "long";
}

const OUTPUT_PREFS_KEY = "intervu-output-prefs";
const OUTPUT_PREFS_DEFAULTS: OutputPreferences = { strategyLength: "standard", coverLetterLength: "standard" };

export function SettingsContainer() {
    const { theme, setTheme: setThemeFn } = useTheme();
    const router = useRouter();
    const [user, setUser] = useState<User | null>(null);
    const [authPopoverOpen, setAuthPopoverOpen] = useState(false);

    const [isLoading, setIsLoading] = useState(true);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    // App config (for donation feature flag)
    const [appConfig, setAppConfig] = useState<{ show_donation: boolean; donation_url: string } | null>(null);

    // Account management state
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [deleteConfirmText, setDeleteConfirmText] = useState("");
    const [isDeleting, setIsDeleting] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);
    const isSigningOut = useRef(false);

    // Banner preference
    const [bannerEnabled, setBannerEnabled] = useState(true);

    // Output preferences
    const [outputPrefs, setOutputPrefs] = useState<OutputPreferences>(OUTPUT_PREFS_DEFAULTS);

    // Password reset state
    const [resetEmail, setResetEmail] = useState("");
    const [isResetting, setIsResetting] = useState(false);
    const [resetMessage, setResetMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    const handlePasswordReset = async () => {
        if (!resetEmail) return;
        setIsResetting(true);
        setResetMessage(null);
        try {
            // Native Firebase flow: emails an oobCode link that lands on /reset-password.
            await sendResetEmail(resetEmail.trim());
            setResetMessage({ type: 'success', text: SETTINGS_MESSAGES.resetLinkSent });
            setTimeout(() => setResetMessage(null), 5000);
        } catch (e: unknown) {
            const code = (e as { code?: string })?.code;
            // Don't leak account existence — treat "not found" as success.
            if (code === "auth/user-not-found") {
                setResetMessage({ type: 'success', text: SETTINGS_MESSAGES.resetLinkSent });
            } else {
                setResetMessage({ type: 'error', text: SETTINGS_MESSAGES.resetLinkFailed });
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

    const handleExportData = async () => {
        setIsExporting(true);
        try {
            const result = await exportUserData();
            if (result.error) {
                setMessage({ type: 'error', text: result.error });
                return;
            }
            const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `intervu-data-export-${new Date().toISOString().split("T")[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            setMessage({ type: 'success', text: SETTINGS_MESSAGES.dataExported });
            setTimeout(() => setMessage(null), 3000);
        } catch (e: any) {
            setMessage({ type: 'error', text: e.message || "Failed to export data." });
        } finally {
            setIsExporting(false);
        }
    };

    const handleDeleteAccount = async () => {
        if (deleteConfirmText !== "DELETE") return;
        setIsDeleting(true);
        try {
            localStorage.clear();
            const result = await deleteAccount();
            if (result.error) {
                setMessage({ type: 'error', text: result.error });
                setIsDeleting(false);
                return;
            }
            router.push("/");
        } catch (e: any) {
            setMessage({ type: 'error', text: e.message || "Failed to delete account." });
            setIsDeleting(false);
        }
    };

    // Load banner preference from localStorage
    useEffect(() => {
        const disabled = localStorage.getItem("banner_disabled") === "true";
        setBannerEnabled(!disabled);
    }, []);

    // Load output preferences from localStorage
    useEffect(() => {
        try {
            const stored = localStorage.getItem(OUTPUT_PREFS_KEY);
            if (stored) setOutputPrefs({ ...OUTPUT_PREFS_DEFAULTS, ...JSON.parse(stored) });
        } catch { /* ignore parse errors */ }
    }, []);

    // Listen for auth state changes
    useEffect(() => {
        const currentUser = getCurrentUser();
        if (currentUser) setUser(currentUser);

        const unsubscribe = onAuthChange((firebaseUser) => {
            if (isSigningOut.current) return;
            setUser(firebaseUser);
            if (firebaseUser) {
                router.refresh();
            }
        });

        return () => unsubscribe();
    }, [router]);

    // Load initial data
    useEffect(() => {
        if (isSigningOut.current) return;

        const loadData = async () => {
            setIsLoading(true);

            try {
                const { data: profileData } = await fetchProfile();
                if (profileData) {
                    if ((profileData as any).is_admin) setIsAdmin(true);
                }

                const { data: configData } = await getAppConfig();
                if (configData) setAppConfig(configData);
            } catch (e) {
                console.error("Failed to load settings", e);
            } finally {
                setIsLoading(false);
            }
        };
        loadData();
    }, [user?.uid]);

    const updateOutputPref = <K extends keyof OutputPreferences>(key: K, value: OutputPreferences[K]) => {
        const updated = { ...outputPrefs, [key]: value };
        setOutputPrefs(updated);
        localStorage.setItem(OUTPUT_PREFS_KEY, JSON.stringify(updated));
    };

    const createdAt = user?.metadata?.creationTime
        ? new Date(user.metadata.creationTime).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
        : null;

    if (isLoading) {
        return (
            <PageLayout
                header={
                    <PageHeader
                        title="Settings"
                        actions={
                            <>
                                <AuthPopover open={authPopoverOpen} onOpenChange={setAuthPopoverOpen} showTrigger={false} />
                            </>
                        }
                    />
                }
            >
                <div className="py-16 flex flex-col items-center justify-center text-muted-foreground gap-3">
                    <div className="w-5 h-5 border border-border border-t-foreground rounded-full animate-spin"></div>
                    <p className="text-sm">Loading settings...</p>
                </div>
            </PageLayout>
        );
    }

    return (
        <PageLayout
            header={
                <PageHeader
                    title="Settings"
                    actions={
                        <>
                            <AuthPopover open={authPopoverOpen} onOpenChange={setAuthPopoverOpen} showTrigger={false} />
                        </>
                    }
                />
            }
        >
            <MotivationalBanner />
            <div className="max-w-2xl space-y-8">
                {message && (
                    <div className={`text-sm ${message.type === 'success' ? 'text-foreground' : 'text-destructive'}`}>
                        {message.text}
                    </div>
                )}

                {/* Section: Output Preferences */}
                <section>
                    <h2 className="text-lg font-semibold mb-1">Output Preferences</h2>
                    <p className="text-sm text-muted-foreground mb-4">
                        Control the length of AI-generated content.
                    </p>

                    <div className="space-y-4">
                        {/* Strategy Length */}
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <p className="text-sm font-medium">Personal Strategy</p>
                                <p className="text-xs text-muted-foreground">
                                    {outputPrefs.strategyLength === "brief" ? OUTPUT_PREF_DESCRIPTIONS.strategyBrief
                                        : outputPrefs.strategyLength === "detailed" ? OUTPUT_PREF_DESCRIPTIONS.strategyDetailed
                                        : OUTPUT_PREF_DESCRIPTIONS.strategyStandard}
                                </p>
                            </div>
                            <div className="flex items-center bg-muted/50 p-0.5 rounded-lg shrink-0">
                                {(["brief", "standard", "detailed"] as const).map((opt) => (
                                    <button
                                        key={opt}
                                        onClick={() => updateOutputPref("strategyLength", opt)}
                                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200 ${
                                            outputPrefs.strategyLength === opt
                                                ? "bg-brand text-brand-foreground shadow-sm"
                                                : "text-muted-foreground hover:text-foreground hover:bg-muted"
                                        }`}
                                    >
                                        {opt.charAt(0).toUpperCase() + opt.slice(1)}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Cover Letter Length */}
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <p className="text-sm font-medium">Cover Letter</p>
                                <p className="text-xs text-muted-foreground">
                                    {outputPrefs.coverLetterLength === "short" ? OUTPUT_PREF_DESCRIPTIONS.coverShort
                                        : outputPrefs.coverLetterLength === "long" ? OUTPUT_PREF_DESCRIPTIONS.coverLong
                                        : OUTPUT_PREF_DESCRIPTIONS.coverStandard}
                                </p>
                            </div>
                            <div className="flex items-center bg-muted/50 p-0.5 rounded-lg shrink-0">
                                {(["short", "standard", "long"] as const).map((opt) => (
                                    <button
                                        key={opt}
                                        onClick={() => updateOutputPref("coverLetterLength", opt)}
                                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200 ${
                                            outputPrefs.coverLetterLength === opt
                                                ? "bg-brand text-brand-foreground shadow-sm"
                                                : "text-muted-foreground hover:text-foreground hover:bg-muted"
                                        }`}
                                    >
                                        {opt.charAt(0).toUpperCase() + opt.slice(1)}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>

                {/* Section: AI Provider */}
                <section className="pt-6 border-t border-border">
                    <h2 className="text-lg font-semibold mb-1">AI Provider</h2>
                    <p className="text-sm text-muted-foreground mb-4">
                        Bring your own OpenRouter or Groq key, or use the model we provide by default.
                    </p>
                    <ModelSettings />
                </section>

                {/* Section: Account */}
                <section className="pt-6 border-t border-border">
                    <h2 className="text-lg font-semibold mb-4">Account</h2>
                    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 items-baseline text-sm">
                        {/* User */}
                        <span className="text-muted-foreground text-right whitespace-nowrap py-1">user:</span>
                        <span className="py-1">
                            {user ? (
                                user.displayName || user.email?.split("@")[0]
                            ) : (
                                <button
                                    onClick={() => setAuthPopoverOpen(true)}
                                    className="underline text-brand hover:text-brand/80"
                                >
                                    login
                                </button>
                            )}
                        </span>

                        {/* Created */}
                        {createdAt && (
                            <>
                                <span className="text-muted-foreground text-right whitespace-nowrap py-1">created:</span>
                                <span className="py-1">{createdAt}</span>
                            </>
                        )}

                        {/* Recovery Email + Password Reset (only for logged-in users) */}
                        {user && (
                            <>
                                <span className="text-muted-foreground text-right whitespace-nowrap py-1">email:</span>
                                <div className="py-0.5">
                                    <div className="flex items-center gap-2">
                                        <Input
                                            type="email"
                                            value={resetEmail}
                                            onChange={(e) => setResetEmail(e.target.value)}
                                            placeholder="your email (for password reset)"
                                            className="h-8 text-sm max-w-xs"
                                        />
                                    </div>
                                    <p className="text-[11px] text-muted-foreground mt-1">
                                        Used to send password reset links. Not stored.
                                    </p>
                                </div>

                                <span className="text-muted-foreground text-right whitespace-nowrap py-1">password:</span>
                                <div className="py-0.5">
                                    <button
                                        onClick={handlePasswordReset}
                                        disabled={isResetting || !resetEmail}
                                        className="text-sm underline text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:no-underline"
                                    >
                                        {isResetting ? "sending..." : "send reset link"}
                                    </button>
                                    {resetMessage && (
                                        <p className={`text-[11px] mt-1 ${resetMessage.type === 'success' ? 'text-foreground' : 'text-destructive'}`}>
                                            {resetMessage.text}
                                        </p>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </section>

                {/* Section: Appearance */}
                <section className="pt-6 border-t border-border">
                    <h2 className="text-lg font-semibold mb-4">Appearance</h2>
                    <div className="flex items-center gap-2 flex-wrap">
                        {themeNames.map((name) => {
                            const t = themes[name];
                            const isActive = theme === name;
                            const swatchColor = `rgb(${t.colors.light.brand})`;
                            return (
                                <button
                                    key={name}
                                    onClick={() => setThemeFn(name)}
                                    className="flex items-center gap-1 group focus-ring rounded-full"
                                    title={t.label}
                                    aria-label={`${t.label} theme`}
                                    aria-pressed={isActive}
                                >
                                    <div
                                        className={`w-4 h-4 rounded-full border ${isActive ? 'ring-2 ring-offset-1 ring-foreground/40' : 'border-border hover:scale-110'} transition-all`}
                                        style={{ backgroundColor: swatchColor }}
                                    />
                                    {isActive && (
                                        <span className="text-xs">{t.label}</span>
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {/* Banner Toggle */}
                    <div className="mt-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium">Show motivational quotes</p>
                            <p className="text-xs text-muted-foreground">Display an inspiring quote banner on each page</p>
                        </div>
                        <button
                            onClick={() => {
                                const current = localStorage.getItem("banner_disabled") === "true";
                                localStorage.setItem("banner_disabled", current ? "false" : "true");
                                setBannerEnabled(current);
                            }}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${bannerEnabled ? 'bg-brand' : 'bg-muted'}`}
                            role="switch"
                            aria-checked={bannerEnabled}
                        >
                            <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${bannerEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </div>
                </section>

                {/* Section: Data & Privacy */}
                <section className="pt-6 border-t border-border">
                    <h2 className="text-lg font-semibold mb-4">Data & Privacy</h2>
                    <div className="text-sm flex flex-wrap items-center gap-x-1 gap-y-1">
                        {isAdmin && (
                            <>
                                <a
                                    href="/admin"
                                    className="underline text-brand hover:text-brand/80"
                                >
                                    admin panel
                                </a>
                                <span className="text-muted-foreground">|</span>
                            </>
                        )}
                        <button
                            onClick={handleExportData}
                            disabled={isExporting}
                            className="underline text-muted-foreground hover:text-foreground disabled:opacity-50"
                        >
                            {isExporting ? "exporting..." : "export data"}
                        </button>
                        {appConfig?.show_donation && appConfig.donation_url && (
                            <>
                                <span className="text-muted-foreground">|</span>
                                <a
                                    href={appConfig.donation_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline text-muted-foreground hover:text-foreground"
                                >
                                    donate
                                </a>
                            </>
                        )}
                        {user && (
                            <>
                                <span className="text-muted-foreground">|</span>
                                <button
                                    onClick={() => setShowDeleteDialog(true)}
                                    className="underline text-muted-foreground hover:text-destructive"
                                >
                                    delete account
                                </button>
                                <span className="text-muted-foreground">|</span>
                                <button
                                    onClick={handleSignOut}
                                    className="underline text-muted-foreground hover:text-foreground"
                                >
                                    logout
                                </button>
                            </>
                        )}
                    </div>
                </section>

                {/* Feedback — lived in the old sidebar footer (AppShell),
                    which is gone post-flip; signed-in users reach it from the
                    TopBar avatar menu, everyone can reach it here. */}
                <div className="pt-2">
                    <FeedbackModal>
                        <button className="text-sm text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground">
                            Send feedback
                        </button>
                    </FeedbackModal>
                </div>

                {/* Delete Account Confirmation Dialog */}
                <Dialog open={showDeleteDialog} onOpenChange={(open) => {
                    setShowDeleteDialog(open);
                    if (!open) setDeleteConfirmText("");
                }}>
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
                                {isDeleting ? (
                                    <CircleNotch size={16} className="animate-spin" />
                                ) : (
                                    <Trash size={16} />
                                )}
                                {isDeleting ? "Deleting..." : "Delete Forever"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

            </div>
        </PageLayout>
    );
}
