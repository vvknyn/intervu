import type { Metadata } from "next";
import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { WaitState } from "@/components/ui/wait-state";

export const metadata: Metadata = {
    title: "Set a new password",
};

export default function ResetPasswordPage() {
    return (
        <Suspense fallback={<WaitState label="Loading reset password" fill className="bg-background" />}>
            <ResetPasswordForm />
        </Suspense>
    );
}
