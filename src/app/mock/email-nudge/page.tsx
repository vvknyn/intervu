import type { Metadata } from "next";
import { EmailNudgeMock } from "@/components/mock/EmailNudgeMock";

export const metadata: Metadata = {
    title: "Email-nudge mock — Intervu",
    robots: { index: false, follow: false },
};

/** Every state of the account-email prompt, for pixel verification. */
export default function EmailNudgeMockPage() {
    return <EmailNudgeMock />;
}
