import Link from "next/link";
import { SectionTitle } from "@/components/ui/heading";
import { relatedPagesFor } from "@/lib/seo/related-pages";

/**
 * "Keep reading": the pages a reader with the same question opens next, from the
 * site's link graph (lib/seo/related-pages.ts). Same shape as a blog post's
 * "More from the blog" list, so the two read as one pattern. Renders nothing for
 * a page the graph does not list.
 */
export function RelatedLinks({ path }: { path: string }) {
  const pages = relatedPagesFor(path);
  if (pages.length === 0) return null;
  return (
    <nav aria-labelledby="related-pages-heading" data-testid="related-pages" className="mt-12 border-t border-border pt-6">
      <SectionTitle id="related-pages-heading">Keep reading</SectionTitle>
      <ul className="mt-3 space-y-3">
        {pages.map((page) => (
          <li key={page.href}>
            <Link href={page.href} className="font-semibold name-link">
              {page.label}
            </Link>
            <p className="mt-0.5 text-xs text-muted-foreground">{page.blurb}</p>
          </li>
        ))}
      </ul>
    </nav>
  );
}
