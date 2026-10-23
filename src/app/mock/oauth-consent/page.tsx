import type { Metadata } from "next";
import { ConsentCard, LoggedOutCard, ErrorCard } from "@/components/oauth/ConsentCards";
import { consentParamsToQuery, type ConsentParams } from "@/lib/agent/consent";

export const metadata: Metadata = {
    title: "Oauth-consent mock",
    robots: { index: false, follow: false },
};

const FIXTURE_PARAMS: ConsentParams = {
    client_id: "mock-client",
    redirect_uri: "http://127.0.0.1:33445/callback",
    code_challenge: "mock-challenge",
    code_challenge_method: "S256",
    response_type: "code",
};

/**
 * Static pixel-proof for all three /oauth/authorize cards (2026-08-27
 * polish) — fixture props only, forms never submit (no interaction wired
 * up), full-bleed via `shouldHideSiteChrome`'s /mock branch.
 */
export default function OauthConsentMockPage() {
    return (
        <div className="space-y-12 py-10">
            <ErrorCard message="redirect_uri is not registered for this client" />
            <LoggedOutCard returnTo={`/oauth/authorize?${consentParamsToQuery(FIXTURE_PARAMS)}`} />
            <ConsentCard clientName="mcporter (Velai MCP)" params={FIXTURE_PARAMS} />
        </div>
    );
}
