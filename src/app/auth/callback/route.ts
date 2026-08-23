import { relativeRedirect } from "@/lib/http/relative-redirect";

/**
 * Auth callback route — no longer needed for Firebase.
 * Firebase Auth handles redirects client-side.
 * Keeping this route to avoid 404s from old links.
 */
export async function GET() {
    return relativeRedirect("/");
}
