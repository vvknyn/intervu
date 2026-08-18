'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { BrandMark } from '@/components/brand/BrandMark'
import { signInWithUsername, signUpWithUsername, signInWithGoogle, isPopupCancelled } from '@/lib/firebase/client-auth'
import { friendlyAuthMessage } from '@/lib/firebase/auth-errors'
import { signUp } from '@/actions/auth'
import { TurnstileWidget } from '@/components/ui/turnstile-widget'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CircleNotch } from '@phosphor-icons/react'
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm'
import { AUTH_MESSAGES } from '@/lib/copy'
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface LoginFormProps {
    onSuccess?: () => void;
    onGuestAccess?: () => void;
}

const authFieldClass =
    "min-h-11 rounded-lg border border-border bg-background px-3.5 text-sm text-foreground shadow-2xs focus:border-brand focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30";

/** Standard 4-color Google "G" glyph — no icon library ships a brand mark
 *  for it, and pulling in a new dependency for one static SVG isn't worth
 *  it. Inline, no dark-mode variant needed (the mark itself is brand-fixed). */
function GoogleGlyph() {
    return (
        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
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

export function LoginForm({ onSuccess, onGuestAccess }: LoginFormProps = {}) {
    const router = useRouter()
    const [activeTab, setActiveTab] = useState<"login" | "signup">("login")
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [isPending, startTransition] = useTransition()
    const [message, setMessage] = useState<string | null>(null)
    const [showForgotPassword, setShowForgotPassword] = useState(false)
    const [turnstileToken, setTurnstileToken] = useState<string | null>(null)

    const handleUsernameLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setMessage(null)

        startTransition(async () => {
            try {
                await signInWithUsername(username, password)
                router.refresh()
                if (onSuccess) onSuccess()
            } catch (err: any) {
                setMessage(friendlyAuthMessage(err, 'Sign-in failed — try again in a moment.'))
            }
        })
    }

    const handleGoogleSignIn = () => {
        setMessage(null)

        startTransition(async () => {
            try {
                const user = await signInWithGoogle()
                // `null` means the popup was blocked and we fell back to a
                // full-page redirect — the browser is about to navigate away,
                // there's nothing left for this component to do.
                if (!user) return
                router.refresh()
                if (onSuccess) onSuccess()
            } catch (err) {
                if (isPopupCancelled(err)) {
                    setMessage('Sign-in was cancelled — try again whenever you’re ready.')
                } else {
                    setMessage(friendlyAuthMessage(err, 'Google sign-in failed — try again in a moment.'))
                }
            }
        })
    }

    const handleSignUp = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!username || !password) {
            setMessage(AUTH_MESSAGES.missingCredentials)
            return
        }

        setMessage(null)

        startTransition(async () => {
            try {
                const formData = new FormData()
                formData.append('username', username)
                formData.append('password', password)
                formData.append('turnstileToken', turnstileToken ?? '')
                const result = await signUp(null, formData)
                if (result?.error) {
                    setMessage(result.error)
                    return
                }
                await signInWithUsername(username, password)
                router.refresh()
                if (onSuccess) onSuccess()
            } catch (err: any) {
                setMessage(friendlyAuthMessage(err, 'Sign up failed — try again in a moment.'))
            }
        })
    }

    if (showForgotPassword) {
        return <ForgotPasswordForm onBack={() => setShowForgotPassword(false)} />
    }

    return (
        <div className="space-y-5 pt-1">
            <div className="text-center space-y-1.5">
                {/* ITEM R (2026-08-15, Vivek screenshot): the wordmark row
                    sat optically off-center against the two lines below it.
                    All three lines now share this ONE `text-center`
                    container as their only centering mechanism — the
                    wordmark row is `inline-flex` (sized to its own content,
                    positioned by the ancestor's text-align like its plain-
                    text siblings) instead of a full-width `flex` box
                    centered by its own `justify-center`, which was a second,
                    independent centering calculation that could drift a
                    pixel from the text-align one beside it. */}
                <div className="inline-flex items-center gap-2">
                    <BrandMark className="h-6 w-6 text-foreground" />
                    <span className="font-display font-bold text-lg text-foreground">intervu</span>
                </div>
                <h3 className="font-bold text-xl tracking-tight text-foreground">
                    {activeTab === "login" ? "Welcome back" : "Create your account"}
                </h3>
                <p className="text-xs text-muted-foreground">
                    {activeTab === "login"
                        ? "Enter your credentials to access your account"
                        : "Start tracking real openings and syncing with your AI"}
                </p>
            </div>

            <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as "login" | "signup"); setMessage(null); }} className="w-full">
                <TabsList className="grid w-full grid-cols-2 h-11 rounded-full bg-chip p-1 mb-5">
                    <TabsTrigger
                        value="login"
                        className="h-full w-full rounded-full font-bold text-xs tracking-wider uppercase data-[state=active]:bg-card data-[state=active]:text-brand data-[state=active]:border data-[state=active]:border-brand/40 data-[state=active]:shadow-none"
                    >
                        Log In
                    </TabsTrigger>
                    <TabsTrigger
                        value="signup"
                        className="h-full w-full rounded-full font-bold text-xs tracking-wider uppercase data-[state=active]:bg-card data-[state=active]:text-brand data-[state=active]:border data-[state=active]:border-brand/40 data-[state=active]:shadow-none"
                    >
                        Sign Up
                    </TabsTrigger>
                </TabsList>

                <div className="grid gap-4">
                    <form onSubmit={activeTab === "login" ? handleUsernameLogin : handleSignUp}>
                        <div className="grid gap-4">
                            <div className="grid gap-1">
                                <Label className="sr-only" htmlFor="username">
                                    Username
                                </Label>
                                <Input
                                    id="username"
                                    placeholder="Username"
                                    type="text"
                                    autoCapitalize="none"
                                    autoComplete="username"
                                    autoCorrect="off"
                                    disabled={isPending}
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    className={authFieldClass}
                                />
                            </div>
                            <div className="grid gap-1">
                                <Label className="sr-only" htmlFor="password">
                                    Password
                                </Label>
                                <div className="relative">
                                    <Input
                                        id="password"
                                        placeholder="Password"
                                        type={showPassword ? "text" : "password"}
                                        autoCapitalize="none"
                                        autoComplete={activeTab === "signup" ? "new-password" : "current-password"}
                                        disabled={isPending}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className={`${authFieldClass} pr-14`}
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
                            </div>
                            {activeTab === "signup" && (
                                <TurnstileWidget onVerify={setTurnstileToken} />
                            )}
                            <Button
                                disabled={isPending}
                                className="w-full bg-brand text-brand-foreground hover:bg-brand hover:opacity-90 dark:bg-brand dark:text-brand-foreground dark:hover:bg-brand"
                            >
                                {isPending && (
                                    <CircleNotch size={16} className="mr-2 animate-spin" />
                                )}
                                {activeTab === "login" ? "Log In" : "Sign Up"}
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

            <div className="relative">
                <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">
                        Or
                    </span>
                </div>
            </div>

            <div className="grid gap-2">
                <Button variant="outline" type="button" className="w-full" disabled={isPending} onClick={handleGoogleSignIn}>
                    <GoogleGlyph />
                    Continue with Google
                </Button>
                {onGuestAccess && (
                    <Button variant="outline" type="button" className="w-full" disabled={isPending} onClick={onGuestAccess}>
                        Continue as Guest
                    </Button>
                )}
            </div>

            {message && (
                <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm justify-center">
                    <p>{message}</p>
                </div>
            )}
        </div>
    )
}
