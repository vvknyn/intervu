"use client";

import { Suspense, useEffect, useState } from "react";
import { AppShell } from "./AppShell";
import { onAuthChange, type User } from "@/lib/firebase/client-auth";

interface AppShellWrapperProps {
    children: React.ReactNode;
}

export function AppShellWrapper({ children }: AppShellWrapperProps) {
    const [user, setUser] = useState<User | null>(null);

    useEffect(() => {
        const unsubscribe = onAuthChange((user) => {
            setUser(user);
        });

        return () => unsubscribe();
    }, []);

    return (
        <Suspense>
            <AppShell user={user}>{children}</AppShell>
        </Suspense>
    );
}
