import type { Metadata } from "next";
import Link from "next/link";
import { BLOG_POSTS, blogPostPath, formatBlogDate } from "@/lib/blog/posts";
import { canonicalMetadata } from "@/lib/seo/page-metadata";
import { PageTitle, SectionTitle } from "@/components/ui/heading";
import { PageContainer } from "@/components/layout/PageContainer";

const TITLE = "Velai blog";
const DESCRIPTION = "What changed in Velai and why, written for the people who use it.";

const canonical = canonicalMetadata("/blog", TITLE, DESCRIPTION);
// The site's own preview picture (src/app/opengraph-image.tsx): a page that
// sets openGraph no longer inherits it from the root.
const SITE_PREVIEW_IMAGE = { url: "/opengraph-image", width: 1200, height: 630 };

export const metadata: Metadata = {
  description: DESCRIPTION,
  ...canonical,
  openGraph: { ...canonical.openGraph, images: [SITE_PREVIEW_IMAGE] },
  twitter: { ...canonical.twitter, images: [SITE_PREVIEW_IMAGE] },
};

export default function BlogIndexPage() {
  return (
    <PageContainer measure="reading" data-testid="blog-index" className="py-10">
      <PageTitle>Blog</PageTitle>
      <p className="mt-1.5 text-base text-muted-foreground">{DESCRIPTION}</p>

      <ol className="mt-8 divide-y divide-border border-y border-border">
        {BLOG_POSTS.map((post) => (
          <li key={post.slug} className="py-5">
            <time dateTime={post.datePublished} className="text-xs text-muted-foreground">
              {formatBlogDate(post.datePublished)}
            </time>
            <SectionTitle className="mt-1">
              <Link href={blogPostPath(post.slug)} className="hover:underline" data-testid="blog-post-link">
                {post.title}
              </Link>
            </SectionTitle>
            <p className="mt-1 text-sm text-muted-foreground">{post.description}</p>
          </li>
        ))}
      </ol>
    </PageContainer>
  );
}
