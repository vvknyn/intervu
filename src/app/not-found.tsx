import Link from "next/link";

/**
 * Branded, dark-aware 404. Renders inside the root layout/app shell, so it
 * inherits the design tokens from globals.css.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">
        <svg viewBox="0 0 40 40" className="h-7 w-7" aria-hidden="true">
          <path
            d="M9 13 L19 28 L31 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="4.4"
            strokeLinecap="square"
            strokeLinejoin="miter"
          />
        </svg>
      </div>
      <p className="mt-6 text-sm font-medium tracking-wide text-brand">404</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
        Page not found
      </h1>
      <p className="mt-2 max-w-md text-text-2">
        The page you’re looking for doesn’t exist or may have moved.
      </p>
      <Link
        href="/"
        className="mt-8 rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground shadow-sm transition hover:opacity-90 focus-ring"
      >
        Back to home
      </Link>
    </div>
  );
}
