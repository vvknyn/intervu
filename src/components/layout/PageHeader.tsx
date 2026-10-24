import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageTitle } from "@/components/ui/heading";

interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Secondary/auxiliary controls, visually separated from `actions` by a
   *  rule (e.g. an account control next to a primary CTA). Optional — most
   *  pages only need `actions`. */
  rightRail?: React.ReactNode;
  children?: React.ReactNode;
  sticky?: boolean;
  /** Bleeds to the wide `max-w-[1440px]` rail `PageLayout`'s own `fullWidth`
   *  uses, instead of the boxed default padding. */
  fullWidth?: boolean;
  /** "compact" (default, unchanged) is the existing utility bar: small
   *  title, sticky, fixed height — used by Settings/Admin/Resume tailor.
   *  "display" is the product pages' masthead: large display title + mono
   *  subline, a calm rule instead of a shadow — Tracker/Stories/Prep/Resume. */
  size?: "compact" | "display";
  /** Skip the outer chrome/padding/background entirely and render just the
   *  title row — for embedding inline inside a page's own content column
   *  (e.g. Prep's landing view, which isn't rendered through `PageLayout`'s
   *  `header` slot at all). */
  bare?: boolean;
}

export function PageHeader({
  title,
  description,
  actions,
  rightRail,
  children,
  sticky = true,
  fullWidth = false,
  size = "compact",
  bare = false,
}: PageHeaderProps) {
  const display = size === "display";

  const titleBlock = (
    <div className="min-w-0">
      <PageTitle className={display ? undefined : "truncate"}>{title}</PageTitle>
      {description &&
        (display ? (
          <div className="mt-1.5 text-meta text-muted-foreground">{description}</div>
        ) : (
          <p className="text-sm text-muted-foreground">{description}</p>
        ))}
    </div>
  );

  // Kept as bare `actions` when there's no rightRail so legacy callers (who
  // only ever pass `actions`) get byte-identical markup to before this slot
  // existed — no extra wrapper div, no new gap value.
  const trailing = rightRail ? (
    <div className="flex shrink-0 items-center gap-3">
      {actions}
      {actions && <span aria-hidden="true" className="h-4 w-px bg-border" />}
      {rightRail}
    </div>
  ) : (
    actions
  );

  // The display row's own vertical rhythm (pt-8 pb-4) belongs to the chrome
  // wrapper, not the row itself — `bare` embeds this row inside a page's own
  // spacing (e.g. Prep's landing view), so it must carry none of its own.
  const row = display ? (
    <div className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-end md:justify-between md:gap-3">
      {titleBlock}
      {trailing ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 md:ml-auto">{trailing}</div>
      ) : null}
    </div>
  ) : (
    <div className="flex min-h-16 items-center justify-between py-2">
      {titleBlock}
      {trailing && <div className="ml-4 flex shrink-0 items-center gap-2">{trailing}</div>}
    </div>
  );

  if (bare) {
    return (
      <div>
        {row}
        {children}
      </div>
    );
  }

  return (
    <div
      className={cn(
        sticky ? "sticky top-0 z-50 material-bar" : "bg-background",
      )}
    >
      <PageContainer>
        <div className={display ? "pb-4 pt-8" : undefined}>{row}</div>
        {children && <div className="pb-4">{children}</div>}
      </PageContainer>
    </div>
  );
}
