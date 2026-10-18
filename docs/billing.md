# Stripe billing (backend infrastructure)

This slice is **server infrastructure only**. There is no pricing page wired to it, and nothing in the UI reads subscription entitlement. Checkout (`POST /api/billing/checkout`) and Customer Portal (`POST /api/billing/portal`) exist for a future client; they return **503 not_configured** until the env vars below are set.

Entitlement on a profile is a raw boolean (`billing_entitled`), not a named plan or tier.

## Environment variables

All server-only — never commit values to git.

| Variable | Purpose |
|----------|---------|
| `STRIPE_SECRET_KEY` | Restricted API key (`rk_test_...`) preferred over `sk_`. Use sandbox/test until go-live. |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret (`whsec_...`). |
| `STRIPE_PRICE_IDS` | Comma-separated Price IDs from the Dashboard. The code does not assign names to them. |
| `STRIPE_CHECKOUT_SUCCESS_URL` | Absolute `https://` URL (or `http://localhost` / `http://127.0.0.1` for local). |
| `STRIPE_CHECKOUT_CANCEL_URL` | Same rules as success URL. |
| `STRIPE_PORTAL_RETURN_URL` | Return URL for the Customer Portal session. |

## Stripe Dashboard setup

1. **Products / Prices** — Create prices in the sandbox Dashboard and copy Price IDs into `STRIPE_PRICE_IDS`. Amounts and billing intervals are your product decision; this doc does not prescribe them.
2. **Webhooks** — Developers → Webhooks → add endpoint `https://<host>/api/webhooks/stripe` (local: use the Stripe CLI forwarder).
3. **Events to send** — `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`.
4. Copy the endpoint **signing secret** to `STRIPE_WEBHOOK_SECRET`.
5. **Customer portal** — Settings → Billing → Customer portal: enable the portal (required or portal session creation errors). Portal plan-change options are up to you.

## Local webhook testing

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Use the `whsec_...` value the CLI prints for `STRIPE_WEBHOOK_SECRET`. Keep live keys out of committed files; `.env.local` is gitignored.

## Profile fields (Firestore `profiles/{uid}`)

Written by the webhook handler (snake_case, merged into existing profile docs):

- `stripe_customer_id`
- `stripe_subscription_id`
- `stripe_subscription_status`
- `stripe_current_period_end` (Unix seconds)
- `billing_entitled` (boolean)
- `billing_updated_at` (ISO string)
- `billing_event_created` (Unix seconds of the last applied subscription lifecycle event; checkout and `invoice.payment_failed` do not move it)
- `stripe_last_payment_failed_at` (ISO string or null)

## Tax and checkout params

`automatic_tax` is **not** set on Checkout. Do not enable Stripe Tax collection until you have a tax registration; without one Stripe collects nothing and does not error.

Checkout sessions use `subscription_data.billing_mode: { type: "flexible" }` when supported by the installed Stripe SDK types.

## Out of scope for this slice

Dispute, refund, and early-fraud-warning webhook handling is not implemented here.
