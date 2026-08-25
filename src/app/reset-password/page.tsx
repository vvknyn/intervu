import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { RouteSuspenseFallback } from "@/components/ui/route-suspense-fallback";

export default function ResetPasswordPage() {
    return (
        <Suspense fallback={<RouteSuspenseFallback label="Loading reset password" />}>
            <ResetPasswordForm />
        </Suspense>
    );
}
