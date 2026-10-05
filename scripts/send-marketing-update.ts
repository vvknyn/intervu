#!/usr/bin/env node
/**
 * Sends (or, by default, dry-run PREVIEWS) a one-off marketing/product-update
 * campaign to every registered velai user who hasn't already gotten it and
 * hasn't opted out.
 *
 *   # Preview — renders every eligible recipient's email to
 *   # tmp/marketing-preview/<hash>.html|.txt. No network send, no DB write.
 *   npx tsx scripts/send-marketing-update.ts --campaign=2026-09-updates
 *   npx tsx scripts/send-marketing-update.ts --campaign=2026-09-updates --limit=3
 *
 *   # Test-send to one real, registered address (still no MARKETING_SEND_ENABLED
 *   # needed for this — --to alone does not unlock --live; see below).
 *   npx tsx scripts/send-marketing-update.ts --campaign=2026-09-updates --to=you@example.com
 *
 *   # Actually send. Double-locked: needs BOTH the --live flag AND
 *   # MARKETING_SEND_ENABLED=1 in the environment, AND MAIL_TRANSPORT=resend
 *   # (checked against the transport createTransport() actually built, so
 *   # this can't drift from that module's own default-is-dry-run rule).
 *   MARKETING_SEND_ENABLED=1 MAIL_TRANSPORT=resend \
 *     npx tsx scripts/send-marketing-update.ts --campaign=2026-09-updates --live
 *
 *   # Only the addresses someone reviewed: one per line, nothing else on the
 *   # line (a CSV row is refused). Still minus suppressed/sent/unverified.
 *   ... --only=tmp/whats-new-recipients.txt
 *
 * A live send also needs MARKETING_SENDER_NAME, MARKETING_SENDER_POSTAL_ADDRESS
 * (the footer CASL and CAN-SPAM require) and MARKETING_REPLY_TO (the sending
 * domain has no inbox, so a reply to the From address bounces).
 *
 * Dry run renders through the exact same `renderCampaign` path (and, when
 * --to is given, the exact same recipient-selection code) a live send would
 * use — see `DryRunTransport` (src/lib/marketing/transport.ts) — so a
 * preview can't silently drift from what a real send would produce.
 *
 * Recipient universe: every WorkOS user tagged for this app, minus
 * minted/unreachable addresses, minus anyone suppressed for
 * "marketing_update" (Firestore `email_suppressions`), minus addresses
 * WorkOS says were never verified, minus anyone
 * `intervu.marketing_sends` already has a row for THIS campaign — see
 * `selectCampaignRecipients` (src/lib/marketing/recipients.ts), the pure
 * decision this script just supplies I/O for.
 *
 * User enumeration deliberately goes through the raw-fetch WorkOS client
 * (`@/lib/auth/workos-sync`), NOT `listIntervuUsers`/`getWorkosUserManagement`
 * (src/lib/auth/workos-runtime.ts) — that path dynamically imports
 * `@workos-inc/authkit-nextjs`, which itself imports the `server-only`
 * marker package and throws when loaded outside Next's server runtime (a
 * plain `tsx scripts/*.ts` process is not one). `scripts/audit-workos-users.ts`
 * hit the same constraint and solved it the same way; this reuses that
 * client and the same `hasApp(metadata.apps, APP_INTERVU)` filter
 * `listIntervuUsers` applies, so the two enumerations can't drift on WHO
 * counts as an intervu user, only on transport.
 *
 * Loads .env.local the same way scripts/audit-workos-users.ts does (dotenv
 * is already a dependency) — real env vars set on the box always win, dotenv
 * only fills in what's missing.
 */
import { config } from "dotenv";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@/lib/auth/workos-sync";
import { hasApp, APP_INTERVU } from "@/lib/auth/workos-apps";
import { toServerUser, type WorkosIdentity } from "@/lib/auth/workos-identity";
import { isReachableEmail } from "@/lib/auth/username-email";
import { isSuppressed } from "@/lib/email/suppression";
import { signUnsubscribeToken } from "@/lib/email/unsubscribe-token";
import { normalizeEmail } from "@/lib/email/normalize-email";
import { getSiteUrl } from "@/lib/seo/constants";
import { getIntervuPg } from "@/lib/pg/pool";
import { loadCampaign, renderCampaign, type CampaignSender } from "@/lib/marketing/campaign";
import { createTransport, DryRunTransport, ResendMarketingTransport } from "@/lib/marketing/transport";
import { listSentUserIds, claimMarketingSend, releaseMarketingSend } from "@/lib/marketing/send-log";
import { deliverOne } from "@/lib/marketing/deliver";
import { parseOnlyList, selectCampaignRecipients, type CampaignCandidate } from "@/lib/marketing/recipients";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: `${ROOT}/.env.local`, quiet: true });

