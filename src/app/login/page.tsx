import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginClient } from "./login-client";
import { AuthRouteLoading } from "@/components/auth/auth-route-chrome";
import { robotsMetadataFor } from "@/lib/seo/indexability";

export const metadata: Metadata = {
  ...robotsMetadataFor("/login"), // signup-gate-exempt: a robots-policy path key, not a rendered prompt or href
};

export default function LoginPage() {
    return (
        <Suspense fallback={<AuthRouteLoading label="Loading sign in" />}>
            <LoginClient />
        </Suspense>
    );
}
