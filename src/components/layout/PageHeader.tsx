import { cn } from "@/lib/utils";

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
      <h1
        className={
          display
            ? "font-display text-2xl font-semibold"
            : "truncate text-lg font-semibold"
        }
      >
        {title}
      </h1>
      {description &&
        (display ? (
          <div className="mt-1.5 text-meta text-muted-foreground">{description}</div>
        ) : (
          <p className="truncate text-sm text-muted-foreground">{description}</p>
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
    <div className="flex flex-wrap items-end justify-between gap-3">
      {titleBlock}
      {trailing}
    </div>
  ) : (
    <div className="flex h-16 items-center justify-between">
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
        display ? "border-b border-border bg-background backdrop-saturate-180" : "bg-background backdrop-saturate-180 border-b border-border",
        sticky && "sticky top-0 z-50",
      )}
    >
      <div className="mx-auto max-w-6xl xl:max-w-7xl px-4 sm:px-8 xl:px-10">
        <div className={display ? "pb-4 pt-8" : undefined}>{row}</div>
        {children && <div className="pb-4">{children}</div>}
      </div>
    </div>
  );
}