function argValue(flag: string): string | undefined {
  const arg = process.argv.find((a) => a === flag || a.startsWith(`${flag}=`));
  if (!arg) return undefined;
  const eq = arg.indexOf("=");
  return eq === -1 ? "" : arg.slice(eq + 1);
}

function hashEmail(email: string): string {
  return createHash("sha256").update(normalizeEmail(email)).digest("hex").slice(0, 12);
}

/** Raw WorkOS user shape (REST API, snake_case) — just enough fields to
 *  build a `CampaignCandidate`, reusing `hasApp`'s app-tag filter and
 *  `toServerUser`'s uid rule via a small camelCase adapter. */
interface WorkosRestUser {
  id: string;
  external_id?: string | null;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email_verified?: boolean | null;
  metadata?: Record<string, string> | null;
  profile_picture_url?: string | null;
}

/** Every WorkOS user tagged for this app, auto-paginated — same filter
 *  `listIntervuUsers` (src/lib/auth/workos-runtime.ts) applies, over the
 *  raw-fetch client instead of the SDK (see this file's header comment). */
async function listIntervuCandidates(apiKey: string): Promise<CampaignCandidate[]> {
  const client = createClient(apiKey);
  const users: WorkosRestUser[] = [];
  let after: string | undefined;
  do {
    const res = await client.request(`/user_management/users?limit=100${after ? `&after=${after}` : ""}`);
    if (!res.ok) throw new Error(`WorkOS list users failed: ${res.status} ${JSON.stringify(res.body)}`);
    users.push(...(res.body.data ?? []));
    after = res.body.list_metadata?.after || undefined;
  } while (after);

  return users
    .filter((u) => hasApp(u.metadata?.apps, APP_INTERVU))
    .map((u): CampaignCandidate => {
      const identity: WorkosIdentity = {
        id: u.id,
        externalId: u.external_id,
        email: u.email,
        firstName: u.first_name,
        lastName: u.last_name,
        metadata: u.metadata,
        profilePictureUrl: u.profile_picture_url,
      };
      const server = toServerUser(identity);
      return {
        userId: server.uid,
        email: server.email ?? "",
        firstName: u.first_name ?? null,
        emailVerified: u.email_verified ?? undefined,
      };
    })
    .filter((candidate) => isReachableEmail(candidate.email));
}

// Fixed floor between live sends rather than a batch sleep, so 5/s holds
// even when an individual send is slow.
const MIN_LIVE_INTERVAL_MS = 200;

