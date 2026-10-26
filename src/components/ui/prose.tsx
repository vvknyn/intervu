import { cn } from "@/lib/utils";

// The ONE long-form article wrapper (About, legal, research, SEO hubs).
// `prose-sm` is what the Typography plugin's list/heading spacing is tuned
// against; globals.css binds its colours to tokens and lifts p/li to
// 16px / 1.625. <SectionTitle> / <SubTitle> inside get their spacing here,
// so a page carries no per-page heading-margin constant.
/** The ONE reading column: 28rem ~ 66 characters of 16px body text. A rem width,
 *  not ch: ch resolves against the container's font (Prose is prose-sm, 14px),
 *  so one ch token rendered two widths. */
export const READING_MEASURE = "max-w-[28rem]";

/** The measure of a job description, a document read inside a pane: 52rem ~ 105
 *  characters of 16px text, LinkedIn's line length. Wider than READING_MEASURE
 *  (an article column) because the pane is the measure; the pane's own width
 *  caps it on narrower screens. */
export const DOCUMENT_MEASURE = "max-w-[52rem]";

export function Prose({ className, ...props }: React.ComponentProps<"article">) {
  return (
    <article
      className={cn(
        `prose prose-sm dark:prose-invert ${READING_MEASURE} [&_h2]:mb-3 [&_h2]:mt-12 [&_h3]:mb-3 [&_h3]:mt-8 [&_li]:my-2`, // page-scale-allow: the Prose primitive itself
        className,
      )}
      {...props}
    />
  );
}
