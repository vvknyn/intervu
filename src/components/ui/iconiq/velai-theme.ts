/**
 * Remap Iconiq embedded --ic-* / --color-* tokens onto Velai’s Swiss-Klein
 * palette so registry components stay calm navy instead of Iconiq’s sky brand.
 * Apply via className on Iconiq roots used inside Velai product surfaces.
 */
export const ICONIQ_VELAI_THEME =
  "[--ic-background:rgb(var(--background))] [--ic-foreground:rgb(var(--foreground))] [--ic-primary:rgb(var(--foreground))] [--ic-secondary:rgb(var(--muted-foreground))] [--ic-surface-border:rgb(var(--border))] [--ic-border:rgb(var(--border))] [--ic-card:rgb(var(--card))] [--ic-card-foreground:rgb(var(--card-foreground))] [--ic-muted:rgb(var(--muted))] [--ic-muted-foreground:rgb(var(--muted-foreground))] [--ic-accent:rgb(var(--muted))] [--ic-accent-foreground:rgb(var(--foreground))] [--ic-input:rgb(var(--border))] [--ic-ring:rgb(var(--brand)/0.28)] [--ic-paper:rgb(var(--background))] [--ic-popover-foreground:rgb(var(--foreground))] [--ic-brand:rgb(var(--brand))] [--ic-brand-soft:rgb(var(--brand-tint-bg))] [--ic-shadow-soft:0_18px_38px_-24px_rgb(var(--brand)/0.18)] [--color-background:var(--ic-background)] [--color-foreground:var(--ic-foreground)] [--color-primary:var(--ic-primary)] [--color-secondary:var(--ic-secondary)] [--color-border:var(--ic-border)] [--color-card:var(--ic-card)] [--color-card-foreground:var(--ic-card-foreground)] [--color-muted:var(--ic-muted)] [--color-muted-foreground:var(--ic-muted-foreground)] [--color-accent:var(--ic-accent)] [--color-accent-foreground:var(--ic-accent-foreground)] [--color-input:var(--ic-input)] [--color-ring:var(--ic-ring)] [--color-paper:var(--ic-paper)] [--color-brand:var(--ic-brand)] [--color-brand-soft:var(--ic-brand-soft)]";

/** Prefer Velai panel radius over Iconiq’s default 12px / squircle. */
export const ICONIQ_VELAI_PANEL =
  "rounded-panel supports-[corner-shape:squircle]:rounded-panel";
