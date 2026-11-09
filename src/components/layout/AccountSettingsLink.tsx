"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useSignedIn } from "@/hooks/use-signed-in";
import { hrefForSignedOut } from "@/lib/auth/product-routes";

const SETTINGS_PATH = "/settings";

/**
 * The words "account settings" inside a page of prose, for pages anyone can read.
 * `/settings` answers 307 to the sign-in page for a visitor or a crawler, so the
 * server-rendered link names the sign-in address (which returns to settings after
 * sign-in); a signed-in reader's link becomes `/settings` once the page knows who
 * they are.
 */
export function AccountSettingsLink({ children }: { children: ReactNode }) {
    const signedIn = useSignedIn();
    return <Link href={signedIn ? SETTINGS_PATH : hrefForSignedOut(SETTINGS_PATH)}>{children}</Link>;
}
