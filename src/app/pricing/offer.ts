/**
 * The paid month on /pricing: the one place its numbers live, so the page,
 * its metadata, the blog posts and the tests quote the same figures.
 */

export const MONTH_PRICE_USD = 6;
export const MIN_MONTHS = 1;
export const MAX_MONTHS = 12;
export const REFUND_DAYS = 14;

export const PRO_MONTHLY_PRICE = `$${MONTH_PRICE_USD}`;

export const MONTH_CHOICES: readonly number[] = Array.from({ length: MAX_MONTHS }, (_, i) => MIN_MONTHS + i);

export function monthsLabel(months: number): string {
  return months === 1 ? "1 month" : `${months} months`;
}

export function totalPrice(months: number): string {
  return `$${MONTH_PRICE_USD * months}`;
}

/** Calendar date in UTC so the server render and the browser agree. */
export function formatPaidUntil(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export const PRICING_DESCRIPTION = `Velai is free to search with. A paid month is ${PRO_MONTHLY_PRICE}, bought ${MIN_MONTHS} to ${MAX_MONTHS} months at a time with one payment, no auto-renew and a ${REFUND_DAYS}-day refund.`;
