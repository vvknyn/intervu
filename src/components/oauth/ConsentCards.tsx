import Link from "next/link";
import { approveConsentAction, denyConsentAction } from "@/actions/agent-consent";
import { BrandLockup } from "@/components/brand/BrandMark";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConsentAllowButton, ConsentDenyButton } from "@/components/oauth/ConsentSubmitButtons";
import type { ConsentParams } from "@/lib/agent/consent";

/**
 * Brand lockup for the chrome-free /oauth surface — same mark/wordmark
 * treatment as `TopBar`'s `topbar-logo` (icon + uppercase wordmark, both
 * `text-brand`), reused here because `shouldHideSiteChrome` hides the TopBar
 * on every route under here and each card needs its own identity in its place.
 */
function ConsentBrand() {
    return (
        <div className="mb-6 flex items-center justify-center">
            <BrandLockup />
        </div>
    );
}

export function CenteredCard({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex min-h-[70vh] flex-col items-center justify-center p-4">
            <ConsentBrand />
            <Card className="w-full max-w-md">{children}</Card>
        </div>
    );
}

export function ErrorCard({ message }: { message: string }) {
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
export function LoggedOutCard({ returnTo }: { returnTo: string }) {
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

export function ConsentCard({ clientName, params }: { clientName: string; params: ConsentParams }) {
    return (
        <CenteredCard>
            <CardHeader>
                {/* Neutral heading, quoted client (redesign 2026-08-27): the page
                    speaks in its own voice, never the agent's self-declared name —
                    `clientName` is attacker-chosen DCR metadata (see redirectHost's
                    doc comment above) and only ever appears as quoted data below,
                    never as a claim this page itself is making. */}
                <CardTitle>Connect this agent to your account</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
                <div className="border border-border bg-muted p-3">
                    <dl className="grid grid-cols-[7.5rem_1fr] gap-y-1.5 text-xs">
                        <dt className="text-muted-foreground">says it is</dt>
                        <dd className="text-foreground">&quot;{clientName}&quot;</dd>
                        <dt className="text-muted-foreground">sends code to</dt>
                        {/* `<code>` per typography.test.ts — a font-mono utility
                            class is banned on .tsx, and a host is exactly the kind
                            of literal-code value the <code> element exists for. */}
                        <dd className="text-foreground">
                            <code className="text-foreground">{redirectHost(params.redirect_uri)}</code>
                        </dd>
                    </dl>
                </div>
                <p className="text-xs text-muted-foreground">
                    The name is self-reported. Check the destination before allowing.
                </p>
                <div className="space-y-2">
                    <p>This will let it:</p>
                    <ul className="list-disc space-y-1 pl-5">
                        <li>Search verified-real jobs as you</li>
                        <li>Save jobs &amp; update your application tracker</li>
                    </ul>
                    <p>It cannot read your chats, files, or resume.</p>
                </div>
            </CardContent>
            <CardFooter className="flex gap-2">
                {/* Deny left, Allow right — standard dialog affirmative-right
                    ordering (2026-08-27 polish). */}
                <form action={denyConsentAction} className="flex-1">
                    <HiddenConsentFields params={params} />
                    <ConsentDenyButton />
                </form>
                <form action={approveConsentAction} className="flex-1">
                    <HiddenConsentFields params={params} />
                    <ConsentAllowButton />
                </form>
            </CardFooter>
        </CenteredCard>
    );
}
