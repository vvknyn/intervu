/**
 * The per-recipient claim → send → release decision, extracted out of
 * scripts/send-marketing-update.ts so it's unit-testable without a real
 * transport or a real Postgres connection.
 *
 * Claim-before-send: the caller's `claim` must run (and succeed) BEFORE
 * `send` — that's what makes a crash between "email sent" and "row
 * recorded" impossible: the row is already there by the time the send is
 * attempted. If `send` then throws, `release` undoes the claim so a
 * re-run tries that recipient again (a missed send is the acceptable
 * failure; a duplicate send is not).
 */
export type DeliverOutcome = "already-sent" | "sent";

export interface DeliverOneParams {
  /** Inserts this recipient's send-log row. Returns false if a row for
   *  this (campaign, user_id) already exists — send is never called. */
  claim: () => Promise<boolean>;
  /** Actually delivers the email. Only called after a successful claim. */
  send: () => Promise<void>;
  /** Deletes the claim made above. Only called (and only matters) when
   *  `send` throws. */
  release: () => Promise<void>;
  /** For logging a secondary failure (release itself throwing) without
   *  it displacing the send error that caused it. */
  log: (message: string) => void;
}

export async function deliverOne({ claim, send, release, log }: DeliverOneParams): Promise<DeliverOutcome> {
  const claimed = await claim();
  if (!claimed) return "already-sent";

  try {
    await send();
    return "sent";
  } catch (sendErr) {
    try {
      await release();
    } catch (releaseErr) {
      log(
        `release failed after send error: ${releaseErr instanceof Error ? releaseErr.message : String(releaseErr)}`,
      );
    }
    throw sendErr;
  }
}
