# Stripe billing: prepaid months

One price ($12 per 30-day month). A customer buys 1-12 months in a single one-time Checkout payment (`POST /api/billing/checkout {months}`); there is no subscription, trial or auto-renew. Access = `access_until` on `profiles/{uid}`, recomputed from the customer's paid Checkout Sessions plus the dated `grants[]` (`src/lib/billing/access.ts`).

## Env (server-only; all three required, else checkout and the webhook answer 503)

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Restricted key preferred (`rk_...`). |
| `STRIPE_WEBHOOK_SECRET` | Signing secret (`whsec_...`) of the endpoint below. |
| `STRIPE_PRICE_ID` | The one-time $12 Price. The client never sends a price. |

## Stripe Dashboard

1. Create a one-time $12 Price; put its id in `STRIPE_PRICE_ID`.
2. Webhook endpoint `https://<host>/api/webhooks/stripe`, events (exactly these, tested against `RECOMPUTE_EVENT_TYPES`): `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`, `charge.dispute.closed`.
3. Local: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.

## How access is computed

`access_until` is recomputed from Stripe (the customer's completed payment-mode Checkout Sessions, refunds and lost disputes netted out, in `recompute.ts`) and folded with `grants[]` in one date-ordered pass, never incremented, so replayed or reordered events give the same answer. Only line items at the $12 offer on the Velai product count (same check as checkout); a cheaper price on the same product grants nothing. Triggers: the four webhook events, the `/billing/return` page, and `grantDays()`, which appends a grant; `scripts/grant-access-days.ts` documents how to run it in the container.

## Résumé retention

| Variable | Purpose |
| --- | --- |
| `RESUME_RETENTION_CRON_SECRET` | Bearer for `POST /api/retention/resumes`; unset, the route answers 503. |

`deploy/run-resume-retention.sh` is a DRY RUN unless given `--apply`. It is not scheduled by the repo; install the daily cron at go-live.

Go-live order: run the launch grant with `--apply` BEFORE the first retention `--apply`. Otherwise never-paid accounts with a stored résumé hit the 90-day deadline immediately. Read a dry-run's counts first.
