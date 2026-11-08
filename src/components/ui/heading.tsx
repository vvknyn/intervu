import { cn } from "@/lib/utils";
import { READING_MEASURE } from "@/components/ui/prose";

// The ONE heading scale (docs/design-language.md §3), four looks and no others:
// page title `text-2xl`, section heading `text-xl`, sub-heading `text-base`
// (all semibold/snug/foreground and balanced, so a two-line title never strands
// one word), and the group label: 12px semibold in the secondary colour, which
// names a group of rows or fields the way a grouped list's header does.
// Every <h1> is a PageTitle; these components own their size, so a call site
// passes spacing/layout classes (and a status colour) only.
// tests/unit/page-scale.test.ts fails an <h1> (or one of these) that writes its
// own size, and an h2–h6 off the scale; journey J-NAV-50 reads the rendered looks.
const PAGE = "text-2xl font-semibold leading-snug text-foreground text-balance";
const SECTION = "text-xl font-semibold leading-snug text-foreground text-balance";
const SUB = "text-base font-semibold leading-snug text-foreground text-balance";
const LABEL = "text-xs font-semibold text-muted-foreground";

type HeadingTag = "h2" | "h3" | "h4" | "h5" | "h6";

export function PageTitle({ className, ...props }: React.ComponentProps<"h1">) {
  return <h1 className={cn(PAGE, className)} {...props} />;
}

/** The small line above a PageTitle ("Legal", "Pricing", "Blog · date"). It
 *  owns the gap to the title, so every eyebrowed masthead has the same rhythm. */
export function PageEyebrow({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("mb-3", LABEL, className)} {...props} />;
}

/** The subtitle paragraph under a PageTitle: holds the reading measure instead of the container's width. */
export function PageLead({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("mt-1.5 text-base text-muted-foreground", READING_MEASURE, className)} {...props} />;
}

export function SectionTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 className={cn(SECTION, className)} {...props} />;
}

/** A heading inside a section, a card, a pane, a sheet or a step. `as` keeps the document outline. */
export function SubTitle({ as: Tag = "h3", className, ...props }: React.ComponentProps<"h3"> & { as?: HeadingTag }) {
  return <Tag className={cn(SUB, className)} {...props} />;
}

/** The group label: names the rows or fields under it ("Summary", "Status", a tracker column).
 *  The eyebrow's look, as a heading. */
export function GroupLabel({ as: Tag = "h3", className, ...props }: React.ComponentProps<"h3"> & { as?: HeadingTag }) {
  return <Tag className={cn(LABEL, className)} {...props} />;
}
