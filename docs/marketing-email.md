# Marketing / product-update emails

Ready to hook up. Nothing sends until someone runs the script with `--live`
under the double-lock below — no cron, no route, no schedule is wired.

New: `content/marketing/*.md` campaigns, `src/lib/marketing/*`,
`scripts/send-marketing-update.ts`, `intervu.marketing_sends` (send log,
`deploy/supabase/identity-schema.sql`), the `marketing_update` `EmailKind`.
Reused as-is: `sendEmail`/Resend, Firestore `email_suppressions`, the
generic `/unsubscribe` route + HMAC token, WorkOS `listIntervuUsers`.

## Env vars

- `MAIL_TRANSPORT` — `dry-run` (default) or `resend`.
- `MARKETING_SEND_ENABLED=1` — second half of the live-send lock; `--live`
  alone refuses without it.
- `MARKETING_SENDER_NAME`, `MARKETING_SENDER_POSTAL_ADDRESS` — CAN-SPAM
  footer identity. `--live` refuses if either is unset (no silent
  placeholder in a real send). No `.env.example` exists in this repo; these
  are documented here instead.
- `MARKETING_REPLY_TO` — the inbox replies go to. The sending domain has no
  inbox, so a reply to the From address bounces; `--live` refuses without it.
- Already-set, reused: `ENCRYPTION_KEY` (tokens), `RESEND_API_KEY` /
  `RESEND_FROM` (transport), `INTERVU_PG_URL` (send log, required for
  `--live`), `WORKOS_*` (recipient list).

## Commands

```
# Preview: renders every eligible recipient to tmp/marketing-preview/*.html|.txt
npx tsx scripts/send-marketing-update.ts --campaign=2026-09-updates

# Test-send to one real, registered address (still dry-run without --live)
npx tsx scripts/send-marketing-update.ts --campaign=2026-09-updates --to=you@example.com

# Go live
MARKETING_SEND_ENABLED=1 MAIL_TRANSPORT=resend \
  npx tsx scripts/send-marketing-update.ts --campaign=2026-09-updates --live
```

`--limit=N` caps sends per run. Idempotent: re-running a campaign skips
anyone `intervu.marketing_sends` already has a row for. Addresses WorkOS says
were never verified are always left out.

`--only=<file>` sends only to the addresses in a reviewed list: one address
per line, `#` for comments. A line with anything else on it (a CSV row, a
name) stops the run, so a spreadsheet with a "don't send" column can't be
passed by mistake.

## Writing a campaign

Front matter takes `subject` and `preheader`; `{{firstName}}` works in all
three parts. The body is markdown, plus:

- A picture: `![what it shows](/blog/<post>/<file>.png)`, kept under
  `public/`. It shows full width (536px), so export at 1072px wide. The alt
  text is what someone with pictures off reads.
- The button: a paragraph that is only `[Label](/path "button")`.
- Site paths (`/jobs`, `/blog/...`) become full velai.app links.
- A line break inside a paragraph: end the line with `\`.
