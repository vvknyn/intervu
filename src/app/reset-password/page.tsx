import type { Metadata } from "next";
import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { RouteSuspenseFallback } from "@/components/ui/route-suspense-fallback";

export const metadata: Metadata = {
    title: "Set a new password",
};

export default function ResetPasswordPage() {
    return (
        <Suspense fallback={<RouteSuspenseFallback label="Loading reset password" />}>
            <ResetPasswordForm />
        </Suspense>
    );
}
