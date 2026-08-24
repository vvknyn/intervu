"use client";

import { useAuth } from "@workos-inc/authkit-nextjs/components";

/**
 * WorkOS AuthKit nav authentication component.
 * Uses refreshAuth({ ensureSignedIn: true }) for sign-in instead of computing
 * a sign-in URL during render (which would set PKCE cookies unsafely).
 */
export function WorkOSNavAuth() {
    const { user, loading, refreshAuth } = useAuth();

    if (loading) {
        return <span aria-hidden className="block h-8 w-8 shrink-0" />;
    }

    if (user) {
        return (
            <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-foreground">
                    {user.firstName ?? user.email}
                </span>
                <form action="/auth/signout" method="POST">
                    <button
                        type="submit"
                        className="text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                        Sign out
                    </button>
                </form>
            </div>
        );
    }

    return (
        <button
            type="button"
            onClick={() => void refreshAuth({ ensureSignedIn: true })}
            className="rounded-none bg-foreground px-3.5 py-1.5 text-[13px] font-bold uppercase tracking-wider text-background transition-colors hover:bg-foreground/90"
        >
            Sign in
        </button>
    );
}
