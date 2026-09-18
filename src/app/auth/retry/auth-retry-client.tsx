"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BrandLockup } from "@/components/brand/BrandMark";
import { Button } from "@/components/ui/button";
import { validateNextParam } from "@/lib/auth/product-routes";

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
        <div className="mx-auto flex min-h-dvh max-w-120 flex-col items-center justify-center px-6 text-center">
            <BrandLockup />
            <h1 className="mt-4 text-xl font-semibold text-foreground">That sign-in link expired</h1>
            <p className="mt-2 text-sm text-muted-foreground">Try again.</p>
            <Button asChild size="sm" className="mt-8">
                <Link href={retryHref}>Try again</Link>
            </Button>
        </div>
    );
}
