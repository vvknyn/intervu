import { randomBytes, createHash } from "node:crypto";
import type { Queryable } from "../pg/pool";
import type { EventPayloads } from "../analytics/events";

/** Same shape `search_alert_submitted`/`search_alert_verified` share (the
 *  latter is the former minus `outcome`) — round-tripped through
 *  `auth_tokens.intent_analytics` from submit to verify, since the verify
 *  request is a bare token consume with no live search context of its own. */
export type SearchAlertAnalytics = EventPayloads["search_alert_verified"];

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
  return countRecentVerifyTokensForPurpose(q, email, "verify_email", sinceHours);
}

export async function countRecentVerifyTokensForPurpose(
  q: Queryable,
  email: string,
  purpose: "verify_email" | "verify_search_alert",
  sinceHours: number,
): Promise<number> {
  const normalized = normalizeEmail(email);
  const { rows } = await q.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM intervu.auth_tokens t
     JOIN intervu.identities i ON i.id = t.identity_id
     WHERE lower(i.email) = $1
       AND t.purpose = $2
       AND t.created_at > now() - ($3 || ' hours')::interval`,
    [normalized, purpose, String(sinceHours)],
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

export async function createSearchAlertVerifyToken(
  q: Queryable,
  input: {
    identityId: string;
    redirectPath: string;
    requestIp?: string;
    name: string;
    href: string;
    searchHash: string;
    distinctId: string | null;
    analytics: SearchAlertAnalytics;
  },
): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(raw).digest();
  await q.query(
    `INSERT INTO intervu.auth_tokens
       (token_hash, identity_id, purpose, redirect_path, request_ip, intent_name, intent_href, intent_search_hash, intent_distinct_id, intent_analytics, expires_at)
     VALUES ($1, $2, 'verify_search_alert', $3, $4, $5, $6, $7, $8, $9, now() + interval '30 minutes')`,
    [
      tokenHash,
      input.identityId,
      input.redirectPath,
      input.requestIp ?? null,
      input.name,
      input.href,
      input.searchHash,
      input.distinctId ?? null,
      JSON.stringify(input.analytics),
    ],
  );
  return raw;
}

export async function consumeSearchAlertToken(
  q: Queryable,
  rawToken: string,
): Promise<{
  identityId: string;
  email: string;
  redirectPath: string;
  contactToken: string;
  name: string;
  href: string;
  searchHash: string;
  distinctId: string | null;
  analytics: SearchAlertAnalytics | null;
} | null> {
  const tokenHash = createHash("sha256").update(rawToken).digest();
  const { rows: tokenRows } = await q.query<{
    identity_id: string;
    redirect_path: string;
    intent_name: string | null;
    intent_href: string | null;
    intent_search_hash: string | null;
    intent_distinct_id: string | null;
    intent_analytics: SearchAlertAnalytics | null;
  }>(
    `UPDATE intervu.auth_tokens
     SET consumed_at = now()
     WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now() AND purpose = 'verify_search_alert'
     RETURNING identity_id, redirect_path, intent_name, intent_href, intent_search_hash, intent_distinct_id, intent_analytics`,
    [tokenHash],
  );
  const token = tokenRows[0];
  if (!token?.intent_name || !token.intent_href || !token.intent_search_hash) return null;

  const { rows: identityRows } = await q.query<IdentityDbRow>(
    `UPDATE intervu.identities
     SET email_verified_at = COALESCE(email_verified_at, now())
     WHERE id = $1
     RETURNING id, email, email_verified_at, contact_token`,
    [token.identity_id],
  );
  const identity = identityRows[0];
  if (!identity) return null;

  return {
    identityId: identity.id,
    email: identity.email,
    redirectPath: token.redirect_path,
    contactToken: identity.contact_token,
    name: token.intent_name,
    href: token.intent_href,
    searchHash: token.intent_search_hash,
    distinctId: token.intent_distinct_id,
    analytics: token.intent_analytics,
  };
}

export async function upsertEmailSavedSearch(
  q: Queryable,
  input: { identityId: string; searchHash: string; name: string; href: string },
): Promise<void> {
  await q.query(
    `INSERT INTO intervu.email_saved_searches (identity_id, search_hash, name, href)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (identity_id, search_hash)
     DO UPDATE SET unsubscribed_at = NULL, name = EXCLUDED.name, href = EXCLUDED.href`,
    [input.identityId, input.searchHash, input.name, input.href],
  );
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

/** Read-only: does this identity follow the company right now (a row not unsubscribed)? */
export async function isEmailFollowing(q: Queryable, identityId: string, companyDomain: string): Promise<boolean> {
  const { rows } = await q.query(
    `SELECT 1 FROM intervu.email_follows
     WHERE identity_id = $1 AND company_domain = $2 AND unsubscribed_at IS NULL`,
    [identityId, companyDomain]
  );
  return rows.length > 0;
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

export interface EmailDigestRecipient {
  identityId: string;
  email: string;
  follows: Array<{ domain: string; displayName: string }>;
  savedSearches: Array<{ name: string; href: string; searchHash: string }>;
}

export async function listEmailDigestRecipients(q: Queryable): Promise<EmailDigestRecipient[]> {
  const { rows } = await q.query<{
    identity_id: string;
    email: string;
    company_domain: string | null;
    display_name: string | null;
    search_hash: string | null;
    search_name: string | null;
    search_href: string | null;
  }>(
    `SELECT i.id AS identity_id, i.email,
            f.company_domain, f.display_name,
            s.search_hash, s.name AS search_name, s.href AS search_href
     FROM intervu.identities i
     LEFT JOIN intervu.email_follows f
       ON f.identity_id = i.id AND f.unsubscribed_at IS NULL
     LEFT JOIN intervu.email_saved_searches s
       ON s.identity_id = i.id AND s.unsubscribed_at IS NULL
     WHERE i.email_verified_at IS NOT NULL
       AND (f.identity_id IS NOT NULL OR s.identity_id IS NOT NULL)
     ORDER BY i.id`,
    [],
  );

  const byIdentity = new Map<string, EmailDigestRecipient>();
  for (const row of rows) {
    let entry = byIdentity.get(row.identity_id);
    if (!entry) {
      entry = { identityId: row.identity_id, email: row.email, follows: [], savedSearches: [] };
      byIdentity.set(row.identity_id, entry);
    }
    if (row.company_domain && row.display_name) {
      const exists = entry.follows.some((f) => f.domain === row.company_domain);
      if (!exists) {
        entry.follows.push({ domain: row.company_domain, displayName: row.display_name });
      }
    }
    if (row.search_hash && row.search_name && row.search_href) {
      const exists = entry.savedSearches.some((s) => s.searchHash === row.search_hash);
      if (!exists) {
        entry.savedSearches.push({
          name: row.search_name,
          href: row.search_href,
          searchHash: row.search_hash,
        });
      }
    }
  }
  return [...byIdentity.values()];
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
