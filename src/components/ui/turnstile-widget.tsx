'use client'

import Script from 'next/script'
import { useEffect, useRef, useState } from 'react'

declare global {
    interface Window {
        turnstile?: {
            render: (
                container: HTMLElement,
                options: {
                    sitekey: string
                    callback: (token: string) => void
                    'expired-callback'?: () => void
                    'error-callback'?: () => void
                    theme?: 'light' | 'dark' | 'auto'
                },
            ) => string
            remove: (widgetId: string) => void
        }
    }
}

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

interface TurnstileWidgetProps {
    onVerify: (token: string | null) => void
}

/**
 * Cloudflare Turnstile challenge widget — server-side verification lives in
 * `lib/shield/turnstile.ts`; this is only the browser half that produces a
 * token for `signUp` to send along. Renders nothing when
 * `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is unset — no broken box, no dead script
 * tag — so the signup form works unchanged before Turnstile keys exist, the
 * same "inert until configured" seam the server-side check uses.
 */
export function TurnstileWidget({ onVerify }: TurnstileWidgetProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const widgetIdRef = useRef<string | null>(null)
    const [scriptLoaded, setScriptLoaded] = useState(false)

    useEffect(() => {
        if (!scriptLoaded || !TURNSTILE_SITE_KEY) return
        if (!containerRef.current || !window.turnstile || widgetIdRef.current) return

        widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: TURNSTILE_SITE_KEY,
            theme: 'auto',
            callback: (token) => onVerify(token),
            'expired-callback': () => onVerify(null),
            'error-callback': () => onVerify(null),
        })

        return () => {
            if (widgetIdRef.current && window.turnstile) {
                window.turnstile.remove(widgetIdRef.current)
                widgetIdRef.current = null
            }
        }
    }, [scriptLoaded, onVerify])

    if (!TURNSTILE_SITE_KEY) return null

    return (
        <>
            <Script
                src="https://challenges.cloudflare.com/turnstile/v0/api.js"
                strategy="lazyOnload"
                onLoad={() => setScriptLoaded(true)}
            />
            <div ref={containerRef} className="flex justify-center" />
        </>
    )
}
