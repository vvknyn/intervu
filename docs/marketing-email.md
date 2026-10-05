# Marketing / product-update emails

Ready to hook up. Nothing sends until someone runs the script with `--live`
under the double-lock below — no cron, no route, no schedule is wired.

New: `content/marketing/*.md` campaigns, `src/lib/marketing/*`,
`scripts/send-marketing-update.ts`, `intervu.marketing_sends` (send log,
`deploy/supabase/identity-schema.sql`), the `marketing_update` `EmailKind`.
Reused as-is: `sendEmail`/Resend, Firestore `email_suppressions`, the
generic `/unsubscribe` route + HMAC token, WorkOS `listIntervuUsers`.

## Env vars

- `MAIL_TRANSPORT` — `dry-run` (default), `resend` or `smtp`.
- `MARKETING_SEND_ENABLED=1` — second half of the live-send lock; `--live`
  alone refuses without it.
- `MARKETING_SENDER_NAME`, `MARKETING_SENDER_POSTAL_ADDRESS` — optional
  footer identity, printed above "Why you got this" when set and left out
  (no placeholder) when not. Vivek chose to send the October 2026 update
  without them. No `.env.example` exists in this repo; these are documented
  here instead.
- `MARKETING_REPLY_TO` — the inbox replies go to. Resend's sending domain
  has no inbox, so a reply to the From address bounces; a `--live` Resend run
  refuses without it. Optional with `MAIL_TRANSPORT=smtp`.
- `MAIL_TRANSPORT=smtp` sends through an SMTP server instead of Resend (see
  "Sending from Proton Mail"): `SMTP_USER`, `SMTP_PASS`, `MARKETING_FROM`
  are required; `SMTP_HOST`/`SMTP_PORT` default to Proton Mail Bridge on the
  same machine (`127.0.0.1:1025`); `SMTP_SECURE=1` (or port 465) for TLS
  from the first byte, otherwise STARTTLS is required.
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

## Sending from Proton Mail

Vivek asked (2026-10-05) for the October update to come from his Proton
address. Proton has no sending API for a personal address; Proton Mail
Bridge (paid Proton plans) signs in to Proton on a computer and gives it a
local SMTP server, so the send runs on the laptop where Bridge runs.

1. Bridge installed and signed in. Its account page shows the SMTP
   settings: host `127.0.0.1`, port `1025`, a username (the address) and a
   password Bridge made (not the Proton password).
2. In the repo checkout: `npm ci` (nodemailer is a dev dependency).
3. The run needs production values, set only for that one command: the
   site's `ENCRYPTION_KEY` (a different key makes every unsubscribe link
   fail), `WORKOS_API_KEY`, `INTERVU_PG_URL` (send log) and the Firebase
   admin credentials (`FIREBASE_SERVICE_ACCOUNT_KEY`, or
   `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`, for the unsubscribe
   list). They live in the web box's env file; read just those keys over
   SSH rather than copying the file. If the database only answers from the
   box, tunnel it (`ssh -N -L 15432:<db host>:<port> root@<web box>`) and
   point `INTERVU_PG_URL` at `127.0.0.1:15432`.
4. Test copy to one of Vivek's own Velai account addresses, then the list:

```
export MAIL_TRANSPORT=smtp SMTP_USER=<address> SMTP_PASS=<bridge password> \
  MARKETING_FROM="Vivek from Velai <address>" NEXT_PUBLIC_SITE_URL=https://velai.app
MARKETING_SEND_ENABLED=1 npx tsx scripts/send-marketing-update.ts \
  --campaign=2026-10-whats-new --live --to=<his Velai account address>
MARKETING_SEND_ENABLED=1 npx tsx scripts/send-marketing-update.ts \
  --campaign=2026-10-whats-new --live --only=<reviewed list>
```

The script signs in to Bridge before it reads any recipient, so a wrong
password stops it with nobody claimed. Sends are spaced 2 s apart. Bridge's
own certificate is accepted only when the server is on the same machine.

## Writing a campaign

Front matter takes `subject` and `preheader`; `{{firstName}}` works in all
three parts. The body is markdown, plus:

- A picture: `![what it shows](/blog/<post>/<file>.png)`, kept under
  `public/`. It shows full width (536px), so export at 1072px wide. The alt
  text is what someone with pictures off reads.
- The button: a paragraph that is only `[Label](/path "button")`.
- Site paths (`/jobs`, `/blog/...`) become full velai.app links.
- A line break inside a paragraph: end the line with `\`.
