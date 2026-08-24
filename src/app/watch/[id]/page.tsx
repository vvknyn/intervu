/**
 * The page the user opens on their phone.
 *
 * Login-gated (spec D4). The link is unguessable, but the form on screen
 * carries an address, a phone number and a work history, so a forwarded
 * WhatsApp message must not be enough to watch it being filled in.
 *
 * Logged-out visitors are shown a prompt rather than redirected. The link IS
 * the session — bouncing to `/` would discard the id and leave no way back,
 * and this is a page people reach from a message on a phone, which is
 * exactly when they are least likely to already have a session cookie.
 */
import Link from "next/link";
import { getServerUser } from "@/lib/auth/server-user";
import { WatchCanvas } from "@/components/viewer/watch-canvas";

export default async function WatchPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const user = await getServerUser();

    if (!user) {
        return (
            <main className="min-h-dvh bg-black text-white flex items-center justify-center p-6">
                <div className="max-w-sm text-center space-y-4" data-testid="watch-login-required">
                    <h1 className="text-lg font-medium">Log in to watch</h1>
                    <p className="text-sm text-white/60">
                        Log in to intervu on this phone, then open this link again to see the
                        application being filled in.
                    </p>
                    <Link
                        href="/"
                        className="inline-block rounded-md bg-white px-4 py-2 text-sm font-medium text-black"
                    >
                        Go to intervu
                    </Link>
                </div>
            </main>
        );
    }

    return <WatchCanvas sessionId={id} />;
}
