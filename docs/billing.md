# Stripe billing: prepaid months, and month to month

One price per month, `MONTH_PRICE_USD` in `src/app/pricing/offer.ts`. Two ways to pay, both on the one Velai Stripe product:

- **Prepaid months** (always): 1-12 months in a single one-time Checkout payment (`POST /api/billing/checkout {months}`); never renews.
- **Month to month** (optional, opt-in): a Checkout subscription at a recurring monthly Price (`POST /api/billing/checkout {autoRenew: true}`); renews until cancelled. Hidden on `/pricing` until `STRIPE_SUBSCRIPTION_PRICE_ID` is set.

Access = `access_until` on `profiles/{uid}`, recomputed from the customer's paid Checkout Sessions and paid subscription invoices plus the dated `grants[]` (`src/lib/billing/access.ts`). `auto_renew` on the same profile says whether a subscription is live; the end of a live subscription carries `RENEWAL_GRACE_MS` of slack so paid features don't lapse while the next charge settles (every date shown takes it back out with `paidThrough`). Both fields are written only by the recompute. The profile store goes through `getAdminDb()`, so it follows `DATA_STORE=postgres` with no separate path.

## Env (server-only; the first three are required, else checkout and the webhook answer 503)

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Restricted key preferred (`rk_...`). Needs read on Charges, Checkout Sessions, Customers, PaymentIntents, Prices and Disputes, and write on Checkout Sessions, Customers and Customer portal sessions. Month to month also needs read on Invoices and Subscriptions: while `STRIPE_SUBSCRIPTION_PRICE_ID` is unset a refusal of those two is logged (`[billing] ... not readable by this Stripe key`) and counted as none; once it is set a refusal fails the read like any other. A failed checkout start (answered 503 "Checkout is unavailable right now"), Payments read, portal start, webhook recompute or return-page recompute logs `describeStripeError` (class, status, Stripe's message with keys and ids blanked), which names the missing permission. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret (`whsec_...`) of the endpoint below. |
| `STRIPE_PRICE_ID` | The one-time Price at `MONTH_PRICE_USD`. The client never sends a price. |
| `STRIPE_SUBSCRIPTION_PRICE_ID` | Optional. A recurring Price at `MONTH_PRICE_USD`, every 1 month, on the same product. Unset, month to month is off. |

## Stripe Dashboard

1. Create a one-time Price at `MONTH_PRICE_USD` on the Velai product; put its id in `STRIPE_PRICE_ID`.
2. For month to month, create a recurring Price on the SAME product (monthly, `MONTH_PRICE_USD`) and put its id in `STRIPE_SUBSCRIPTION_PRICE_ID`. Checkout refuses (503) unless it is exactly that amount, currency and a one-month interval.
3. Webhook endpoint `https://<host>/api/webhooks/stripe`, events (exactly these, tested against `RECOMPUTE_EVENT_TYPES`): `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`, `charge.dispute.closed`, `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`.
4. Activate the Customer portal (Settings › Billing › Customer portal) in live mode: allow updating payment methods, cancelling subscriptions and viewing invoice history. `POST /api/billing/portal` answers 503 until it is on.
5. Local: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.

## How access is computed

`access_until` is recomputed from Stripe and folded with `grants[]` in one date-ordered pass, never incremented, so replayed or reordered events give the same answer. Prepaid months come from the customer's completed payment-mode Checkout Sessions; month to month from paid subscription invoices, each counted for the service period Stripe billed (`period.start` to `period.end`) so back-to-back renewals leave no gap. Refunds and lost disputes are netted out of both. Months are counted from every paid line item on the Velai Stripe product, whatever price it was sold at; a price on another product counts 0. Triggers: the seven webhook events, the `/billing/return` page, and `grantDays()`, which appends a grant; `scripts/grant-access-days.ts` documents how to run it in the container.

## What the account sees

Settings › Account › Payments (`fetchBillingAction`) lists every payment on the product, newest first, with a Stripe receipt link and any refund, and says where month to month stands (renewing, cancelled and running to a date, or the last charge failed). "Manage billing" opens Stripe's Customer portal (card, cancel, invoices). All of it is read live from Stripe; nothing about payments is stored on Velai beyond `stripe_customer_id`, `access_until` and `auto_renew`.

## Changing the price

Checkout refuses (503) unless each Price's `unit_amount` equals `MONTH_PRICE_USD`. Create the new Prices on the SAME Velai product (so past purchases keep counting), then update `MONTH_PRICE_USD`, `STRIPE_PRICE_ID` and `STRIPE_SUBSCRIPTION_PRICE_ID` together in one deploy. Existing subscribers stay on the old recurring Price until moved in Stripe.

## Résumé retention

| Variable | Purpose |
| --- | --- |
| `RESUME_RETENTION_CRON_SECRET` | Bearer for `POST /api/retention/resumes`; unset, the route answers 503. |
| `ORPHAN_ACCOUNTS_CRON_SECRET` | Bearer for `POST /api/ops/orphan-accounts` (report only); unset, the route answers 503. |

`deploy/run-resume-retention.sh` is a DRY RUN unless given `--apply`. It is not scheduled by the repo; install the daily cron at go-live.

Go-live order: run the launch grant with `--apply` BEFORE the first retention `--apply`. Otherwise never-paid accounts with a stored résumé hit the 90-day deadline immediately. Read a dry-run's counts first.
