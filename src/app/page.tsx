import { permanentRedirect, redirect } from "next/navigation";
import { validateNextParam } from "@/lib/auth/product-routes";

/**
 * The front door IS the job board (spec Phase 1b): `/` permanently (308) redirects to `/jobs`.
 * Handles the `?signin=1` contract (no in-repo producers currently — this
 * exists for external/legacy links). Redirects to `/login` with `next`
 * validated via `validateNextParam`. Already-authenticated users are
 * forwarded onward by `/login` itself, not by this route.
 */
export default async function HomePage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const params = await searchParams;
    if (params.signin === "1") {
        const raw = typeof params.next === "string" ? params.next : null;
        const next = validateNextParam(raw);
        redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login"); // signup-gate-exempt: server redirect into the auth flow, not a rendered prompt
    }
    permanentRedirect("/jobs");
}
