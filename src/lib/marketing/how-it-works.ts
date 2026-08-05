export type HowItWorksFilmId = "mcp" | "claw";

export const HOW_IT_WORKS_FILMS: Record<
    HowItWorksFilmId,
    { src: string; poster: string; title: string; subtitle: string }
> = {
    mcp: {
        src: "/marketing/how-it-works/video-a-mcp.mp4",
        poster: "/marketing/how-it-works/poster-a-mcp.png",
        title: "Claude / ChatGPT",
        subtitle: "Paste the connector · approve once · ask for real jobs",
    },
    claw: {
        src: "/marketing/how-it-works/video-b-openclaw.mp4",
        poster: "/marketing/how-it-works/poster-b-openclaw.png",
        title: "OpenClaw",
        subtitle: "Install · approve · wake up to drafts you submit",
    },
};
