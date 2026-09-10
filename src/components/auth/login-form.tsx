'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { signIn, signUp } from '@/actions/auth'
import { captureEvent } from '@/lib/analytics/events'
import { TurnstileWidget } from '@/components/ui/turnstile-widget'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { CircleNotch, Fingerprint } from '@phosphor-icons/react'
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm'
import { AUTH_MESSAGES } from '@/lib/copy'
import { syncGuestFollowsToServer } from '@/lib/follows/use-follows'
import { buildReturnTo } from '@/lib/jobs/pending-actions'
import { authCardCopy, SIGNUP_SUBCOPY } from '@/lib/auth/auth-gate-copy'
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import Link from 'next/link'
import { BrandLockup } from '@/components/brand/BrandMark'

interface LoginFormProps {
    onSuccess?: () => void;
    onGuestAccess?: () => void;
    /** Initial tab when the form mounts — signup for apply gates, login otherwise. */
    defaultTab?: "login" | "signup";
}

/** Standard 4-color Google "G" glyph — no icon library ships a brand mark
 *  for it, and pulling in a new dependency for one static SVG isn't worth
 *  it. Inline, no dark-mode variant needed (the mark itself is brand-fixed). */
function GoogleGlyph() {
    return (
        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden data-rulebook-exempt>
            <path
                fill="#4285F4"
                d="M23.52 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.87c2.27-2.09 3.58-5.17 3.58-8.82Z"
            />
            <path
                fill="#34A853"
                d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.28v3.1A12 12 0 0 0 12 24Z"
            />
            <path
                fill="#FBBC05"
                d="M5.27 14.28A7.2 7.2 0 0 1 4.89 12c0-.79.14-1.56.38-2.28v-3.1H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.38l3.99-3.1Z"
            />
            <path
                fill="#EA4335"
                d="M12 4.76c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.62l3.99 3.1C6.22 6.87 8.87 4.76 12 4.76Z"
            />
        </svg>
    );
}

