import { cn } from "@/lib/utils";

// The ONE heading scale (docs/design-language.md §3): page title `text-2xl`,
// section heading `text-xl`, sub-heading `text-base`, all semibold/snug and
// balanced (a two-line title never strands one word).
// Every <h1> is a PageTitle; these components own their size, so a call site
// passes spacing/layout classes only. tests/unit/page-scale.test.ts fails an
// <h1> (or one of these) that writes its own size, and an h2–h6 off the scale.
const PAGE = "text-2xl font-semibold leading-snug text-foreground text-balance";
const SECTION = "text-xl font-semibold leading-snug text-foreground text-balance";
const SUB = "text-base font-semibold leading-snug text-foreground text-balance";

export function PageTitle({ className, ...props }: React.ComponentProps<"h1">) {
  return <h1 className={cn(PAGE, className)} {...props} />;
}

export function SectionTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 className={cn(SECTION, className)} {...props} />;
}

export function SubTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return <h3 className={cn(SUB, className)} {...props} />;
}
