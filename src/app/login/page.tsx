import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginClient } from "./login-client";
import { AuthRouteLoading } from "@/components/auth/auth-route-chrome";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function LoginPage() {
    return (
        <Suspense fallback={<AuthRouteLoading label="Loading sign in" />}>
            <LoginClient />
        </Suspense>
    );
}
