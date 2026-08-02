import { firestoreStore } from "@/lib/agent/store";
import { validateConsentRequest, type ConsentParams, type ConsentParamsInput } from "@/lib/agent/consent";
import { getServerUser } from "@/lib/firebase/auth-session";
import { approveConsentAction, denyConsentAction } from "@/actions/agent-consent";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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

function LoggedOutCard() {
    return (
        <CenteredCard>
            <CardHeader>
                <CardTitle>Log in first</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
                <p>Log in on intervu first, then reconnect from your agent.</p>
            </CardContent>
            <CardFooter>
                <Button asChild className="w-full">
                    <a href="/">Go to intervu</a>
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

function ConsentCard({ clientName, params }: { clientName: string; params: ConsentParams }) {
    return (
        <CenteredCard>
            <CardHeader>
                <CardTitle>{clientName}</CardTitle>
                <CardDescription>wants to connect to your intervu account</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>This will let <strong className="text-foreground">{clientName}</strong>:</p>
                <ul className="list-disc space-y-1 pl-5">
                    <li>Search verified-real jobs as you</li>
                    <li>Save jobs &amp; update your application tracker</li>
                </ul>
                <p>It cannot read your chats, files, or resume.</p>
            </CardContent>
            <CardFooter className="flex gap-2">
                <form action={approveConsentAction} className="flex-1">
                    <HiddenConsentFields params={params} />
                    <Button type="submit" className="w-full">Allow</Button>
                </form>
                <form action={denyConsentAction} className="flex-1">
                    <HiddenConsentFields params={params} />
                    <Button type="submit" variant="outline" className="w-full">Deny</Button>
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
        return <LoggedOutCard />;
    }

    return <ConsentCard clientName={validation.client.name} params={validation.params} />;
}
