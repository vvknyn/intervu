/**
 * Shared box heights for the jobs toolbar filter row and the docked TopBar
 * search assembly — one token per row so controls cannot drift independently.
 */

/** Filter-row controls: the control scale's `md` step (32px, rulebook "Chips
 * h-8") at every width — the 44px touch target is the coarse-pointer hit area
 * `.ctl-md` adds (globals.css), never a taller visual. */
export const toolbarControlHeight = "ctl-md";

/** Peers of the Filters control on the toolbar row. */
export const toolbarChipClass =
    `inline-flex box-border items-center justify-center whitespace-nowrap ${toolbarControlHeight} px-3 text-xs lg:px-2`;

/** Docked header search form + its trailing CTA peer. */
export const topbarDockedSearchHeight = "ctl-md";
