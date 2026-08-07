import { redirect } from "next/navigation";
import { validateNextParam } from "@/lib/auth/product-routes";

/**
 * The front door IS the job board (spec Phase 1b): `/` redirects to `/jobs`.
 * The `?signin=1` contract (no in-repo producers — external/legacy links)
 * is honored first, exactly as the retired landing deck honored it.
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
        redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
    }
    redirect("/jobs");
}
