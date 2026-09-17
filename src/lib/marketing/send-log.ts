/**
 * The idempotent send log — `intervu.marketing_sends`
 * (deploy/supabase/identity-schema.sql:92-109), same box Postgres the
 * search-alert identity store uses (`getIntervuPg`, src/lib/pg/pool.ts).
 * Primary key is `(campaign, user_id)`.
 *
 * Claim-before-send: `claimMarketingSend` inserts the row BEFORE the email
 * goes out, so a crash between "transport.send() returned" and "row
 * recorded" can't happen — the row is already there. If the send then
 * fails, `releaseMarketingSend` deletes the claim so a re-run tries that
 * user again. A missed send (claimed, then the process dies before
 * release or a retry) is the acceptable failure; a duplicate send to a
 * real inbox is not.
 */
import type { Queryable } from "@/lib/pg/pool";

export interface MarketingSendClaim {
  campaign: string;
  userId: string;
  email: string;
}

/** Every user_id this campaign has already reached (claimed) — the
 *  "already sent" half of `selectCampaignRecipients`'s exclusion set. */
export async function listSentUserIds(q: Queryable, campaign: string): Promise<Set<string>> {
  const { rows } = await q.query<{ user_id: string }>(
    `SELECT user_id FROM intervu.marketing_sends WHERE campaign = $1`,
    [campaign],
  );
  return new Set(rows.map((row) => row.user_id));
}

/** Claims the (campaign, user_id) row before the send is attempted.
 *  `ON CONFLICT DO NOTHING ... RETURNING user_id`: true iff this call
 *  inserted the row (i.e. no one else has claimed this recipient for this
 *  campaign yet) — a concurrent or retried claim for the same recipient
 *  returns false rather than erroring or double-sending. */
export async function claimMarketingSend(q: Queryable, claim: MarketingSendClaim): Promise<boolean> {
  const { rows } = await q.query<{ user_id: string }>(
    `INSERT INTO intervu.marketing_sends (campaign, user_id, email)
     VALUES ($1, $2, $3)
     ON CONFLICT (campaign, user_id) DO NOTHING
     RETURNING user_id`,
    [claim.campaign, claim.userId, claim.email],
  );
  return rows.length > 0;
}

/** Releases a claim whose send failed, so a re-run treats that recipient
 *  as not-yet-sent again instead of permanently skipping them. */
export async function releaseMarketingSend(q: Queryable, claim: Pick<MarketingSendClaim, "campaign" | "userId">): Promise<void> {
  await q.query(`DELETE FROM intervu.marketing_sends WHERE campaign = $1 AND user_id = $2`, [
    claim.campaign,
    claim.userId,
  ]);
}
