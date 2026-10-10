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
    id,
    checked,
    onChange,
    disabled,
    "aria-label": ariaLabel,
}: {
    /** For a visible `<label htmlFor>` beside it: a click on the words flips it too. */
    id?: string;
    checked: boolean;
    onChange: () => void;
    disabled?: boolean;
    "aria-label"?: string;
}) {
    return (
        <button
            id={id}
            type="button"
            onClick={onChange}
            disabled={disabled}
            role="switch"
            aria-checked={checked}
            aria-label={ariaLabel}
            aria-busy={disabled || undefined}
            className={`relative ctl-sm inline-flex w-11 shrink-0 cursor-pointer items-center rounded-ctl border border-border-strong shadow-[var(--shadow-bevel-inset)] transition-colors focus-visible:outline-2 focus-visible:outline-live focus-visible:-outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "bg-live text-brand-foreground" : "bg-surface-2"}`}
        >
            <span
                className={`absolute left-0.5 inline-block h-4 w-4 rounded-ctl border border-border bg-surface-3 shadow-[var(--shadow-bevel-highlight)] transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`}
            />
        </button>
    );
}
