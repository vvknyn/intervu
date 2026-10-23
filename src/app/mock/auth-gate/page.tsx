import type { Metadata } from "next";
import { AuthGateMock } from "@/components/mock/AuthGateMock";

export const metadata: Metadata = {
    title: "Auth-gate mock",
    robots: { index: false, follow: false },
};

/** Interactive auth-gate flow mock — full-bleed, no site chrome. */
export default function AuthGateMockPage() {
    return <AuthGateMock />;
}
