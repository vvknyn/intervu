"use client";

/**
 * Settings' one toggle switch — replaces three near-identical hand-rolled
 * copies that had drifted into AgentPreferencesSection ("Remote only"),
 * EmailPreferencesSection and LocalAiSettingsSection. Track/thumb use
 * `rounded-ctl` (every control, §1) which renders as a full stadium/circle
 * here since the 12px token radius exceeds half of both the h-6 track and
 * the h-4 thumb. Position is set with standard-scale `translate-x-*` (no
 * arbitrary `[…]` values) rather than the old per-pixel `translate-x-[23px]`.
 */
export function Switch({
    checked,
    onChange,
    disabled,
    "aria-label": ariaLabel,
}: {
    checked: boolean;
    onChange: () => void;
    disabled?: boolean;
    "aria-label"?: string;
}) {
    return (
        <button
            type="button"
            onClick={onChange}
            disabled={disabled}
            role="switch"
            aria-checked={checked}
            aria-label={ariaLabel}
            aria-busy={disabled || undefined}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-ctl border border-border transition-colors focus-visible:outline-2 focus-visible:outline-brand focus-visible:-outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "bg-brand text-brand-foreground" : "bg-muted"}`}
        >
            <span
                className={`absolute left-0.5 inline-block h-4 w-4 rounded-ctl border border-border bg-card transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`}
            />
        </button>
    );
}