async function main() {
  const campaignName = argValue("--campaign");
  const live = process.argv.includes("--live");
  const limitArg = argValue("--limit");
  const limit = limitArg === undefined ? undefined : Number(limitArg);
  const toArg = argValue("--to");
  const toFilter = toArg ? normalizeEmail(toArg) : undefined;
  const onlyArg = argValue("--only");
  const onlyEmails = onlyArg ? parseOnlyList(readFileSync(resolve(onlyArg), "utf8")) : undefined;

  if (!campaignName) {
    console.error(
      "Usage: npx tsx scripts/send-marketing-update.ts --campaign=<name> [--live] [--limit=N] [--to=<email>] [--only=<file>]",
    );
    process.exit(1);
  }
  if (limitArg !== undefined && (!Number.isFinite(limit) || (limit as number) <= 0)) {
    console.error(`--limit must be a positive integer, got "${limitArg}"`);
    process.exit(1);
  }

  // The live double-lock. No default, no lying fallback: an unset/blank
  // MARKETING_SEND_ENABLED refuses outright, it does not silently degrade
  // to a dry run while claiming --live was honored.
  if (live && process.env.MARKETING_SEND_ENABLED !== "1") {
    throw new Error("--live requires MARKETING_SEND_ENABLED=1 in the environment. Refusing to send.");
  }

  const campaign = loadCampaign(campaignName);

  const sender: CampaignSender = {
    name: process.env.MARKETING_SENDER_NAME ?? null,
    postalAddress: process.env.MARKETING_SENDER_POSTAL_ADDRESS ?? null,
  };
  if (live && (!sender.name || !sender.postalAddress)) {
    // A live send with no visible sender identity is a CAN-SPAM violation,
    // not a degraded-but-OK send — fail loudly instead of rendering the
    // "[sender name not configured]" placeholder into a real outbound email.
    throw new Error(
      "MARKETING_SENDER_NAME and MARKETING_SENDER_POSTAL_ADDRESS must both be set in the environment for a --live send.",
    );
  }

  // The sending domain has no inbox: without a Reply-To, a reply bounces.
  const replyTo = process.env.MARKETING_REPLY_TO?.trim() || undefined;
  if (live && !replyTo) {
    throw new Error("MARKETING_REPLY_TO must be set for a --live send; replies to the sending address bounce.");
  }

  // Built before any WorkOS/Firestore I/O so a misconfigured --live fails
  // fast. Checked against the transport createTransport() actually
  // produced (not a re-parse of MAIL_TRANSPORT) so this can't drift from
  // that module's own default-is-dry-run rule.
  const transport = live ? createTransport(process.env) : new DryRunTransport();
  if (live && !(transport instanceof ResendMarketingTransport)) {
    throw new Error(
      `--live requires MAIL_TRANSPORT=resend (got "${process.env.MAIL_TRANSPORT || "unset"}", which resolves to a non-sending transport). Refusing to send.`,
    );
  }

  const workosApiKey = process.env.WORKOS_API_KEY;
  if (!workosApiKey) throw new Error("WORKOS_API_KEY is not set — cannot enumerate recipients.");
  const candidates = await listIntervuCandidates(workosApiKey);

  const pg = getIntervuPg();
  if (live && !pg) {
    throw new Error("INTERVU_PG_URL is not set — cannot record sends idempotently for a --live run. Refusing to send.");
  }
  const alreadySentUserIds = pg ? await listSentUserIds(pg, campaignName) : new Set<string>();

  const suppressionResults = await Promise.all(
    candidates.map(async (c) => ((await isSuppressed(c.email, "marketing_update")) ? normalizeEmail(c.email) : null)),
  );
  const suppressedEmails = new Set(suppressionResults.filter((e): e is string => e !== null));

  let recipients = selectCampaignRecipients(candidates, { suppressedEmails, alreadySentUserIds, onlyEmails });
  if (toFilter) {
    recipients = recipients.filter((r) => normalizeEmail(r.email) === toFilter);
    if (recipients.length === 0) {
      // No fabricated synthetic recipient — --to must name a real, eligible,
      // already-resolved candidate, or this is a loud failure.
      throw new Error(`--to=${toArg} does not match a registered, eligible recipient for campaign "${campaignName}".`);
    }
  }
  if (limit) recipients = recipients.slice(0, limit);

  console.log(
    `[marketing] campaign=${campaignName} mode=${live ? "LIVE" : "dry-run"} ` +
      `candidates=${candidates.length} already_sent=${alreadySentUserIds.size} ` +
      `suppressed=${suppressedEmails.size} unverified=${candidates.filter((c) => c.emailVerified === false).length} ` +
      `only=${onlyEmails ? onlyEmails.size : "all"} selected=${recipients.length}`,
  );

  const siteUrl = getSiteUrl();
  let sent = 0;
  let skipped = 0;

  for (const recipient of recipients) {
    const started = Date.now();
    const token = signUnsubscribeToken(recipient.email, "marketing_update");
    if (!token) {
      console.error(`[marketing] hash=${hashEmail(recipient.email)} skipped: no ENCRYPTION_KEY, cannot sign unsubscribe token`);
      skipped++;
      continue;
    }
    const unsubscribeUrl = `${siteUrl}/unsubscribe?token=${encodeURIComponent(token)}`;
    const rendered = renderCampaign(
      campaign,
      { email: recipient.email, firstName: recipient.firstName, unsubscribeUrl },
      sender,
      siteUrl,
    );

    let sendResult: { id: string } | undefined;
    try {
      const outcome = await deliverOne({
        // Claim BEFORE send: the row exists before the email goes out, so
        // a crash after a real send can't leave the log unaware of it.
        // Dry-run has no pg row to claim/release — no-ops, unchanged
        // dry-run behavior (writes only under tmp/).
        claim: live
          ? () => claimMarketingSend(pg!, { campaign: campaignName, userId: recipient.userId, email: recipient.email })
          : async () => true,
        send: async () => {
          sendResult = await transport.send({
            to: recipient.email,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            unsubscribeUrl,
            replyTo,
          });
        },
        release: live
          ? () => releaseMarketingSend(pg!, { campaign: campaignName, userId: recipient.userId })
          : async () => undefined,
        log: (message) => console.error(`[marketing] hash=${hashEmail(recipient.email)} ${message}`),
      });

      if (outcome === "already-sent") {
        skipped++;
      } else {
        console.log(`[marketing] hash=${hashEmail(recipient.email)} id=${sendResult?.id} ok`);
        sent++;
      }
    } catch (err) {
      console.error(`[marketing] hash=${hashEmail(recipient.email)} FAILED:`, err instanceof Error ? err.message : err);
      skipped++;
    }

    if (live) {
      const elapsed = Date.now() - started;
      if (elapsed < MIN_LIVE_INTERVAL_MS) await new Promise((r) => setTimeout(r, MIN_LIVE_INTERVAL_MS - elapsed));
    }
  }

  console.log(`[marketing] done. sent=${sent} skipped=${skipped} mode=${live ? "LIVE" : "dry-run"}`);
  if (!live) console.log("[marketing] preview files under tmp/marketing-preview/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
