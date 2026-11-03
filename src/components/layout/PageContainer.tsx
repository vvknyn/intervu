import { cn } from "@/lib/utils";

/**
 * The ONE page container: the `.shell-row` geometry the TopBar and Footer
 * already use (globals.css: `--shell-max` 72rem → 80rem / 1280px at xl;
 * `--shell-gutter` 16 / 32 / 40px), so a page's left edge is the header
 * logo's left edge on every route, /jobs included.
 *
 * `measure="reading"` narrows the CONTENT to a readable line length (48rem)
 * but keeps it on the shell's left edge — centring a narrow column inside the
 * shell is what put /about's text at x=360 under a logo at x=120.
 * tests/unit/page-scale.test.ts fails a hand-rolled `mx-auto max-w-* px-*`;
 * tests/e2e/journeys/page-frame.spec.ts measures the rendered edges.
 */
const MEASURE = { wide: undefined, reading: "max-w-3xl" } as const;

interface PageContainerProps extends React.ComponentProps<"div"> {
  measure?: keyof typeof MEASURE;
}

export function PageContainer({ measure = "wide", className, ...props }: PageContainerProps) {
  return (
    <div className="shell-row">
      <div className={cn(MEASURE[measure], className)} {...props} />
    </div>
  );
}

/**
 * The open résumé editor's canvas (Settings › Résumé and /resume): `.shell-row`
 * from lg up, and `.shell-canvas` (globals.css) drops the cap and the gutter
 * below lg so the editor gets the whole phone. One string for both pages.
 */
export const EDITOR_CANVAS_FRAME =
  "shell-row shell-canvas pb-[calc(var(--mobile-tabbar-h)+env(safe-area-inset-bottom,0px))] lg:pb-6";
