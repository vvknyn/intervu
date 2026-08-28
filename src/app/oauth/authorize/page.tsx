import type { Metadata } from "next";
import { firestoreStore } from "@/lib/agent/store";
import { validateConsentRequest, consentParamsToQuery, type ConsentParamsInput } from "@/lib/agent/consent";
import { getServerUser } from "@/lib/auth/server-user";
import { ConsentCard, LoggedOutCard, ErrorCard } from "@/components/oauth/ConsentCards";

// Neutral by design — `clientName` below is attacker-chosen DCR metadata
// (see `redirectHost`'s doc comment in ConsentCards.tsx) and must never land
// in a <title>.
export const metadata: Metadata = {
    title: "Connect an agent",
};

/**
 * GET /oauth/authorize — the OAuth consent screen. Server component: reads
 * searchParams, validates the request BEFORE rendering anything, and only
 * ever offers Allow/Deny once client_id + redirect_uri + PKCE shape all
 * check out. A validation failure renders an inline error card — it never
 * redirects to a redirect_uri that hasn't been proven to belong to this client.
 */
export default async function AuthorizePage({
    searchParams,
}: {
    searchParams: Promise<ConsentParamsInput>;
}) {
    const raw = await searchParams;
    const store = firestoreStore();
    const validation = await validateConsentRequest(store, raw);

    if (!validation.ok) {
        return <ErrorCard message={validation.error} />;
    }

    const user = await getServerUser();
    if (!user) {
        const returnTo = `/oauth/authorize?${consentParamsToQuery(validation.params)}`;
        return <LoggedOutCard returnTo={returnTo} />;
    }

    return <ConsentCard clientName={validation.client.name} params={validation.params} />;
}
