import { PUBLIC_SUPPORT_EMAIL } from "@/lib/legal/public-contact";

/** Plain words for each erase processor (names from eraseAccount's results). */
const PROCESSOR_LABELS: Record<string, string> = {
    "pg-rows": "some saved account records",
    telemetry: "your activity history on our server",
    stripe: "your payment record at Stripe",
    "mirror-store": "a backup copy of your account data",
    posthog: "your analytics data at PostHog",
    "firebase-auth": "an old sign-in record",
};

/** What the person is told when deleteAccount returns a non-empty `incomplete`. */
export function incompleteEraseMessage(incomplete: readonly string[]): string {
    const parts = [...new Set(incomplete.map((p) => PROCESSOR_LABELS[p] ?? p))];
    return `Your account is deleted, but we could not erase ${parts.join(", ")}. Email ${PUBLIC_SUPPORT_EMAIL} and we will remove ${parts.length === 1 ? "it" : "them"} by hand.`;
}
