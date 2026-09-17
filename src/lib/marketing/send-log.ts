/**
 * The idempotent send log — `intervu.marketing_sends`
 * (deploy/db-box/intervu-schema.sql), same box Postgres the search-alert
 * identity store uses (`getIntervuPg`, src/lib/pg/pool.ts). Primary key is
 * `(campaign, user_id)`: re-running the send script for a campaign that
 * already reached a user is a no-op, not a duplicate send, without the
 * script having to track its own progress.
 */
import type { Queryable } from "@/lib/pg/pool";

export interface MarketingSendRecord {
  campaign: string;
  userId: string;
  email: string;
  messageId: string;
}

/** Every user_id this campaign has already reached — the "already sent"
 *  half of `selectCampaignRecipients`'s exclusion set. */
export async function listSentUserIds(q: Queryable, campaign: string): Promise<Set<string>> {
  const { rows } = await q.query<{ user_id: string }>(
    `SELECT user_id FROM intervu.marketing_sends WHERE campaign = $1`,
    [campaign],
  );
  return new Set(rows.map((row) => row.user_id));
}

/** `ON CONFLICT DO NOTHING` on the (campaign, user_id) primary key: a
 *  concurrent or retried run recording the same send again changes
 *  nothing, rather than erroring or double-counting. */
export async function recordMarketingSend(q: Queryable, record: MarketingSendRecord): Promise<void> {
  await q.query(
    `INSERT INTO intervu.marketing_sends (campaign, user_id, email, message_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (campaign, user_id) DO NOTHING`,
    [record.campaign, record.userId, record.email, record.messageId],
  );
}
