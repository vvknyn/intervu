'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { signInWithUsername, signUpWithUsername } from '@/lib/firebase/client-auth'
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
                const msg = err?.message || ''
                if (msg.includes('auth/invalid-credential') || msg.includes('auth/wrong-password') || msg.includes('auth/user-not-found')) {
                    setMessage('Invalid username or password')
                } else {
                    setMessage(msg)
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
                setMessage(err?.message || 'Sign up failed')
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

            {onGuestAccess && (
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
            )}

            {onGuestAccess && (
                <Button variant="outline" type="button" className="w-full" disabled={isPending} onClick={onGuestAccess}>
                    Continue as Guest
                </Button>
            )}

            {message && (
                <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm justify-center">
                    <p>{message}</p>
                </div>
            )}
        </div>
    )
}
