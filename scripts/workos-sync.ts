/**
 * Shared WorkOS write layer for the two identity migrations.
 *
 * Both `migrate-firebase-to-workos.ts` and `migrate-supabase-to-workos.ts` need
 * the same things: find a user by email, create or update without damaging what
 * is already there, and put them in the right organization. Those rules are
 * correctness-critical — particularly "never overwrite an existing
 * `external_id`" — so they exist once rather than twice.
 *
 * Not a module under `src/lib`: this is migration tooling, not application
 * runtime. The decisions worth testing are pure and live in
 * `src/lib/auth/workos-apps.ts`; what is left here is the network.
 */

import { buildUpdatePayload, type DesiredUser } from "../src/lib/auth/workos-apps.ts";

const API = "https://api.workos.com";

export interface WorkosClient {
    request: (path: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; body: any }>;
}

export function createClient(apiKey: string): WorkosClient {
    return {
        async request(path, init = {}) {
            const res = await fetch(`${API}${path}`, {
                ...init,
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                    ...(init.headers ?? {}),
                },
            });
            return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
        },
    };
}

export async function findUserByEmail(client: WorkosClient, email: string) {
    const res = await client.request(
        `/user_management/users?email=${encodeURIComponent(email)}&limit=1`,
    );
    return res.ok ? (res.body.data?.[0] ?? null) : null;
}

/**
 * The organization for a product, created if absent.
 *
 * Matched by exact name rather than created blindly, so re-running does not
 * accumulate duplicate organizations — the same idempotency the user upsert
 * needs, for the same reason.
 *
 * No domain is attached deliberately: a domain on a WorkOS organization can
 * drive automatic membership, and membership here should follow from the
 * migration having actually seen the user in that product's database, never
 * from what their email happens to end in.
 */
export async function ensureOrganization(client: WorkosClient, name: string) {
    const list = await client.request(`/organizations?limit=100`);
    const existing = (list.body.data ?? []).find(
        (o: any) => o.name?.toLowerCase() === name.toLowerCase(),
    );
    if (existing) return { id: existing.id as string, created: false };

    const res = await client.request("/organizations", {
        method: "POST",
        body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error(`create organization ${name}: http ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
    return { id: res.body.id as string, created: true };
}

/**
 * Put a user in an organization, tolerating the case where they already are.
 *
 * WorkOS answers a duplicate membership with 409/422 rather than a silent
 * success, so re-running the migration would otherwise report failures for work
 * that was already correctly done.
 */
export async function ensureMembership(client: WorkosClient, userId: string, organizationId: string) {
    const existing = await client.request(
        `/user_management/organization_memberships?user_id=${userId}&organization_id=${organizationId}&limit=1`,
    );
    if (existing.ok && existing.body.data?.length) return "already";

    const res = await client.request("/user_management/organization_memberships", {
        method: "POST",
        body: JSON.stringify({ user_id: userId, organization_id: organizationId }),
    });
    if (res.ok) return "added";
    if (res.status === 409 || res.status === 422) return "already";
    throw new Error(`membership http ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
}

export type UpsertOutcome =
    | { action: "created"; id: string; externalId?: string }
    | { action: "updated"; id: string }
    | { action: "failed"; status: number; code?: string };

/**
 * Create the user, or reconcile the one that already exists.
 *
 * The update path goes through `buildUpdatePayload`, which is where the rules
 * that protect a dual-product user live. A password hash is only ever sent on
 * create: overwriting a working credential with one from the other system would
 * change which password signs a person in.
 */
export async function upsertUser(client: WorkosClient, desired: DesiredUser): Promise<UpsertOutcome> {
    const existing = await findUserByEmail(client, desired.email);

    if (existing) {
        const res = await client.request(`/user_management/users/${existing.id}`, {
            method: "PUT",
            body: JSON.stringify(buildUpdatePayload(existing, desired)),
        });
        return res.ok
            ? { action: "updated", id: existing.id }
            : { action: "failed", status: res.status, code: res.body?.code };
    }

    const res = await client.request("/user_management/users", {
        method: "POST",
        body: JSON.stringify(desired),
    });
    return res.ok
        ? { action: "created", id: res.body.id, externalId: res.body.external_id }
        : { action: "failed", status: res.status, code: res.body?.code };
}
