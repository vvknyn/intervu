/**
 * Shared Input/Textarea/SelectTrigger treatment for the tracker's two sheets
 * (PursuitDetailSheet, TrackRoleSheet) — a muted, borderless field that only
 * gets a border on focus. Single source of truth: this constant used to be
 * duplicated verbatim in both files; one drifting out of sync from the other
 * is exactly the class of bug §2/§5 (design-language.md) rule out.
 */
export const TRACKER_FIELD_CLASS =
    "rounded-ctl border-transparent bg-muted focus-visible:border-border-strong focus-visible:bg-background";
