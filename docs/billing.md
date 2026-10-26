# Stripe billing: prepaid months

One price per 30-day month, `MONTH_PRICE_USD` in `src/app/pricing/offer.ts`. A customer buys 1-12 months in a single one-time Checkout payment (`POST /api/billing/checkout {months}`); there is no subscription, trial or auto-renew. Access = `access_until` on `profiles/{uid}`, recomputed from the customer's paid Checkout Sessions plus the dated `grants[]` (`src/lib/billing/access.ts`).

## Env (server-only; all three required, else checkout and the webhook answer 503)

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Restricted key preferred (`rk_...`). |
| `STRIPE_WEBHOOK_SECRET` | Signing secret (`whsec_...`) of the endpoint below. |
| `STRIPE_PRICE_ID` | The one-time Price at `MONTH_PRICE_USD`. The client never sends a price. |

## Stripe Dashboard

1. Create a one-time Price at `MONTH_PRICE_USD` on the Velai product; put its id in `STRIPE_PRICE_ID`.
2. Webhook endpoint `https://<host>/api/webhooks/stripe`, events (exactly these, tested against `RECOMPUTE_EVENT_TYPES`): `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`, `charge.dispute.closed`.
3. Local: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.

## How access is computed

`access_until` is recomputed from Stripe (the customer's completed payment-mode Checkout Sessions, refunds and lost disputes netted out, in `recompute.ts`) and folded with `grants[]` in one date-ordered pass, never incremented, so replayed or reordered events give the same answer. Months are counted from every paid line item on the Velai Stripe product, whatever price it was sold at; a price on another product counts 0. Triggers: the four webhook events, the `/billing/return` page, and `grantDays()`, which appends a grant; `scripts/grant-access-days.ts` documents how to run it in the container.

## Changing the price

Checkout refuses (503) unless `STRIPE_PRICE_ID`'s `unit_amount` equals `MONTH_PRICE_USD`. Create the new Price on the SAME Velai product (so past purchases keep counting), then update `MONTH_PRICE_USD` and `STRIPE_PRICE_ID` together in one deploy.

## Résumé retention

| Variable | Purpose |
| --- | --- |
| `RESUME_RETENTION_CRON_SECRET` | Bearer for `POST /api/retention/resumes`; unset, the route answers 503. |
| `ORPHAN_ACCOUNTS_CRON_SECRET` | Bearer for `POST /api/ops/orphan-accounts` (report only); unset, the route answers 503. |

`deploy/run-resume-retention.sh` is a DRY RUN unless given `--apply`. It is not scheduled by the repo; install an HOURLY cron at go-live (the site promises deletion within an hour after paid time ends).

The rule (numbers in `src/lib/retention/rules.ts`): one warning email in the 7 days before `access_until`; the saved résumé is deleted once `access_until` has passed, whether or not the email went out. Just before deleting, the run recomputes access from Stripe and re-reads the profile, so a renewal the webhook has not delivered yet keeps the résumé; if the recompute fails, nothing is deleted and the run counts an error. An account that never had access gets a first-seen stamp, which is its end.

Go-live order: run the launch grant with `--apply` BEFORE the first retention `--apply`. Otherwise never-paid accounts with a stored résumé are deleted on the first run after the stamp. Read a dry-run's counts first.
