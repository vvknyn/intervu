import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { getServerUser } from "@/lib/auth/server-user";
import { decideReturn } from "@/lib/billing/return";
import { getStripe } from "@/lib/billing/stripe-client";
import { readIdField } from "@/lib/billing/events";
import { recomputeAccess } from "@/lib/billing/recompute";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageTitle } from "@/components/ui/heading";

export const metadata: Metadata = { title: "Payment", robots: { index: false } };

async function resolveMessage(sessionId: string | undefined): Promise<string> {
    const user = await getServerUser();
    const stripe = getStripe();
    if (!user || !stripe || !sessionId) return "We could not find that payment. Sign in and try again from the pricing page.";
    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const outcome = decideReturn(session, user.uid);
        if (outcome === "not_yours") return "That payment belongs to a different account.";
        if (outcome === "failed") return "That payment did not go through. You have not been charged.";
        if (outcome === "pending") return "Your payment is still processing. Your access will appear here once it clears.";
        const customerId = readIdField(session.customer);
        if (!customerId) return "Your payment went through but is still being linked to your account. Refresh in a minute.";
        const until = await recomputeAccess(user.uid, customerId);
        return `Paid until ${new Date(until).toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" })}.`;
    } catch {
        return "We could not confirm that payment yet. If you were charged, your access will appear shortly.";
    }
}

export default async function BillingReturnPage({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
    await connection();
    const message = await resolveMessage((await searchParams).session_id);
    return (
        <PageContainer measure="reading" className="py-16">
            <PageTitle>Payment</PageTitle>
            <p className="mt-4">{message}</p>
            <p className="mt-6">
                <Link href="/jobs" className="underline">Back to jobs</Link>
            </p>
        </PageContainer>
    );
}
