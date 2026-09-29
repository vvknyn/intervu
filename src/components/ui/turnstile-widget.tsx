'use client'

import Script from 'next/script'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { captureEvent, type TurnstileSurface } from '@/lib/analytics/events'

declare global {
    interface Window {
        turnstile?: {
            render: (
                container: HTMLElement,
                options: {
                    sitekey: string
                    callback: (token: string) => void
                    'expired-callback'?: () => void
                    'error-callback'?: (errorCode: string) => void
                    theme?: 'light' | 'dark' | 'auto'
                },
            ) => string
            remove: (widgetId: string) => void
        }
    }
}

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

/** Recorded when api.js itself never loads (ad blocker, CSP, offline) — no Cloudflare code exists then. */
const SCRIPT_LOAD_FAILED = 'script_load_failed'

/**
 * Pure: Cloudflare's error code, made safe to ship as an analytics property.
 * Real codes are short numeric strings ("110200"); anything else (empty,
 * non-string, a long or oddly shaped value) is recorded as "unknown" rather
 * than passed through, so this can never carry free-form text.
 */
export function normalizeTurnstileErrorCode(raw: unknown): string {
    return typeof raw === 'string' && /^[a-z0-9_-]{1,32}$/i.test(raw) ? raw : 'unknown'
}

/** Emits `turnstile_error` and returns the normalized code. */
export function reportTurnstileError(raw: unknown, surface: TurnstileSurface): string {
    const code = normalizeTurnstileErrorCode(raw)
    captureEvent('turnstile_error', { code, surface })
    return code
}

/**
 * Shown in place of a silently dead form when the challenge cannot run.
 * `fallback` carries the surface's alternative paths (e.g. Google / email
 * code); without one the only honest advice is to reload.
 */
export function TurnstileErrorNotice({ fallback }: { fallback?: ReactNode }) {
    return (
        <div role="alert" data-testid="turnstile-error" className="w-full text-xs text-destructive">
            <p>
                The security check didn&apos;t load, so we can&apos;t verify this form right now.{' '}
                {fallback ? 'You can still continue another way:' : 'Reload the page to try again.'}
            </p>
            {fallback && <div data-testid="turnstile-fallback">{fallback}</div>}
        </div>
    )
}

interface TurnstileWidgetProps {
    onVerify: (token: string | null) => void
    /** Which form this is — tags the `turnstile_error` event. */
    surface: TurnstileSurface
    /** Alternative paths shown with the error message, only where the server accepts one that skips Turnstile. */
    fallback?: ReactNode
}

/**
 * Cloudflare Turnstile challenge widget — server-side verification lives in
 * `lib/shield/turnstile.ts`; this is only the browser half that produces a
 * token for `signUp` to send along. Renders nothing when
 * `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is unset — no broken box, no dead script
 * tag — so the signup form works unchanged before Turnstile keys exist, the
 * same "inert until configured" seam the server-side check uses.
 */
export function TurnstileWidget({ onVerify, surface, fallback }: TurnstileWidgetProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const widgetIdRef = useRef<string | null>(null)
    const [scriptLoaded, setScriptLoaded] = useState(false)
    const [errorCode, setErrorCode] = useState<string | null>(null)
    // Cloudflare retries a failed challenge and fires error-callback again on
    // each try; one event per mounted widget keeps the count = visitors hit.
    const reportedRef = useRef(false)

    const fail = useCallback(
        (raw: unknown) => {
            const code = reportedRef.current ? normalizeTurnstileErrorCode(raw) : reportTurnstileError(raw, surface)
            reportedRef.current = true
            setErrorCode(code)
            onVerify(null)
        },
        [surface, onVerify],
    )

    useEffect(() => {
        if (!scriptLoaded || !TURNSTILE_SITE_KEY) return
        if (!containerRef.current || !window.turnstile || widgetIdRef.current) return

        widgetIdRef.current = window.turnstile.render(containerRef.current, { // turnstile-wrapper: the one place a widget renders
            sitekey: TURNSTILE_SITE_KEY,
            theme: 'auto',
            callback: (token) => {
                setErrorCode(null)
                onVerify(token)
            },
            'expired-callback': () => onVerify(null),
            'error-callback': fail,
        })

        return () => {
            if (widgetIdRef.current && window.turnstile) {
                window.turnstile.remove(widgetIdRef.current)
                widgetIdRef.current = null
            }
        }
    }, [scriptLoaded, onVerify, fail])

    if (!TURNSTILE_SITE_KEY) return null

    // next/script fires onLoad only for a mount that saw the load; a widget
    // remounted after api.js loaded (e.g. /contact's form remounts once on
    // hydration) is told only via onReady — without it, it never renders.
    const markLoaded = () => setScriptLoaded(true)

    return (
        <>
            <Script
                src="https://challenges.cloudflare.com/turnstile/v0/api.js" // turnstile-wrapper: the one place api.js loads
                strategy="lazyOnload"
                onLoad={markLoaded}
                onReady={markLoaded}
                onError={() => fail(SCRIPT_LOAD_FAILED)}
            />
            <div ref={containerRef} className="flex justify-center" />
            {errorCode && <TurnstileErrorNotice fallback={fallback} />}
        </>
    )
}
