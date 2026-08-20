import { randomBytes, createHash } from "node:crypto";
import type { Queryable } from "../pg/pool";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface IdentityRow {
  id: string;
  email: string;
  emailVerifiedAt: string | null;
  contactToken: string;
}

interface IdentityDbRow {
  id: string;
  email: string;
  email_verified_at: string | null;
  contact_token: string;
}

function toIdentityRow(row: IdentityDbRow): IdentityRow {
  return { id: row.id, email: row.email, emailVerifiedAt: row.email_verified_at, contactToken: row.contact_token };
}

export async function upsertIdentityForEmail(q: Queryable, email: string): Promise<IdentityRow> {
  const normalized = normalizeEmail(email);
  const { rows } = await q.query<IdentityDbRow>(
    `INSERT INTO intervu.identities (email)
     VALUES ($1)
     ON CONFLICT ((lower(email))) DO UPDATE SET last_seen_at = now()
     RETURNING id, email, email_verified_at, contact_token`,
    [normalized]
  );
  return toIdentityRow(rows[0]);
}

export async function countRecentVerifyTokens(q: Queryable, email: string, sinceHours: number): Promise<number> {
  const normalized = normalizeEmail(email);
  const { rows } = await q.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM intervu.auth_tokens t
     JOIN intervu.identities i ON i.id = t.identity_id
     WHERE lower(i.email) = $1
       AND t.purpose = 'verify_email'
       AND t.created_at > now() - ($2 || ' hours')::interval`,
    [normalized, String(sinceHours)]
  );
  return rows[0]?.count ?? 0;
}

export async function createVerifyToken(
  q: Queryable,
  input: { identityId: string; redirectPath: string; requestIp?: string }
): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(raw).digest();
  await q.query(
    `INSERT INTO intervu.auth_tokens (token_hash, identity_id, purpose, redirect_path, request_ip, expires_at)
     VALUES ($1, $2, 'verify_email', $3, $4, now() + interval '30 minutes')`,
    [tokenHash, input.identityId, input.redirectPath, input.requestIp ?? null]
  );
  return raw;
}

export async function consumeVerifyToken(
  q: Queryable,
  rawToken: string
): Promise<{ identityId: string; email: string; redirectPath: string; contactToken: string } | null> {
  const tokenHash = createHash("sha256").update(rawToken).digest();
  const { rows: tokenRows } = await q.query<{ identity_id: string; redirect_path: string }>(
    `UPDATE intervu.auth_tokens
     SET consumed_at = now()
     WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now() AND purpose = 'verify_email'
     RETURNING identity_id, redirect_path`,
    [tokenHash]
  );
  const token = tokenRows[0];
  if (!token) return null;

  const { rows: identityRows } = await q.query<IdentityDbRow>(
    `UPDATE intervu.identities
     SET email_verified_at = COALESCE(email_verified_at, now())
     WHERE id = $1
     RETURNING id, email, email_verified_at, contact_token`,
    [token.identity_id]
  );
  const identity = identityRows[0];
  if (!identity) return null;

  return {
    identityId: identity.id,
    email: identity.email,
    redirectPath: token.redirect_path,
    contactToken: identity.contact_token,
  };
}

export async function addEmailFollow(
  q: Queryable,
  input: { identityId: string; companyDomain: string; displayName: string }
): Promise<void> {
  await q.query(
    `INSERT INTO intervu.email_follows (identity_id, company_domain, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (identity_id, company_domain)
     DO UPDATE SET unsubscribed_at = NULL, display_name = EXCLUDED.display_name`,
    [input.identityId, input.companyDomain, input.displayName]
  );
}

export async function removeEmailFollow(q: Queryable, identityId: string, companyDomain: string): Promise<void> {
  await q.query(
    `UPDATE intervu.email_follows
     SET unsubscribed_at = now()
     WHERE identity_id = $1 AND company_domain = $2`,
    [identityId, companyDomain]
  );
}

export async function getIdentityByContactToken(q: Queryable, contactToken: string): Promise<IdentityRow | null> {
  const { rows } = await q.query<IdentityDbRow>(
    `SELECT id, email, email_verified_at, contact_token
     FROM intervu.identities
     WHERE contact_token = $1`,
    [contactToken]
  );
  return rows[0] ? toIdentityRow(rows[0]) : null;
}

export async function listEmailFollowRecipients(
  q: Queryable
): Promise<Array<{ identityId: string; email: string; follows: Array<{ domain: string; displayName: string }> }>> {
  const { rows } = await q.query<{ identity_id: string; email: string; company_domain: string; display_name: string }>(
    `SELECT i.id AS identity_id, i.email, f.company_domain, f.display_name
     FROM intervu.identities i
     JOIN intervu.email_follows f ON f.identity_id = i.id
     WHERE i.email_verified_at IS NOT NULL AND f.unsubscribed_at IS NULL
     ORDER BY i.id`,
    []
  );

  const byIdentity = new Map<string, { identityId: string; email: string; follows: Array<{ domain: string; displayName: string }> }>();
  for (const row of rows) {
    let entry = byIdentity.get(row.identity_id);
    if (!entry) {
      entry = { identityId: row.identity_id, email: row.email, follows: [] };
      byIdentity.set(row.identity_id, entry);
    }
    entry.follows.push({ domain: row.company_domain, displayName: row.display_name });
  }
  return [...byIdentity.values()];
}

export async function deleteIdentityByEmail(q: Queryable, email: string): Promise<boolean> {
  const normalized = normalizeEmail(email);
  const { rows } = await q.query<{ id: string }>(
    `DELETE FROM intervu.identities WHERE lower(email) = $1 RETURNING id`,
    [normalized]
  );
  return rows.length > 0;
}
