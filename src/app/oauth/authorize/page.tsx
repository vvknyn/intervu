import type { Metadata } from "next";
import Link from "next/link";
import { firestoreStore } from "@/lib/agent/store";
import { validateConsentRequest, consentParamsToQuery, type ConsentParams, type ConsentParamsInput } from "@/lib/agent/consent";
import { getServerUser } from "@/lib/auth/server-user";
import { approveConsentAction, denyConsentAction } from "@/actions/agent-consent";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConsentAllowButton, ConsentDenyButton } from "@/components/oauth/ConsentSubmitButtons";

// Neutral by design — `clientName` below is attacker-chosen DCR metadata
// (see `redirectHost`'s doc comment) and must never land in a <title>.
export const metadata: Metadata = {
    title: "Connect an agent",
};

function CenteredCard({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex min-h-[70vh] items-center justify-center p-4">
            <Card className="w-full max-w-md">{children}</Card>
        </div>
    );
}

function ErrorCard({ message }: { message: string }) {
    return (
        <CenteredCard>
            <CardHeader>
                <CardTitle>Can&apos;t connect this agent</CardTitle>
                <CardDescription>{message}</CardDescription>
            </CardHeader>
        </CenteredCard>
    );
}

/**
 * `returnTo` is this exact `/oauth/authorize` request (validated params,
 * re-serialized) — `/login` round-trips it back via its `next` param
 * (`validateNextParam`, product-routes.ts) once sign-in completes, so a
 * fresh user mid-install resumes the approval instead of losing it.
 */
function LoggedOutCard({ returnTo }: { returnTo: string }) {
    const loginUrl = `/login?${new URLSearchParams({ next: returnTo }).toString()}`;
    return (
        <CenteredCard>
            <CardHeader>
                <CardTitle>Sign in to continue</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
                <p>Sign in to approve connecting your agent.</p>
            </CardContent>
            <CardFooter>
                <Button asChild className="w-full">
                    <Link href={loginUrl}>Sign in</Link>
                </Button>
            </CardFooter>
        </CenteredCard>
    );
}

function HiddenConsentFields({ params }: { params: ConsentParams }) {
    return (
        <>
            <input type="hidden" name="client_id" value={params.client_id} />
            <input type="hidden" name="redirect_uri" value={params.redirect_uri} />
            <input type="hidden" name="code_challenge" value={params.code_challenge} />
            <input type="hidden" name="code_challenge_method" value={params.code_challenge_method} />
            <input type="hidden" name="response_type" value={params.response_type} />
            {params.state && <input type="hidden" name="state" value={params.state} />}
        </>
    );
}

/**
 * `params.redirect_uri` has already passed `isAllowedRedirectUri`
 * (`validateConsentRequest`, consent.ts) by the time this renders — https:,
 * or http: on localhost/127.0.0.1 only — so `new URL()` here can't throw.
 * Naming the redirect host (IMPORTANT 6 review fix) matters because
 * `clientName` is attacker-chosen DCR metadata (`registerClient`, oauth.ts,
 * accepts any `client_name`) — a user approving on name alone has no way to
 * notice a client calling itself "Claude Code" while actually sending the
 * access code somewhere else.
 */
function redirectHost(redirectUri: string): string {
    return new URL(redirectUri).host;
}

function ConsentCard({ clientName, params }: { clientName: string; params: ConsentParams }) {
    return (
        <CenteredCard>
            <CardHeader>
                {/* Neutral heading, quoted client (redesign 2026-08-27): the page
                    speaks in its own voice, never the agent's self-declared name —
                    `clientName` is attacker-chosen DCR metadata (see redirectHost's
                    doc comment above) and only ever appears as quoted data below,
                    never as a claim this page itself is making. */}
                <CardTitle>Connect this agent to your account</CardTitle>
                <div className="mt-1 inline-flex w-fit items-center gap-1 border border-border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
                    agent says it is: <span className="font-medium text-foreground">&quot;{clientName}&quot;</span>
                </div>
                <p className="text-xs text-muted-foreground pt-1">
                    Will send its access code to: {redirectHost(params.redirect_uri)}
                </p>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>This will let it:</p>
                <ul className="list-disc space-y-1 pl-5">
                    <li>Search verified-real jobs as you</li>
                    <li>Save jobs &amp; update your application tracker</li>
                </ul>
                <p>It cannot read your chats, files, or resume.</p>
            </CardContent>
            <CardFooter className="flex gap-2">
                <form action={approveConsentAction} className="flex-1">
                    <HiddenConsentFields params={params} />
                    <ConsentAllowButton />
                </form>
                <form action={denyConsentAction} className="flex-1">
                    <HiddenConsentFields params={params} />
                    <ConsentDenyButton />
                </form>
            </CardFooter>
        </CenteredCard>
    );
}

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
