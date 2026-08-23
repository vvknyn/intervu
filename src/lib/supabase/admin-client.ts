import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseProjectUrl } from "@/lib/supabase/public-env";

let adminClient: SupabaseClient | null = null;

/**
 * Create Supabase client with service role. Use only in server/worker context.
 * For Next server actions use createAdminClient from server.ts (which uses cookies when needed).
 * This module has no Next.js imports so it can be used from Node scripts.
 *
 * Ported from interview-os (subspace)'s src/lib/supabase/admin-client.ts.
 * The source wraps `global.fetch` in a guarded, table-routing fetch
 * (guarded-fetch.ts + db-router.ts's createRoutingFetch) so every
 * PostgREST call gets a timeout, HTML-response detection, bounded retry,
 * and per-table cutover to a self-hosted Postgres box. intervu has neither
 * piece of infra: its data store is Firestore, not Postgres, so this
 * client's Postgres access is auth-only and there is no second box to route
 * to. This intentionally uses the plain default fetch instead of inventing
 * a parallel guard/router for a need that doesn't exist yet.
 */
export function getAdminClient(): SupabaseClient {
    if (adminClient) return adminClient;
    const url = getSupabaseProjectUrl();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!key) {
        throw new Error(
            "SUPABASE_SERVICE_ROLE_KEY is required for admin client (run `supabase status -o env` for local keys)",
        );
    }
    adminClient = createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
    return adminClient;
}
