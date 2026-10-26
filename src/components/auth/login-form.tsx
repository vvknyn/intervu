'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { signIn, signUp } from '@/actions/auth'
import { toast } from '@/lib/toast'
import { VerifyCodeStep } from '@/components/auth/verify-code-step'
import { presentAuthResult, type AuthPresentation } from './present-auth-result'
import { captureEvent, type SignupMethod } from '@/lib/analytics/events'
import { authStartedPayloadFromAttempt } from '@/lib/analytics/auth-event-payload'
import { clearGateAttempt, gateAttemptEventFields, readGateAttempt } from '@/lib/auth/gate-attempt'
import { clearSignupSignalCookieFromDocument } from '@/lib/auth/authkit-signup-signal'
import { TurnstileWidget, useTurnstileToken } from '@/components/ui/turnstile-widget'
import { NEW_PASSWORD_HINT, newPasswordProblem } from '@/lib/auth/password-rules'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Fingerprint } from '@phosphor-icons/react'
import { InlineSpinner } from '@/components/ui/wait-state'
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm'
import { AUTH_MESSAGES } from '@/lib/copy'
import { syncGuestFollowsToServer } from '@/lib/follows/use-follows'
import { revalidateClientSession } from '@/lib/firebase/client-auth'
import { buildReturnTo } from '@/lib/jobs/pending-actions'
import { resolveAuthKitReturnTo } from '@/lib/auth/post-auth-destination'
import { validateNextParam } from '@/lib/auth/product-routes'
import { authCardCopy, PERSONAL_EMAIL_HINT, SIGNUP_SUBCOPY } from '@/lib/auth/auth-gate-copy'
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { BrandHomeLink } from '@/components/brand/BrandMark'
import { PageTitle } from '@/components/ui/heading'

