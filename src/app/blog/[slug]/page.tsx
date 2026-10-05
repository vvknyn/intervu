import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BLOG_PATH, BLOG_POSTS, blogPostPath, formatBlogDate, getBlogPost, renderBlogPost } from "@/lib/blog/posts";
import { buildArticleJsonLd, serializeJsonLd } from "@/lib/seo/jsonld";
import { canonicalMetadata } from "@/lib/seo/page-metadata";
import { getSiteUrl } from "@/lib/seo/constants";
import { Prose } from "@/components/ui/prose";
import { PageTitle } from "@/components/ui/heading";
import { PageContainer } from "@/components/layout/PageContainer";

// Every post is known at build time; any other slug is a 404, never a render.
export const dynamicParams = false;

export function generateStaticParams() {
  return BLOG_POSTS.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const post = getBlogPost((await params).slug);
  if (!post) return {};
  const canonical = canonicalMetadata(blogPostPath(post.slug), post.title, post.description);
  const cover = post.images[post.cover];
  return {
    title: post.title,
    description: post.description,
    ...canonical,
    openGraph: {
      ...canonical.openGraph,
      type: "article",
      publishedTime: post.datePublished,
      images: [{ url: `${getSiteUrl()}${post.cover}`, width: cover?.width, height: cover?.height }],
    },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const post = getBlogPost((await params).slug);
  if (!post) notFound();

  const articleJsonLd = buildArticleJsonLd({
    headline: post.title,
    datePublished: post.datePublished,
    description: post.description,
    path: blogPostPath(post.slug),
  });

  return (
    <PageContainer measure="reading" data-testid="blog-post" className="py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(articleJsonLd) }} />
      <p className="text-xs font-semibold text-muted-foreground">
        <Link href={BLOG_PATH} className="hover:text-foreground">
          Blog
        </Link>
        {" · "}
        <time dateTime={post.datePublished}>{formatBlogDate(post.datePublished)}</time>
      </p>
      <PageTitle className="mt-3">{post.title}</PageTitle>
      <p className="mt-1.5 text-sm text-muted-foreground">By {post.author}</p>

      <Prose
        className="mt-6 [&_.blog-figure]:my-6 [&_.blog-figure]:h-auto [&_.blog-figure]:w-full [&_.blog-figure]:rounded-xl [&_.blog-figure]:border [&_.blog-figure]:border-border"
        dangerouslySetInnerHTML={{ __html: renderBlogPost(post) }}
      />
    </PageContainer>
  );
}
