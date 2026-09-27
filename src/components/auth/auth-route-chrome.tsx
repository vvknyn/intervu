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
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return <div className={cn(authRaisedPanelClassName, "p-6 sm:p-8", className)}>{children}</div>;
}

/** Suspense fallback for `/login`, `/auth/retry`, and other chrome-free auth routes. */
export function AuthRouteLoading({ label }: { label: string }) {
    return (
        <AuthRouteLayout>
            <div role="status" aria-busy="true" className={cn(authRaisedPanelClassName, "flex flex-col items-center justify-center gap-3 p-10 text-muted-foreground")}>
                <div
                    className="h-5 w-5 animate-spin rounded-pill border-2 border-live border-t-transparent"
                    aria-hidden
                />
                <p className="text-sm">{label}</p>
            </div>
        </AuthRouteLayout>
    );
}