interface LoginFormProps {
    onSuccess?: () => void;
    onGuestAccess?: () => void;
    /** Initial tab when the form mounts — signup for apply gates, login otherwise. */
    defaultTab?: "login" | "signup";
    /**
     * Reason-scoped heading + explanatory line that REPLACES the tab's own
     * generic heading (`authCardCopy(activeTab).title`) and subcopy
     * (`SIGNUP_SUBCOPY`) — not stacked above them. The brand lockup above
     * stays put either way. Omit for the plain per-tab heading (unchanged
     * default). Set by AuthPopover from `authGateCopy`/`valueLine` for a
     * reason whose gate is a hard stop before the user can act (e.g. apply).
     */
    headline?: { title: string; body: React.ReactNode };
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

/** Which `auth_method_selected` method a click on the AuthKit buttons
 *  below maps to — pure so it's testable without mounting the form. */
export function resolveAuthKitMethod(provider?: string): SignupMethod {
    return provider === 'GoogleOAuth' ? 'google' : 'passkey'
}

function authContinuityPayload() {
    const attempt = typeof window !== 'undefined' ? readGateAttempt(window.sessionStorage) : null
    return gateAttemptEventFields(attempt)
}

/** One seam for auth_started so Google, passkey/email-code, and username
 *  submit cannot drift. Reads the gate attempt at click time. */
function captureAuthStartedFromGate() {
    const attempt = typeof window !== 'undefined' ? readGateAttempt(window.sessionStorage) : null
    captureEvent('auth_started', authStartedPayloadFromAttempt(attempt))
}

/** A submit that found no fresh security-check token after waiting: the challenge is still running, or wants a tick. */
export const TURNSTILE_PENDING_MESSAGE =
    "The security check under the password hasn't finished yet. If it shows a box, tick it, then press Create account again." // signup-gate-exempt: the login form's own button, part of the auth flow

/** A submit after the challenge itself failed: this form can't be sent, the buttons below the message can. */
export const TURNSTILE_FAILED_MESSAGE =
    "The security check couldn't run, so this form can't be sent. Use Continue with Google or the email code below."

export function LoginForm({ onSuccess, onGuestAccess, defaultTab = "login", headline }: LoginFormProps = {}) {
    const router = useRouter()
    const [activeTab, setActiveTab] = useState<"login" | "signup">(defaultTab)
    const [username, setUsername] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [isPending, startTransition] = useTransition()
    // Set when WorkOS holds a password sign-in for an emailed code; swaps the tabs for the code step.
    const [verifyStep, setVerifyStep] = useState<{ pendingAuthenticationToken: string; email: string } | null>(null)
    const [authKitPending, setAuthKitPending] = useState<string | null>(null)
    // The answer to the last press, shown at the top of the card and scrolled
    // into view. Rendered under the button it went unseen: on a phone the
    // button sits at the bottom of a scrolled card, so the message landed
    // below the fold and the visitor kept pressing (2026-10-01 replay: seven
    // presses, then "Too many attempts"). Each answer gets a new id, so a
    // repeat of the same text still re-reveals and re-scrolls.
    const [notice, setNotice] = useState<{ text: string; id: number } | null>(null)
    const noticeIdRef = useRef(0)
    // The heading and the message together: scrolled as one so the card's
    // top shows whole, not a line cut in half above the message. Instant, not
    // smooth: the dialog's own focused-field reveal (lib/ui/reveal-focused-field.ts)
    // fires instant scrolls as the phone keyboard closes, and those cancel a
    // smooth scroll halfway.
    const cardTopRef = useRef<HTMLDivElement>(null)
    const setMessage = useCallback((text: string | null) => {
        setNotice(text === null ? null : { text, id: ++noticeIdRef.current })
    }, [])
    // Runs a presented answer: false when the press did not sign the person in
    // (an inline error, or a toast that sends them on to sign in).
    const applyAuthPresentation = useCallback((presented: AuthPresentation, onNotSignedIn?: () => void): boolean => {
        if ("ok" in presented) {
            setMessage(null)
            return true
        }
        onNotSignedIn?.()
        if ("step" in presented) {
            setMessage(null)
            setVerifyStep({ pendingAuthenticationToken: presented.pendingAuthenticationToken, email: presented.email })
            return false
        }
        if ("inline" in presented) {
            setMessage(presented.inline)
            return false
        }
        setMessage(null)
        toast[presented.toast.kind](presented.toast.text)
        if (presented.switchTab) setActiveTab(presented.switchTab)
        if (presented.prefill) setUsername(presented.prefill.username)
        return false
    }, [setMessage])
    useEffect(() => {
        if (notice) cardTopRef.current?.scrollIntoView({ block: 'nearest' })
    }, [notice])
    const [showForgotPassword, setShowForgotPassword] = useState(false)
    // Single-use: taken on each submit and reset after any refusal, so a
    // retry never resends a token Cloudflare already spent.
    const turnstile = useTurnstileToken()
    // Where a failed Turnstile sends the visitor: the Google button above the form.
    const googleButtonRef = useRef<HTMLButtonElement>(null)

    const copy = authCardCopy(activeTab)

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()

        // The last answer stays up until this press has its own: clearing it
        // first would pull the form up under the visitor's thumb.
        startTransition(async () => {
            // Identifier field label reads "Email or username" — shape
            // decides the routing server-side (see resolveLoginEmail).
            const formData = new FormData()
            formData.append('username', username)
            formData.append('password', password)
            const result = await signIn(null, formData)
            if (!applyAuthPresentation(presentAuthResult(result, { username }))) return
            router.refresh()
            revalidateClientSession()
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
        // Method engagement is the funnel start, before navigation.
        // Google passes its provider id; the passkey/email-code button
        // passes none. Both fire auth_started, then auth_method_selected.
        captureAuthStartedFromGate()
        captureEvent('auth_method_selected', { method: resolveAuthKitMethod(provider), ...authContinuityPayload() })
        setAuthKitPending(provider ?? 'passkey')
        const params = new URLSearchParams()
        // `next` already on this URL (e.g. middleware bounced here from a
        // gated route) wins; otherwise fall back to wherever the user
        // actually is, so a hard-nav OAuth/passkey round trip returns to the
        // same page instead of AuthKit's own default.
        const rawNext = new URLSearchParams(window.location.search).get("next") || buildReturnTo(window.location)
        // Sign-up comes back to this page too, where a queued Apply replays.
        const next = resolveAuthKitReturnTo(rawNext)
        if (next) params.set("next", next)
        if (activeTab === "signup") params.set("mode", "signup")
        if (provider) params.set("provider", provider)
        const query = params.toString()
        window.location.href = `/auth/start${query ? `?${query}` : ""}` // signup-gate-exempt: the login form itself, part of the auth flow
    }

    // The sequence after a username/password account is signed in: straight
    // from signUp, or after the emailed code (the code step).
    const finishSignedIn = async (signupCompleted: boolean) => {
        // `signUp` already authenticates the fresh account and saves the
        // session server-side — no second client-side sign-in round trip.
        //
        // Username/password path only — AuthKit (Google/passkey/magic-auth)
        // emits via /auth/callback cookie + PostHogProvider after identify;
        // see docs/analytics/EVENTS.md. Clear any leftover AuthKit cookie
        // so an abandoned Google redirect + password signup cannot double-fire.
        clearSignupSignalCookieFromDocument()
        if (signupCompleted) {
            captureEvent('signup_completed', { method: 'username', ...authContinuityPayload() }) // signup-once: gated on the server claim (claimSignupEvent)
        }
        clearGateAttempt(window.sessionStorage)
        router.refresh()
        revalidateClientSession()
        await syncGuestFollowsToServer()
        const landed = buildReturnTo(window.location)
        // On /login the page to return to is its `next`, as for AuthKit above.
        const returnTarget = validateNextParam(new URLSearchParams(window.location.search).get("next")) ?? landed
        const destination = resolveAuthKitReturnTo(returnTarget)
        if (destination && destination !== landed) {
            router.replace(destination)
        }
        if (onSuccess) onSuccess()
    }

    const handleSignUp = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!email || !password) {
            setMessage(AUTH_MESSAGES.missingCredentials)
            return
        }
        // Same rule the server applies, checked here so a short password
        // never spends a security-check token or a rate-limit slot.
        const passwordProblem = newPasswordProblem(password)
        if (passwordProblem) {
            setMessage(passwordProblem)
            return
        }

        startTransition(async () => {
            const check = await turnstile.take()
            if (check.status === 'pending') {
                setMessage(TURNSTILE_PENDING_MESSAGE)
                return
            }
            if (check.status === 'failed') {
                setMessage(TURNSTILE_FAILED_MESSAGE)
                googleButtonRef.current?.focus()
                return
            }
            try {
                const formData = new FormData()
                formData.append('email', email)
                formData.append('password', password)
                formData.append('turnstileToken', check.token ?? '')
                const result = await signUp(null, formData)
                if (!applyAuthPresentation(presentAuthResult(result, { username: email }), turnstile.reset)) return
                await finishSignedIn("signupCompleted" in result && result.signupCompleted)
            } catch (err) {
                turnstile.reset()
                setMessage(err instanceof Error ? err.message : "Failed to create account") // signup-gate-exempt: the login form itself, part of the auth flow
            }
        })
    }

