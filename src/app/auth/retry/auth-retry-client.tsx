"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthRaisedPanel, AuthRouteLayout } from "@/components/auth/auth-route-chrome";
import { BrandLockup } from "@/components/brand/BrandMark";
import { Button } from "@/components/ui/button";
import { validateNextParam } from "@/lib/auth/product-routes";
import {
    AUTH_RETRY_BODY,
    AUTH_RETRY_BUTTON_LABEL,
    AUTH_RETRY_HEADLINE,
} from "@/lib/auth/auth-retry-copy";

/**
 * Landing spot for every way /auth/callback can fail — a stale bookmark
 * (no `code`/`error` at all), an expired PKCE cookie, a state mismatch, a
 * denied authorization, or the code exchange itself throwing. All routed
 * here by `buildCallbackRetryRedirect` (src/lib/auth/callback-guard.ts) and
 * `onError` (src/app/auth/callback/route.ts) instead of a raw WorkOS 500
 * JSON body. One honest message for all of them — from outside the SDK we
 * can't tell a denied consent from an expired link, and pretending
 * otherwise would be a lie the copy doesn't back up. `reason` in the URL is
 * for server-side debugging only; it doesn't change what's shown.
 *
 * `next` is only ever present when the failing request itself already
 * carried one (most classes won't — see callback-guard.ts) — re-validated
 * here rather than trusted as-is, since it rode through a redirect chain.
 */
export function AuthRetryClient() {
    const searchParams = useSearchParams();
    const next = validateNextParam(searchParams.get("next"));
    const retryHref = `/auth/start${next ? `?next=${encodeURIComponent(next)}` : ""}`;

    return (
        <AuthRouteLayout>
            <AuthRaisedPanel className="text-center">
                <BrandLockup className="mx-auto w-fit" />
                <h1 className="mt-4 text-xl font-semibold text-foreground">{AUTH_RETRY_HEADLINE}</h1>
                <p className="mt-2 text-sm text-muted-foreground">{AUTH_RETRY_BODY}</p>
                <Button asChild size="lg" className="mt-8">
                    <Link href={retryHref}>{AUTH_RETRY_BUTTON_LABEL}</Link>
                </Button>
            </AuthRaisedPanel>
        </AuthRouteLayout>
    );
}
