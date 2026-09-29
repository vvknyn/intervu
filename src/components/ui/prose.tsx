import { cn } from "@/lib/utils";

// The ONE long-form article wrapper (About, legal, research, SEO hubs).
// `prose-sm` is what the Typography plugin's list/heading spacing is tuned
// against; globals.css binds its colours to tokens and lifts p/li to the
// 16/22 body size. <SectionTitle> / <SubTitle> inside get their spacing here,
// so a page carries no per-page heading-margin constant.
export function Prose({ className, ...props }: React.ComponentProps<"article">) {
  return (
    <article
      className={cn(
        "prose prose-sm max-w-none dark:prose-invert [&_h2]:mb-3 [&_h2]:mt-8 [&_h3]:mb-3 [&_h3]:mt-8", // page-scale-allow: the Prose primitive itself
        className,
      )}
      {...props}
    />
  );
}