    if (verifyStep) {
        return (
            <VerifyCodeStep
                {...verifyStep}
                onVerified={({ signupCompleted }) => finishSignedIn(signupCompleted)}
                onBack={() => { setVerifyStep(null); setPassword('') }}
            />
        )
    }

    if (showForgotPassword) {
        return <ForgotPasswordForm onBack={() => setShowForgotPassword(false)} />
    }

    return (
        <div className="space-y-4 sm:space-y-5 pt-0 sm:pt-1">
            {/* scroll-mt matches the dialog's top padding (auth-popover.tsx). */}
            <div ref={cardTopRef} className="scroll-mt-7 space-y-4 sm:scroll-mt-8 sm:space-y-5">
                <div className="space-y-1.5">
                    {/* A dead end otherwise — this card had no wordmark/home link
                        back to the rest of the site. Reuses TopBar's own lockup
                        (BrandMark.tsx) rather than a second copy of the mark. */}
                    <BrandHomeLink href="/jobs" />
                    <PageTitle>
                        {headline?.title ?? copy.title}
                    </PageTitle>
                    {headline ? (
                        <p className="whitespace-pre-line text-xs text-muted-foreground">{headline.body}</p>
                    ) : (
                        activeTab === "signup" && (
                            <p className="text-xs text-muted-foreground">{SIGNUP_SUBCOPY}</p>
                        )
                    )}
                </div>

                {notice && (
                    <Alert
                        key={notice.id}
                        variant="destructive"
                        data-testid="auth-message"
                        className="enter-reveal text-center"
                    >
                        <AlertDescription>{notice.text}</AlertDescription>
                    </Alert>
                )}
            </div>

            <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as "login" | "signup"); setMessage(null); }} className="w-full">
                {/* Spacing sits on a wrapper: a margin on the list itself would replace its
                    scroll-hit compensation and grow the card. */}
                <div className="mb-3.5 sm:mb-5">
                    <TabsList variant="line">
                        <TabsTrigger value="login">{authCardCopy("login").tabLabel}</TabsTrigger>
                        <TabsTrigger value="signup">{authCardCopy("signup").tabLabel}</TabsTrigger>
                    </TabsList>
                </div>

                {/* Email-first ordering (2026-08-20 signup-ladder audit): Google is
                    the only sign-in path that hands us a real, mail-deliverable
                    address — a username/password account is registered under a
                    synthesized `<username>@intervu.cc` the send layer refuses
                    (see lib/auth/username-email.ts), so it can't actually receive
                    the alerts/digest this form is now selling. That path stays
                    above username/password on both tabs rather than below it. */}
                <div className="grid gap-2 mb-3 sm:mb-4">
                    {activeTab === "signup" && <p className="text-xs text-muted-foreground">{PERSONAL_EMAIL_HINT}</p>}
                    {/* Google now runs through WorkOS rather than Firebase, so
                        every provider issues the same session and the server
                        has one answer to "who is this". `GoogleOAuth` is
                        WorkOS's own identifier for the connection configured in
                        the dashboard — not an app-side name, and not validated
                        here, because WorkOS is the authority on which
                        providers an environment actually has. */}
                    <Button ref={googleButtonRef} variant="outline" type="button" className="w-full" disabled={isPending || authKitPending !== null} onClick={() => startAuthKit("GoogleOAuth")}>
                        {authKitPending === "GoogleOAuth" ? (
                            <InlineSpinner size={16} className="mr-2" />
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
                        type="button"
                        className="w-full"
                        disabled={isPending || authKitPending !== null}
                        onClick={() => startAuthKit()}
                    >
                        {authKitPending === "passkey" ? (
                            <InlineSpinner size={16} className="mr-2" />
                        ) : (
                            <Fingerprint weight="bold" className="size-4" />
                        )}
                        Use a passkey or email code
                    </Button>
                    {onGuestAccess && (
                        <Button variant="outline" type="button" className="w-full" disabled={isPending} onClick={onGuestAccess}>
                            Continue as Guest
                        </Button>
                    )}
                </div>

                <div className="relative mb-3 sm:mb-4">
                    <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs">
                        <span className="bg-surface px-2 text-muted-foreground">
                            or
                        </span>
                    </div>
                </div>

                <div className="grid gap-3 sm:gap-4">
                    <form
                        onSubmit={(e) => {
                            // Same helper as AuthKit: username submit is
                            // method engagement, then the method detail.
                            captureAuthStartedFromGate()
                            captureEvent('auth_method_selected', { method: 'username', ...authContinuityPayload() })
                            void (activeTab === "login" ? handleLogin(e) : handleSignUp(e))
                        }}
                    >
                        <div className="grid gap-3 sm:gap-4">
                            {activeTab === "signup" && (
                                <Field label="Email" htmlFor="email">
                                    <Input
                                        id="email"
                                        type="email"
                                        autoComplete="email"
                                        enterKeyHint="next"
                                        disabled={isPending}
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        onFocus={(e) => e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
                                        className="bg-surface-2 shadow-[var(--shadow-bevel-inset)]"
                                    />
                                </Field>
                            )}
                            {activeTab === "login" && <Field label="Email or username" htmlFor="username">
                                <Input
                                    id="username"
                                    type="text"
                                    autoCapitalize="none"
                                    autoComplete="username"
                                    enterKeyHint="next"
                                    autoCorrect="off"
                                    disabled={isPending}
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    onFocus={(e) => e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
                                    className="bg-surface-2 shadow-[var(--shadow-bevel-inset)]"
                                />
                            </Field>}
                            <Field label="Password" htmlFor="password">
                                <div className="relative">
                                    <Input
                                        id="password"
                                        type={showPassword ? "text" : "password"}
                                        autoCapitalize="none"
                                        autoComplete={activeTab === "signup" ? "new-password" : "current-password"}
                                        enterKeyHint="go"
                                        disabled={isPending}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        onFocus={(e) => e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
                                        className="bg-surface-2 pr-14 shadow-[var(--shadow-bevel-inset)]"
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
                                    <p className="text-xs text-muted-foreground">{NEW_PASSWORD_HINT}</p>
                                )}
                            </Field>
                            {activeTab === "signup" && (
                                <TurnstileWidget
                                    surface="signup"
                                    {...turnstile.widgetProps}
                                    errorMessage="Security check couldn't load. Sign up with Google or an email code above."
                                    alternativeRef={googleButtonRef}
                                />
                            )}
                            <Button
                                type="submit"
                                data-testid="auth-submit-button"
                                disabled={isPending}
                                className="w-full"
                            >
                                {isPending && (
                                    <InlineSpinner size={16} className="mr-2" />
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
        </div>
    )
}
