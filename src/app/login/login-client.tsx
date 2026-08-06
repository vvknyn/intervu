"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthPopover } from "@/components/auth/auth-popover";
import { BrandMark } from "@/components/brand/BrandMark";
import { validateNextParam } from "@/lib/auth/product-routes";
import { getCurrentUser, onAuthChange, type User } from "@/lib/firebase/client-auth";

export function LoginClient() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [user, setUser] = useState<User | null>(null);

    useEffect(() => {
        const current = getCurrentUser();
        if (current) setUser(current);
        return onAuthChange(setUser);
    }, []);

    const redirectAfterAuth = useCallback(() => {
        router.replace(validateNextParam(searchParams.get("next")) ?? "/jobs");
    }, [router, searchParams]);

    useEffect(() => {
        if (user) redirectAfterAuth();
    }, [user, redirectAfterAuth]);

    return (
        <main
            className="flex min-h-dvh flex-col items-center justify-center px-5 pb-12 pt-[72px]"
            style={{
                background:
                    "radial-gradient(900px 500px at 50% 40%, #1a1f27 0%, transparent 60%), #12151a",
            }}
        >
            <div className="mb-9 flex flex-col items-center">
                <div className="flex items-center gap-5">
                    <BrandMark className="h-24 w-24 text-[#ececec] sm:h-28 sm:w-28" />
                    <span className="text-[52px] font-semibold leading-none tracking-[-0.045em] text-[#ececec] sm:text-[60px]">
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
