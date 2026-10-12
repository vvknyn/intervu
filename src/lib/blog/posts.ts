/**
 * Velai's blog: product updates written for the people who use it. Each post
 * is a module next to this one (markdown body plus the facts a page and a
 * sitemap need), registered in `BLOG_POSTS`, newest first.
 *
 * Posts live in code rather than `content/` because the site ships as a
 * Next standalone build: a file read at request time would find nothing
 * there, while an import is bundled with the page.
 *
 * Pictures sit under `public/blog/<slug>/`. Each one is listed in the post's
 * `images` with its pixel size, so the page reserves its space before it
 * loads and the text below never jumps.
 */
import MarkdownIt from "markdown-it";
import { IS_VELAI_LEGIT } from "./is-velai-legit";
import { SAME_RESUME_TEST_OCTOBER_2026 } from "./same-resume-test-october-2026";
import { WHATS_NEW_OCTOBER_2026 } from "./whats-new-october-2026";

export interface BlogImage {
    /** Intrinsic size in pixels (2x screenshots, shown at half). */
    width: number;
    height: number;
}

export interface BlogPost {
    slug: string;
    /** The page's heading. */
    title: string;
    /**
     * The title search results and link previews show, when it should name
     * what people search for and the heading doesn't. Under 60 characters
     * with " · Velai" added, so search results don't cut it off.
     */
    searchTitle?: string;
    /** One or two sentences for the index, search results and link previews; under 160 characters so search results show all of it. */
    description: string;
    /** YYYY-MM-DD. */
    datePublished: string;
    /** Markdown. Pictures use site paths (`/blog/<slug>/x.png`) listed in `images`. */
    body: string;
    images: Record<string, BlogImage>;
    /** The picture a link preview shows; one of `images`. */
    cover: string;
}

export const BLOG_POSTS: readonly BlogPost[] = [IS_VELAI_LEGIT, SAME_RESUME_TEST_OCTOBER_2026, WHATS_NEW_OCTOBER_2026];

export const BLOG_PATH = "/blog";

/**
 * Every post is signed by the team, and search engines are told the author is
 * Velai itself: the site names no person who works on it (2026-10-11).
 */
export const BLOG_BYLINE = "By the Velai team";

export function blogPostPath(slug: string): string {
    return `${BLOG_PATH}/${slug}`;
}

export function getBlogPost(slug: string): BlogPost | null {
    return BLOG_POSTS.find((post) => post.slug === slug) ?? null;
}

/** The title for search results and link previews. */
export function blogSearchTitle(post: BlogPost): string {
    return post.searchTitle ?? post.title;
}

/** The cover's alt text, taken from where the body shows it, so a link preview describes the same picture. */
export function blogCoverAlt(post: BlogPost): string | undefined {
    for (const m of post.body.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)) {
        if (m[2] === post.cover) return m[1];
    }
    return undefined;
}

/** "October 5, 2026", the date as written, never shifted by the reader's or server's timezone. */
export function formatBlogDate(isoDay: string): string {
    const [y, m, d] = isoDay.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
    });
}

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });

interface RenderEnv {
    images: Record<string, BlogImage>;
}

md.renderer.rules.image = (tokens, idx, _options, env: RenderEnv) => {
    const token = tokens[idx];
    const src = token.attrGet("src") ?? "";
    const alt = md.utils.escapeHtml(token.children?.map((t) => t.content).join("") ?? token.content);
    const size = env.images[src];
    if (!size) throw new Error(`blog picture ${src} has no size in the post's images`);
    return `<img src="${md.utils.escapeHtml(src)}" alt="${alt}" width="${size.width / 2}" height="${size.height / 2}" loading="lazy" decoding="async" class="blog-figure" />`;
};

/** A paragraph holding only a picture renders as the picture, not a <p> around it. */
md.core.ruler.push("blog_figure", (state) => {
    for (let i = 0; i < state.tokens.length; i++) {
        const inline = state.tokens[i + 1];
        if (
            state.tokens[i].type === "paragraph_open" &&
            inline?.type === "inline" &&
            inline.children?.length === 1 &&
            inline.children[0].type === "image"
        ) {
            state.tokens[i].hidden = true;
            state.tokens[i + 2].hidden = true;
        }
    }
});

/** The post's body as HTML. Throws on a picture missing from `images`, so a typo fails the build, not the reader. */
export function renderBlogPost(post: BlogPost): string {
    return md.render(post.body, { images: post.images } satisfies RenderEnv);
}
