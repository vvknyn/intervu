'use client'

import { useState, useTransition } from 'react'
import { resendVerificationCode, verifyPasswordEmailCode } from '@/actions/auth'
import { EmailCodeFields } from '@/components/auth/email-code-fields'
import { BrandLockup } from '@/components/brand/BrandMark'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { PageTitle } from '@/components/ui/heading'
import { toast } from '@/lib/toast'
import { EMAIL_CODE_HEADLINE, EMAIL_CODE_RESEND_PROMPT, emailCodeBody } from '@/lib/auth/email-code-copy'

/**
 * The code step of the username/password form: WorkOS holds a sign-in until the
 * address is verified. Same copy and layout as the AuthKit page
 * (email-code-client.tsx); `onVerified` runs the form's post-sign-in sequence.
 */
export function VerifyCodeStep({ pendingAuthenticationToken, email, onVerified, onBack }: {
    pendingAuthenticationToken: string
    email: string
    onVerified: (result: { signupCompleted: boolean }) => Promise<void>
    onBack: () => void
}) {
    const [error, setError] = useState<string | null>(null)
    const [isPending, startTransition] = useTransition()

    const submit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        const formData = new FormData(e.currentTarget)
        formData.append('pendingAuthenticationToken', pendingAuthenticationToken)
        startTransition(async () => {
            const result = await verifyPasswordEmailCode(null, formData)
            if ('error' in result) {
                setError(result.error)
                return
            }
            setError(null)
            toast.success('Email verified')
            await onVerified(result)
        })
    }

    const resend = () =>
        startTransition(async () => {
            const result = await resendVerificationCode(email)
            if ('error' in result) setError(result.error)
            else {
                setError(null)
                toast[result.kind](result.notice)
            }
        })

    return (
        <div className="space-y-4 sm:space-y-5 pt-0 sm:pt-1">
            <div className="space-y-1.5">
                <BrandLockup />
                <PageTitle>{EMAIL_CODE_HEADLINE}</PageTitle>
                <p className="text-sm text-muted-foreground">{emailCodeBody(email)}</p>
            </div>
            {error && (
                <Alert variant="destructive" data-testid="auth-message" className="enter-reveal text-center">
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}
            <form onSubmit={submit} className="flex flex-col gap-4">
                <EmailCodeFields isPending={isPending} />
            </form>
            <p className="text-center text-sm text-muted-foreground">
                {EMAIL_CODE_RESEND_PROMPT}{' '}
                <button type="button" disabled={isPending} onClick={resend} className="text-foreground underline underline-offset-4">
                    send a new code
                </button>
                .
            </p>
            <p className="text-center text-sm">
                <button type="button" onClick={onBack} className="text-brand hover:underline">
                    Use a different account
                </button>
            </p>
        </div>
    )
}
