import { cn } from "@/lib/utils";

interface PageLayoutProps {
  children: React.ReactNode;
  header?: React.ReactNode;
  sidebar?: React.ReactNode;
  fullWidth?: boolean;
  className?: string;
  /**
   * Classes for the SHELL (the element wrapping `header` + `main`), for pages
   * that pin themselves to the viewport instead of letting the document
   * scroll. `className` can't do this job: it lands on `main`, which sits
   * BELOW `header` and so cannot know how tall `header` is. A page that tried
   * anyway — by giving `main` a `calc(100dvh - <nav>)` height — double-counted
   * its own chrome and pushed the document past the viewport by exactly the
   * header's height. Constrain the shell, then let `main` flex into whatever
   * is left (`min-h-0 flex-1`); the header can then grow or wrap freely
   * without anyone re-deriving a magic number.
   */
  shellClassName?: string;
}

export function PageLayout({ children, header, sidebar, fullWidth, className, shellClassName }: PageLayoutProps) {
  return (
    <div className={cn("min-h-screen bg-background flex flex-col", shellClassName)}>
      {header}
      <main className={cn(
        "flex-1",
        !fullWidth && "max-w-5xl mx-auto w-full px-4 sm:px-6 py-6",
        className
      )}>
        {sidebar ? (
          <div className="flex flex-col xl:flex-row gap-6">
            <div className="flex-1 min-w-0">{children}</div>
            <aside className="w-full xl:w-80 xl:shrink-0 xl:sticky xl:top-20 xl:self-start">
              {sidebar}
            </aside>
          </div>
        ) : children}
      </main>
    </div>
  );
}
