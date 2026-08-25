import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginClient } from "./login-client";
import { RouteSuspenseFallback } from "@/components/ui/route-suspense-fallback";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function LoginPage() {
    return (
        <Suspense fallback={<RouteSuspenseFallback label="Loading login" />}>
            <LoginClient />
        </Suspense>
    );
}
