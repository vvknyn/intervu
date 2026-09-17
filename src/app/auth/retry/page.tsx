import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthRetryClient } from "./auth-retry-client";
import { RouteSuspenseFallback } from "@/components/ui/route-suspense-fallback";

export const metadata: Metadata = {
    robots: { index: false, follow: false },
};

export default function AuthRetryPage() {
    return (
        <Suspense fallback={<RouteSuspenseFallback label="Loading" />}>
            <AuthRetryClient />
        </Suspense>
    );
}
