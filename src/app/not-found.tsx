import Link from "next/link";
import { BrandMark } from "@/components/brand/BrandMark";

/**
 * Branded, dark-aware 404. Renders inside the root layout/app shell, so it
 * inherits the design tokens from globals.css.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">
        <BrandMark className="h-7 w-7" />
      </div>
      <span className="mt-4 font-display text-[13px] font-extrabold tracking-tight text-muted-foreground">
        intervu
      </span>
      <p className="mt-3 text-xs uppercase tracking-[0.08em] text-brand">404</p>
      <h1 className="mt-1 font-display text-2xl font-extrabold tracking-[-0.02em] text-foreground">
        Page not found
      </h1>
      <p className="mt-2 max-w-md text-text-2">
        That page doesn&apos;t exist, or it moved. Let&apos;s get you back on track.
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
