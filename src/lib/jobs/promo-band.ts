/**
 * The list column carries AT MOST ONE promo band, above the results header and never between rows
 * (Vivek, 2026-10-22). Every band declares its eligibility here; the first eligible one in priority order
 * wins, so a new band joins the list below and the one-band rule holds by construction.
 */
export const PROMO_BAND_PRIORITY = ["cold-orientation", "extension"] as const;
export type PromoBandId = (typeof PROMO_BAND_PRIORITY)[number];

export function pickPromoBand(eligible: Record<PromoBandId, boolean>): PromoBandId | null {
    return PROMO_BAND_PRIORITY.find((id) => eligible[id]) ?? null;
}
