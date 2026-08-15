import { Suspense } from "react";
import { LoginClient } from "./login-client";

export default function LoginPage() {
    return (
        <Suspense fallback={<div className="min-h-dvh bg-background" />}>
            <LoginClient />
        </Suspense>
    );
}
