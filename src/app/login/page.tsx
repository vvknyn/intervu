import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginClient } from "./login-client";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function LoginPage() {
    return (
        <Suspense fallback={<div className="min-h-dvh bg-background" />}>
            <LoginClient />
        </Suspense>
    );
}