export function LoginForm({ onSuccess, onGuestAccess, defaultTab = "login" }: LoginFormProps = {}) {
    const router = useRouter()
    const [activeTab, setActiveTab] = useState<"login" | "signup">(defaultTab)
    const [username, setUsername] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [isPending, startTransition] = useTransition()
    const [authKitPending, setAuthKitPending] = useState<string | null>(null)
    const [message, setMessage] = useState<string | null>(null)
    const [showForgotPassword, setShowForgotPassword] = useState(false)
    const [turnstileToken, setTurnstileToken] = useState<string | null>(null)

    const copy = authCardCopy(activeTab)

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setMessage(null)

        startTransition(async () => {
            // Identifier field label reads "Email or username" — shape
            // decides the routing server-side (see resolveLoginEmail).
            const formData = new FormData()
            formData.append('username', username)
            formData.append('password', password)
            const result = await signIn(null, formData)
            if ("error" in result) {
                setMessage(result.error)
                return
            }
            router.refresh()
            await syncGuestFollowsToServer()
            if (onSuccess) onSuccess()
        })
    }

    /**
     * Hand off to WorkOS AuthKit.
     *
     * With no provider the hosted page offers every method enabled for the
     * environment (passkey, email code, password). With one, WorkOS skips its
     * chooser and goes straight to that provider's own screen — which is what
     * keeps "Continue with Google" a single click, and honest about where it
     * sends you.
     *
     * A full-page navigation, not a popup: the answer returns through
     * /auth/callback, which establishes the session server-side. That is also
     * why `onSuccess` is not called — this component no longer exists by the
     * time the user comes back, and the page they land on reads the session
     * fresh.
     */
    const startAuthKit = (provider?: string) => {
        setAuthKitPending(provider ?? 'passkey')
        const params = new URLSearchParams()
        // `next` already on this URL (e.g. middleware bounced here from a
        // gated route) wins; otherwise fall back to wherever the user
        // actually is, so a hard-nav OAuth/passkey round trip returns to the
        // same page instead of AuthKit's own default.
        const next = new URLSearchParams(window.location.search).get("next") || buildReturnTo(window.location)
        if (next) params.set("next", next)
        if (activeTab === "signup") params.set("mode", "signup")
        if (provider) params.set("provider", provider)
        const query = params.toString()
        window.location.href = `/auth/start${query ? `?${query}` : ""}`
    }

    const handleSignUp = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!email || !username || !password) {
            setMessage(AUTH_MESSAGES.missingCredentials)
            return
        }

        setMessage(null)

        startTransition(async () => {
            const formData = new FormData()
            formData.append('email', email)
            formData.append('username', username)
            formData.append('password', password)
            formData.append('turnstileToken', turnstileToken ?? '')
            const result = await signUp(null, formData)
            if ("error" in result) {
                setMessage(result.error)
                return
            }
            // `signUp` already authenticates the fresh account and saves the
            // session server-side — no second client-side sign-in round trip.
            //
            // ⚠️ This covers the username/password form ONLY. Google now
            // goes through WorkOS AuthKit (`startAuthKit`), which is a full
            // page redirect — the browser leaves before any signup could be
            // observed, and the callback is server-side where posthog-js
            // does not run. So AuthKit signups are currently UNCOUNTED
            // rather than guessed at. Closing that gap needs either
            // server-side capture or an explicit new-user signal handed
            // back from /auth/callback; see docs/analytics/FUNNEL.md.
            captureEvent('signup_completed', { method: 'username' })
            router.refresh()
            await syncGuestFollowsToServer()
            if (onSuccess) onSuccess()
        })
    }

    if (showForgotPassword) {
        return <ForgotPasswordForm onBack={() => setShowForgotPassword(false)} />
    }

    return (
        <div className="space-y-5 pt-1">
            <div className="space-y-1.5">
                {/* A dead end otherwise — this card had no wordmark/home link
                    back to the rest of the site. Reuses TopBar's own lockup
                    (BrandMark.tsx) rather than a second copy of the mark. */}
                <Link href="/jobs" className="inline-flex w-fit text-brand transition-opacity hover:opacity-90" data-rulebook-exempt>
                    <BrandLockup />
                </Link>
                <h1 className="font-semibold text-xl text-foreground">
                    {copy.title}
                </h1>
                {activeTab === "signup" && (
                    <p className="text-xs text-muted-foreground">{SIGNUP_SUBCOPY}</p>
                )}
            </div>

            <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as "login" | "signup"); setMessage(null); }} className="w-full">
                <TabsList variant="line" className="mb-5">
                    <TabsTrigger value="login">{authCardCopy("login").tabLabel}</TabsTrigger>
                    <TabsTrigger value="signup">{authCardCopy("signup").tabLabel}</TabsTrigger>
                </TabsList>

                {/* Email-first ordering (2026-08-20 signup-ladder audit): Google is
                    the only sign-in path that hands us a real, mail-deliverable
                    address — a username/password account is registered under a
                    synthesized `<username>@intervu.cc` the send layer refuses
                    (see lib/auth/username-email.ts), so it can't actually receive
                    the alerts/digest this form is now selling. That path stays
                    above username/password on both tabs rather than below it. */}
                <div className="grid gap-2 mb-4">
                    {/* Google now runs through WorkOS rather than Firebase, so
                        every provider issues the same session and the server
                        has one answer to "who is this". `GoogleOAuth` is
                        WorkOS's own identifier for the connection configured in
                        the dashboard — not an app-side name, and not validated
                        here, because WorkOS is the authority on which
                        providers an environment actually has. */}
                    <Button variant="outline" size="lg" type="button" className="w-full" disabled={isPending || authKitPending !== null} onClick={() => startAuthKit("GoogleOAuth")}>
                        {authKitPending === "GoogleOAuth" ? (
                            <CircleNotch size={16} className="mr-2 animate-spin" />
                        ) : (
                            <GoogleGlyph />
                        )}
                        Continue with Google
                    </Button>
                    {/* Passkeys and email codes need AuthKit's hosted page:
                        WebAuthn requires a challenge/assertion ceremony that
                        has no API to call, so the page has to run it. No
                        provider here means WorkOS shows whichever methods are
                        enabled for the environment. */}
                    <Button
                        variant="outline"
                        size="lg"
                        type="button"
                        className="w-full"
                        disabled={isPending || authKitPending !== null}
                        onClick={() => startAuthKit()}
                    >
                        {authKitPending === "passkey" ? (
                            <CircleNotch size={16} className="mr-2 animate-spin" />
                        ) : (
                            <Fingerprint weight="bold" className="size-4" />
                        )}
                        Use a passkey or email code
                    </Button>
                    {onGuestAccess && (
                        <Button variant="outline" size="lg" type="button" className="w-full" disabled={isPending} onClick={onGuestAccess}>
                            Continue as Guest
                        </Button>
                    )}
                </div>

                <div className="relative mb-4">
                    <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs">
                        <span className="bg-background px-2 text-muted-foreground">
                            or
                        </span>
                    </div>
                </div>

                <div className="grid gap-4">
                    <form onSubmit={activeTab === "login" ? handleLogin : handleSignUp}>
                        <div className="grid gap-4">
                            {activeTab === "signup" && (
                                <Field label="Email" htmlFor="email">
                                    <Input
                                        id="email"
                                        type="email"
                                        autoComplete="email"
                                        disabled={isPending}
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                    />
                                </Field>
                            )}
                            <Field label={activeTab === "login" ? "Email or username" : "Username"} htmlFor="username">
                                <Input
                                    id="username"
                                    type="text"
                                    autoCapitalize="none"
                                    autoComplete="username"
                                    autoCorrect="off"
                                    disabled={isPending}
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                />
                            </Field>
                            <Field label="Password" htmlFor="password">
                                <div className="relative">
                                    <Input
                                        id="password"
                                        type={showPassword ? "text" : "password"}
                                        autoCapitalize="none"
                                        autoComplete={activeTab === "signup" ? "new-password" : "current-password"}
                                        disabled={isPending}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="pr-14"
                                    />
                                    <button
                                        type="button"
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={() => setShowPassword((show) => !show)}
                                        aria-label={showPassword ? "Hide password" : "Show password"}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        {showPassword ? "Hide" : "Show"}
                                    </button>
                                </div>
                                {activeTab === "signup" && (
                                    <p className="text-xs text-muted-foreground">6+ characters</p>
                                )}
                            </Field>
                            {activeTab === "signup" && (
                                <TurnstileWidget onVerify={setTurnstileToken} />
                            )}
                            <Button disabled={isPending} size="lg" className="w-full">
                                {isPending && (
                                    <CircleNotch size={16} className="mr-2 animate-spin" />
                                )}
                                {copy.submitLabel}
                            </Button>
                        </div>
                    </form>

                    {activeTab === "login" && (
                        <div className="text-center">
                            <button
                                type="button"
                                onClick={() => setShowForgotPassword(true)}
                                className="text-xs text-brand hover:underline"
                            >
                                Forgot password?
                            </button>
                        </div>
                    )}
                </div>
            </Tabs>

            {message && (
                <Alert variant="destructive" className="text-center">
                    <AlertDescription>{message}</AlertDescription>
                </Alert>
            )}
        </div>
    )
}
