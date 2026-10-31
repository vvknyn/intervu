import { PageContainer } from "@/components/layout/PageContainer";
import { PageLead, PageTitle } from "@/components/ui/heading";

/**
 * The ONE page masthead: title, lead line and actions, the same on every
 * page. There used to be two (a sticky "compact" bar and a "display" title),
 * so the title jumped 24px between Tracker and Tracker › History and between
 * Stories and Résumé. Its top edge is `--page-top` below the header
 * (globals.css), the same gap a Prose page (About, Privacy) leaves above its
 * title; tests/e2e/journeys/page-frame.spec.ts measures both on every route.
 */
interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Secondary/auxiliary controls, visually separated from `actions` by a
   *  rule (e.g. an account control next to a primary CTA). Optional — most
   *  pages only need `actions`. */
  rightRail?: React.ReactNode;
  children?: React.ReactNode;
  /** Render just the title row, without the page container or the page-top
   *  gap — for a page that already sits in its own `.shell-row page-top`
   *  column (Settings, Trends). */
  bare?: boolean;
}

export function PageHeader({ title, description, actions, rightRail, children, bare = false }: PageHeaderProps) {
  const trailing = rightRail ? (
    <div className="flex shrink-0 items-center gap-3">
      {actions}
      {actions && <span aria-hidden="true" className="h-4 w-px bg-border" />}
      {rightRail}
    </div>
  ) : (
    actions
  );

  const row = (
    <div className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-end md:justify-between md:gap-3">
      <div className="min-w-0">
        <PageTitle>{title}</PageTitle>
        {description && <PageLead>{description}</PageLead>}
      </div>
      {trailing ? <div className="flex shrink-0 flex-wrap items-center gap-2 md:ml-auto">{trailing}</div> : null}
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
    <div className="bg-background">
      <PageContainer className="page-top pb-4">
        {row}
        {children && <div className="pt-4">{children}</div>}
      </PageContainer>
    </div>
  );
}
