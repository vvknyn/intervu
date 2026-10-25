"use client"

import { Switch as SwitchPrimitive } from "radix-ui"

/**
 * The one toggle switch (WAI-ARIA switch pattern) on the Radix primitive.
 * Track/thumb use `rounded-ctl` (every control, §1), which renders as a full
 * stadium/circle here since the 12px token radius exceeds half of both the h-6
 * track and the h-4 thumb. `onChange` is a bare toggle: callers hold the state.
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
        <SwitchPrimitive.Root
            id={id}
            checked={checked}
            onCheckedChange={() => onChange()}
            disabled={disabled}
            aria-label={ariaLabel}
            aria-busy={disabled || undefined}
            className="relative ctl-sm inline-flex w-11 shrink-0 cursor-pointer items-center rounded-ctl border border-border-strong bg-surface-2 text-brand-foreground shadow-[var(--shadow-bevel-inset)] transition-colors focus-visible:outline-2 focus-visible:outline-live focus-visible:-outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-live"
        >
            <SwitchPrimitive.Thumb className="absolute left-0.5 inline-block h-4 w-4 translate-x-0 rounded-ctl border border-border bg-surface-3 shadow-[var(--shadow-bevel-highlight)] transition-transform data-[state=checked]:translate-x-5" />
        </SwitchPrimitive.Root>
    )
}
