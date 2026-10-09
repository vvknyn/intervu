import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BLOG_PATH,
  BLOG_POSTS,
  blogCoverAlt,
  blogPostPath,
  blogSearchTitle,
  formatBlogDate,
  getBlogPost,
  renderBlogPost,
} from "@/lib/blog/posts";
import { buildArticleJsonLd, buildBreadcrumbJsonLd, serializeJsonLd } from "@/lib/seo/jsonld";
import { canonicalMetadata } from "@/lib/seo/page-metadata";
import { getSiteUrl } from "@/lib/seo/constants";
import { Prose } from "@/components/ui/prose";
import { PageTitle, SectionTitle } from "@/components/ui/heading";
import { PageContainer } from "@/components/layout/PageContainer";

// Every post is known at build time; any other slug is a 404, never a render.
export const dynamicParams = false;

export function generateStaticParams() {
  return BLOG_POSTS.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const post = getBlogPost((await params).slug);
  if (!post) return {};
  const title = blogSearchTitle(post);
  const canonical = canonicalMetadata(blogPostPath(post.slug), title, post.description);
  const cover = post.images[post.cover];
  const coverUrl = `${getSiteUrl()}${post.cover}`;
  const coverAlt = blogCoverAlt(post);
  return {
    title,
    description: post.description,
    authors: [{ name: post.author.name }],
    ...canonical,
    openGraph: {
      ...canonical.openGraph,
      type: "article",
      publishedTime: post.datePublished,
      authors: [post.author.name],
      images: [{ url: coverUrl, width: cover?.width, height: cover?.height, alt: coverAlt }],
    },
    twitter: { ...canonical.twitter, images: [{ url: coverUrl, alt: coverAlt }] },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const post = getBlogPost((await params).slug);
  if (!post) notFound();

  const path = blogPostPath(post.slug);
  const articleJsonLd = buildArticleJsonLd({
    headline: post.title,
    datePublished: post.datePublished,
    description: post.description,
    path,
    image: post.cover,
    author: { name: post.author.name, jobTitle: post.author.role },
  });
  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: "Blog", path: BLOG_PATH },
    { name: post.title, path },
  ]);
  const morePosts = BLOG_POSTS.filter((other) => other.slug !== post.slug).slice(0, 3);

  return (
    <PageContainer measure="reading" data-testid="blog-post" className="py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(articleJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }} />
      <p className="text-xs font-semibold text-muted-foreground">
        <Link href={BLOG_PATH} className="hover:text-foreground">
          Blog
        </Link>
        {" · "}
        <time dateTime={post.datePublished}>{formatBlogDate(post.datePublished)}</time>
      </p>
      <PageTitle className="mt-3">{post.title}</PageTitle>
      <p className="mt-1.5 text-sm text-muted-foreground">
        By {post.author.name}, {post.author.role}
      </p>

      <Prose
        className="mt-6 [&_.blog-figure]:my-6 [&_.blog-figure]:h-auto [&_.blog-figure]:w-full [&_.blog-figure]:rounded-xl [&_.blog-figure]:border [&_.blog-figure]:border-border"
        dangerouslySetInnerHTML={{ __html: renderBlogPost(post) }}
      />

      {morePosts.length > 0 && (
        <nav aria-labelledby="blog-more-heading" data-testid="blog-more" className="mt-12 border-t border-border pt-6">
          <SectionTitle id="blog-more-heading">More from the blog</SectionTitle>
          <ul className="mt-3 space-y-3">
            {morePosts.map((other) => (
              <li key={other.slug}>
                <Link href={blogPostPath(other.slug)} className="font-medium hover:underline">
                  {other.title}
                </Link>
                <time dateTime={other.datePublished} className="mt-0.5 block text-xs text-muted-foreground">
                  {formatBlogDate(other.datePublished)}
                </time>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </PageContainer>
  );
}
