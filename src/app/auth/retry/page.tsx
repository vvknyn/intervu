import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthRetryClient } from "./auth-retry-client";
import { AuthRouteLoading } from "@/components/auth/auth-route-chrome";

export const metadata: Metadata = {
    robots: { index: false, follow: false },
};

export default function AuthRetryPage() {
    return (
        <Suspense fallback={<AuthRouteLoading label="Loading" />}>
            <AuthRetryClient />
        </Suspense>
    );
}
