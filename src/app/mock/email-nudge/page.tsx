import type { Metadata } from "next";
import { EmailNudgeMock } from "@/components/mock/EmailNudgeMock";

export const metadata: Metadata = {
    title: "Email-nudge mock",
};

/** Every state of the account-email prompt, for pixel verification. */
export default function EmailNudgeMockPage() {
    return <EmailNudgeMock />;
}
