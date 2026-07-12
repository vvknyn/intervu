"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { AppShell } from "./AppShell";
import { onAuthChange, refreshSession, type User } from "@/lib/firebase/client-auth";

interface AppShellWrapperProps {
    children: React.ReactNode;
}

export function AppShellWrapper({ children }: AppShellWrapperProps) {
    const [user, setUser] = useState<User | null>(null);
    const sessionRefreshed = useRef(false);

    useEffect(() => {
        const unsubscribe = onAuthChange((user) => {
            setUser(user);
            // The httpOnly session cookie expires after 14 days while the
            // client SDK keeps the user signed in indefinitely — server
            // actions then see a logged-in user as anonymous (AUTH_REQUIRED).
            // Re-mint the cookie from the fresh ID token once per app load.
            if (user && !sessionRefreshed.current) {
                sessionRefreshed.current = true;
                refreshSession().catch(() => {
                    // Offline or transient failure — the next page load retries.
                });
            }
        });

        return () => unsubscribe();
    }, []);

    return (
        <Suspense>
            <AppShell user={user}>{children}</AppShell>
        </Suspense>
    );
}
