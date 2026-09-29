import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthRetryClient } from "./auth-retry-client";
import { AuthRouteLoading } from "@/components/auth/auth-route-chrome";
import { decideCallbackFailureLanding } from "@/lib/auth/callback-guard";
import { getServerUser } from "@/lib/auth/server-user";

export const metadata: Metadata = {
    robots: { index: false, follow: false },
};

/**
 * Direct visits and back-button returns land here too, not only redirects from
 * /auth/callback — a visitor with a valid session is sent on, same decision
 * as the callback's `onError`.
 */
export default async function AuthRetryPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
    const { next } = await searchParams;
    const landing = decideCallbackFailureLanding({
        hasSession: (await getServerUser()) !== null,
        rawNext: typeof next === "string" ? next : null,
    });
    if (landing.kind === "redirect") redirect(landing.path);

    return (
        <Suspense fallback={<AuthRouteLoading label="Loading sign-in" />}>
            <AuthRetryClient />
        </Suspense>
    );
}
