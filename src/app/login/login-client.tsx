"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthPopover } from "@/components/auth/auth-popover";
import { BrandMark } from "@/components/brand/BrandMark";
import { validateNextParam } from "@/lib/auth/product-routes";
import { createPostAuthHandoff } from "@/lib/auth/post-auth-redirect";
import {
    getCurrentUser,
    onAuthChange,
    refreshSession,
    type User,
} from "@/lib/firebase/client-auth";

export function LoginClient() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [user, setUser] = useState<User | null>(null);

    useEffect(() => {
        const current = getCurrentUser();
        if (current) setUser(current);
        return onAuthChange(setUser);
    }, []);

    /**
     * Leaving by document navigation rather than `router.replace`: the cookie
     * the destination renders from was just minted by a fetch from this page,
     * and a fresh document is the one way to be certain the server render sees
     * it — no reasoning about what the client router kept from the signed-out
     * render the visitor arrived from. Sign-in happens once a session; one
     * page load is the right price for a destination that always agrees with
     * the credential.
     */
    const handOff = useMemo(
        () =>
            createPostAuthHandoff({
                ensureServerSession: refreshSession,
                leave: (destination) => window.location.replace(destination),
            }),
        [],
    );

    const redirectAfterAuth = useCallback(() => {
        void handOff(validateNextParam(searchParams.get("next")) ?? "/jobs");
    }, [handOff, searchParams]);

    useEffect(() => {
        if (user) redirectAfterAuth();
    }, [user, redirectAfterAuth]);

    return (
        <main
            className="flex min-h-dvh flex-col items-center justify-center px-5 pb-12 pt-[72px]"
            style={{
                background:
                    "linear-gradient(180deg, rgb(var(--live-tint-bg)) 0%, rgb(var(--background)) 420px)",
            }}
        >
            <div className="mb-9 flex flex-col items-center">
                <div className="flex items-center gap-5">
                    <BrandMark className="h-24 w-24 text-foreground sm:h-28 sm:w-28" />
                    <span className="text-[52px] font-semibold leading-none tracking-[-0.045em] text-foreground sm:text-[60px]">
                        intervu
                    </span>
                </div>
            </div>

            <AuthPopover
                open={!user}
                onOpenChange={(open) => {
                    if (!open && !user) router.replace("/");
                }}
                showTrigger={false}
                onAuthed={redirectAfterAuth}
            />
        </main>
    );
}
