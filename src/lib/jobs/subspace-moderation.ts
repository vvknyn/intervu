/**
 * Subspace admin-moderation client (SERVER-ONLY).
 *
 * Calls `POST/GET /api/v1/admin/moderation` (docs/intervu-jobs-api.md in the
 * Subspace repo). It authenticates with its OWN key, `SUBSPACE_ADMIN_API_KEY`,
 * never `SUBSPACE_API_KEY`: the key that reads the jobs feeds, and the one the
 * public report intake uses, cannot close a listing or reject a domain, and the
 * key that can is held by nothing but this module. Callers (src/actions/
 * admin-moderation.ts) have already established that the human is an admin.
 *
 * Reads `SUBSPACE_ADMIN_API_KEY` and `SUBSPACE_API_BASE_URL` at call time, never
 * at import, so `next build` works without them. Without the key every call
 * answers `unavailable`, and the admin UI renders nothing rather than a dead
 * control.
 */
import { subspaceApiBase } from "./subspaceJobs";

const PATH = "/api/v1/admin/moderation";
/** Closing one listing or previewing a domain is a handful of statements. */
const DEFAULT_TIMEOUT_MS = 20_000;
/** Rejecting a big domain closes its listings 500 at a time. */
export const REJECT_DOMAIN_TIMEOUT_MS = 120_000;

export type ModerationResult<T> =
    | { ok: true; status: number; data: T }
    | { ok: false; status: number; code: string; message: string };

export function hasModerationKey(): boolean {
    return Boolean(process.env.SUBSPACE_ADMIN_API_KEY) && Boolean(process.env.SUBSPACE_API_BASE_URL);
}

function unavailable(): ModerationResult<never> {
    return { ok: false, status: 0, code: "unavailable", message: "Admin moderation isn't configured on this server." };
}

async function send<T>(method: "GET" | "POST", query: string, body: unknown, timeoutMs: number): Promise<ModerationResult<T>> {
    if (!hasModerationKey()) return unavailable();
    let res: Response;
    try {
        res = await fetch(`${subspaceApiBase()}${PATH}${query}`, {
            method,
            headers: {
                "x-api-key": process.env.SUBSPACE_ADMIN_API_KEY as string,
                accept: "application/json",
                ...(method === "POST" ? { "content-type": "application/json" } : {}),
            },
            ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
            cache: "no-store",
            signal: AbortSignal.timeout(timeoutMs),
        });
    } catch (e) {
        if (e instanceof Error && e.name === "TimeoutError") {
            return {
                ok: false,
                status: 0,
                code: "timeout",
                message: "Subspace didn't answer in time. The change may still be running; check Recent actions before retrying.",
            };
        }
        return { ok: false, status: 0, code: "network_error", message: "Couldn't reach Subspace." };
    }

    const json = (await res.json().catch(() => null)) as { data?: T; error?: { message?: string; code?: string } } | null;
    if (!res.ok || !json || json.data === undefined) {
        return {
            ok: false,
            status: res.status,
            code: json?.error?.code ?? `http_${res.status}`,
            message: json?.error?.message ?? `Subspace answered ${res.status}.`,
        };
    }
    return { ok: true, status: res.status, data: json.data };
}

/** One moderation action. `body` is the Subspace contract: { action, actor, ... }. */
export function postModeration<T>(body: Record<string, unknown> & { action: string }): Promise<ModerationResult<T>> {
    const timeoutMs = body.action === "reject_domain" && body.dry_run !== true ? REJECT_DOMAIN_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
    return send<T>("POST", "", body, timeoutMs);
}

/** Newest-first log rows. */
export function getModerationLog<T>(limit = 50): Promise<ModerationResult<T>> {
    return send<T>("GET", `?limit=${encodeURIComponent(String(limit))}`, undefined, DEFAULT_TIMEOUT_MS);
}
