# Stripe billing: prepaid months

One price ($12 per 30-day month). A customer buys 1-12 months in a single one-time Checkout payment (`POST /api/billing/checkout {months}`); there is no subscription, trial or auto-renew. Access = `max(paid_until, granted_until)` on `profiles/{uid}` (`src/lib/billing/access.ts`).

## Env (server-only; all three required, else checkout and the webhook answer 503)

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Restricted key preferred (`rk_...`). |
| `STRIPE_WEBHOOK_SECRET` | Signing secret (`whsec_...`) of the endpoint below. |
| `STRIPE_PRICE_ID` | The one-time $12 Price. The client never sends a price. |

## Stripe Dashboard

1. Create a one-time $12 Price; put its id in `STRIPE_PRICE_ID`.
2. Webhook endpoint `https://<host>/api/webhooks/stripe`, events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`.
3. Local: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.

## How access is computed

`paid_until` is recomputed from Stripe (the customer's completed payment-mode Checkout Sessions, refunds netted out, in `recompute.ts`), never incremented, so replayed or reordered events give the same answer. Triggers: the three webhook events, the `/billing/return` page, and `grantDays()`. `granted_until` is written only by `grantDays()`; `scripts/grant-access-days.ts` documents how to run it in the container.
