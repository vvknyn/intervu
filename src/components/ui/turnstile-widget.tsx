'use client'

import Script from 'next/script'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
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
            reset: (widgetId: string) => void
            remove: (widgetId: string) => void
        }
    }
}

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

/** Whether this build renders a challenge at all (a site key was inlined at build time). */
export const TURNSTILE_ENABLED = Boolean(TURNSTILE_SITE_KEY)

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

/** Default advice: a form whose server has no path that skips Turnstile can only be retried. */
const RELOAD_MESSAGE = "The security check didn't load, so we can't verify this form right now. Reload the page to try again."

/** Shown in place of a silently dead form when the challenge cannot run. */
export function TurnstileErrorNotice({ message = RELOAD_MESSAGE }: { message?: string }) {
    return (
        <p role="alert" data-testid="turnstile-error" className="w-full text-xs text-destructive">
            {message}
        </p>
    )
}

interface TurnstileWidgetProps {
    onVerify: (token: string | null) => void
    /**
     * Change it after every submit the server answered without success: a
     * Turnstile token is single-use, and Cloudflare refuses a second
     * siteverify of the same one ("timeout-or-duplicate"). Without a reset
     * the widget keeps showing "Success" while every retry sends the spent
     * token (2026-10-01: a signup retried six times on one token, then hit
     * the rate limit).
     */
    resetKey?: number
    /** Called when the challenge cannot run (script blocked, Cloudflare error). */
    onError?: () => void
    /** Which form this is — tags the `turnstile_error` event. */
    surface: TurnstileSurface
    /** Replaces the reload advice, only where the page already offers a way in that skips Turnstile. */
    errorMessage?: string
    /** That way in: focused and scrolled into view on the first failure. */
    alternativeRef?: RefObject<HTMLElement | null>
}

/**
 * Cloudflare Turnstile challenge widget — server-side verification lives in
 * `lib/shield/turnstile.ts`; this is only the browser half that produces a
 * token for `signUp` to send along. Renders nothing when
 * `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is unset — no broken box, no dead script
 * tag — so the signup form works unchanged before Turnstile keys exist, the
 * same "inert until configured" seam the server-side check uses.
 */
export function TurnstileWidget({ onVerify, resetKey = 0, onError, surface, errorMessage, alternativeRef }: TurnstileWidgetProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const widgetIdRef = useRef<string | null>(null)
    const [scriptLoaded, setScriptLoaded] = useState(false)
    const [errorCode, setErrorCode] = useState<string | null>(null)
    // Cloudflare retries a failed challenge and fires error-callback again on
    // each try (~10s); acting once per mounted widget keeps the event count =
    // visitors hit and never pulls focus back while the visitor is elsewhere.
    const reportedRef = useRef(false)

    const fail = useCallback(
        (raw: unknown) => {
            if (!reportedRef.current) {
                reportTurnstileError(raw, surface)
                alternativeRef?.current?.scrollIntoView({ block: 'center' })
                alternativeRef?.current?.focus({ preventScroll: true })
            }
            reportedRef.current = true
            setErrorCode(normalizeTurnstileErrorCode(raw))
            onVerify(null)
            onError?.()
        },
        [surface, onVerify, onError, alternativeRef],
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

    // A new resetKey asks Cloudflare for a fresh token in the same widget. The
    // first render's key is the baseline, not a reset.
    const lastResetKeyRef = useRef(resetKey)
    useEffect(() => {
        if (lastResetKeyRef.current === resetKey) return
        lastResetKeyRef.current = resetKey
        onVerify(null)
        if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current)
    }, [resetKey, onVerify])

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
            {errorCode && <TurnstileErrorNotice message={errorMessage} />}
        </>
    )
}

/** How long a submit waits for a fresh token before telling the visitor what is still pending. */
export const TURNSTILE_TOKEN_WAIT_MS = 8_000

export type TurnstileTake =
    | { status: "ready"; token: string | null }
    | { status: "pending" }
    | { status: "failed" }

/**
 * Pure (no React): the holder for one form's single-use token. `take()` hands
 * the current token out at most once, waiting up to `waitMs` for one to
 * arrive; with no challenge in this build (`enabled` false) it is ready at
 * once with no token, matching the server's not-configured pass.
 */
export function createTurnstileTokenSlot(enabled: boolean, waitMs: number = TURNSTILE_TOKEN_WAIT_MS) {
    let token: string | null = null
    let failed = false
    const waiters = new Set<() => void>()
    const wake = () => {
        for (const waiter of [...waiters]) waiter()
    }

    return {
        onVerify(next: string | null) {
            token = next
            if (next) {
                failed = false
                wake()
            }
        },
        onError() {
            failed = true
            wake()
        },
        clear() {
            token = null
        },
        async take(): Promise<TurnstileTake> {
            if (!enabled) return { status: "ready", token: null }
            if (!token && !failed) {
                await new Promise<void>((resolve) => {
                    const done = () => {
                        clearTimeout(timer)
                        waiters.delete(done)
                        resolve()
                    }
                    const timer = setTimeout(done, waitMs)
                    waiters.add(done)
                })
            }
            if (token) {
                const taken = token
                token = null
                return { status: "ready", token: taken }
            }
            return failed ? { status: "failed" } : { status: "pending" }
        },
    }
}

/**
 * The form half of a single-use token: hand the widget `widgetProps`, call
 * `take()` on submit, and `reset()` after any answer that wasn't a success.
 *
 * `take()` waits briefly for a token instead of sending none: right after a
 * reset (or on a fast first submit) the challenge is still running, and a
 * submit with no token is refused by the server as "the security check didn't
 * load", which is not what happened.
 */
export function useTurnstileToken(waitMs: number = TURNSTILE_TOKEN_WAIT_MS) {
    const [slot] = useState(() => createTurnstileTokenSlot(TURNSTILE_ENABLED, waitMs))
    const [resetKey, setResetKey] = useState(0)

    const onVerify = useCallback((token: string | null) => slot.onVerify(token), [slot])
    const onError = useCallback(() => slot.onError(), [slot])
    const take = useCallback(() => slot.take(), [slot])
    const reset = useCallback(() => {
        slot.clear()
        setResetKey((key) => key + 1)
    }, [slot])

    return { widgetProps: { onVerify, onError, resetKey }, take, reset }
}
