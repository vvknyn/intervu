import { cn } from "@/lib/utils";

// The ONE long-form article wrapper (About, legal, research, SEO hubs).
// `prose-sm` is what the Typography plugin's list/heading spacing is tuned
// against; globals.css binds its colours to tokens and lifts p/li to
// 16px / 1.625. <SectionTitle> / <SubTitle> inside get their spacing here,
// so a page carries no per-page heading-margin constant.
/** The ONE reading column (65ch, Tailwind max-w-prose). Prose, the page-header
 *  description and the standalone job description all take it, so a running
 *  paragraph never exceeds the comfortable ceiling whatever its container. */
export const READING_MEASURE = "max-w-[65ch]";

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
