'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { signInWithUsername, signUpWithUsername, signInWithGoogle, isPopupCancelled } from '@/lib/firebase/client-auth'
import { friendlyAuthMessage } from '@/lib/firebase/auth-errors'
import { signUp } from '@/actions/auth'
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
    const [isPending, startTransition] = useTransition()
    const [message, setMessage] = useState<string | null>(null)
    const [showForgotPassword, setShowForgotPassword] = useState(false)

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
                // Create user + profile on server
                const formData = new FormData()
                formData.append('username', username)
                formData.append('password', password)
                const result = await signUp(null, formData)
                if (result?.error) {
                    setMessage(result.error)
                    return
                }
                // Sign in client-side to create session cookie
                await signInWithUsername(username, password)
                router.refresh()
                if (onSuccess) onSuccess()
            } catch (err: any) {
                setMessage(friendlyAuthMessage(err, 'Sign up failed — try again in a moment.'))
            }
        })
    }

    if (showForgotPassword) {
        return <ForgotPasswordForm onBack={() => setShowForgotPassword(false)} />;
    }

    return (
        <div className="grid gap-6">
            <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as "login" | "signup"); setMessage(null); }} className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-4">
                    <TabsTrigger value="login">Log In</TabsTrigger>
                    <TabsTrigger value="signup">Sign Up</TabsTrigger>
                </TabsList>

                <div className="mb-4 text-center space-y-1">
                    <h3 className="font-semibold text-lg tracking-tight">
                        {activeTab === "login" ? "Welcome back" : "Create an account"}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                        {activeTab === "login"
                            ? "Enter your credentials to access your account"
                            : "Enter your email below to create your account"}
                    </p>
                </div>

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
                                />
                            </div>
                            <div className="grid gap-1">
                                <Label className="sr-only" htmlFor="password">
                                    Password
                                </Label>
                                <Input
                                    id="password"
                                    placeholder="Password"
                                    type="password"
                                    autoCapitalize="none"
                                    autoComplete="current-password"
                                    disabled={isPending}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                />
                            </div>
                            <Button disabled={isPending} className="w-full">
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
                                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
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
