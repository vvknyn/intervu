import { WaitState } from "@/components/ui/wait-state";
import { cn } from "@/lib/utils";

/** Poster canvas + raised panel — shared by chrome-free auth routes. */
export const authRaisedPanelClassName =
    "w-full max-w-100 rounded-panel border border-border bg-surface shadow-[var(--shadow-bevel-highlight)]";

export function AuthRouteLayout({
    children,
    className,
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "flex min-h-dvh flex-col items-center justify-center bg-background px-5 pb-12",
                className,
            )}
        >
            {children}
        </div>
    );
}

export function AuthRaisedPanel({
    children,
    className,
    ...rest
}: React.ComponentProps<"div">) {
    return (
        <div className={cn(authRaisedPanelClassName, "p-6 sm:p-8", className)} {...rest}>
            {children}
        </div>
    );
}

/** Suspense fallback for `/login`, `/auth/retry`, and other chrome-free auth routes. */
export function AuthRouteLoading({ label }: { label: string }) {
    return (
        <AuthRouteLayout>
            <WaitState
                label={label}
                className={cn(authRaisedPanelClassName, "flex min-h-32 flex-col items-center justify-center p-10")}
            />
        </AuthRouteLayout>
    );
}
