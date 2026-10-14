/**
 * The founder writes on the blog under a humble pen name, with a drawn
 * picture rather than a photo, so the site never carries their real name
 * without making up a fake employee. `/blog/is-velai-legit` says so plainly
 * under "Who runs it".
 */
export const BLOG_AUTHOR = {
    name: "Alex",
    role: "founder of Velai",
    byline: "By Alex, founder of Velai",
    avatar: "/blog/author.svg",
    avatarAlt: "Drawn portrait of Alex",
} as const;

export const BLOG_BYLINE = BLOG_AUTHOR.byline;
