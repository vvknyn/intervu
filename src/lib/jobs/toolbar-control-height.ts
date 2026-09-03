/**
 * Shared box heights for the jobs toolbar filter row and the docked TopBar
 * search assembly — one token per row so controls cannot drift independently.
 */

/** Filter-row controls: 44px tap target on mobile, chip density at lg+. */
export const toolbarControlHeight = "h-11 lg:h-7";

/** Peers of the Filters control on the toolbar row. */
export const toolbarChipClass =
    `inline-flex box-border items-center justify-center whitespace-nowrap ${toolbarControlHeight} px-3 text-xs rounded-none lg:px-2`;

/** Sort segmented groups on the toolbar row. */
export const toolbarSegmentGroupClass =
    `flex box-border items-center rounded-none border border-border bg-muted p-px ${toolbarControlHeight}`;

/** Docked header search form + its trailing CTA peer. */
export const topbarDockedSearchHeight = "h-10";
