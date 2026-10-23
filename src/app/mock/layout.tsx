import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { robotsMetadataFor } from "@/lib/seo/indexability";

export const metadata: Metadata = robotsMetadataFor("/mock");

/**
 * /mock/* are design fixtures (lockup, completeness, auth-gate, …) for
 * comparing surfaces during design passes. They are not product pages and
 * must not be reachable on production. Set MOCK_ROUTES_ENABLED=1 to show
 * them on a production build for a demo.
 */
export default function MockLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === "production" && process.env.MOCK_ROUTES_ENABLED !== "1") {
    notFound();
  }
  return children;
}
