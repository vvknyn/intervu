/**
 * Shared URL + anon key for the browser client, and cookie-based server
 * clients. See `.env.example`.
 *
 * Ported from interview-os (subspace)'s src/lib/supabase/public-env.ts.
 * Difference from the source: this only recognizes the canonical
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the legacy `NEXT_PUBLIC_SUPABASE_KEY`
 * spelling that also exists there is intentionally not accepted here so
 * intervu has exactly one name per var, not two.
 *
 * In development only: when *both* env vars are unset, use Supabase CLI local
 * defaults so the app runs without `.env.local`. Never pair a partial config.
 */

/** `supabase start` — documented demo anon JWT (not a secret). */
export const DEV_FALLBACK_SUPABASE_URL = "http://127.0.0.1:54321";
export const DEV_FALLBACK_SUPABASE_ANON =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

export function getPublicSupabaseUrlAndKey(): { url: string; key: string } {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

    if (url && key) return { url, key };

    if (process.env.NODE_ENV === "development" && !url && !key) {
        return { url: DEV_FALLBACK_SUPABASE_URL, key: DEV_FALLBACK_SUPABASE_ANON };
    }

    throw new Error(
        "Supabase: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY. See .env.example and https://supabase.com/dashboard/project/_/settings/api",
    );
}

/**
 * Project URL for server-side Supabase clients (service role, scripts).
 * In development, falls back to the local CLI default when unset so server
 * routes stay aligned with {@link getPublicSupabaseUrlAndKey} without requiring
 * a duplicate URL line in `.env.local`.
 */
export function getSupabaseProjectUrl(): string {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    if (url) return url;
    if (process.env.NODE_ENV === "development") {
        return DEV_FALLBACK_SUPABASE_URL;
    }
    throw new Error(
        "Supabase: set NEXT_PUBLIC_SUPABASE_URL. See .env.example and https://supabase.com/dashboard/project/_/settings/api",
    );
}
