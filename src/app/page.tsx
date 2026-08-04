import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { WatchingWall } from "@/components/marketing/WatchingWall";
import { DawnGlow } from "@/components/marketing/DawnGlow";
import { WhatsAppThreadHero } from "@/components/marketing/WhatsAppThreadHero";
import { OpenclawStatusBadge } from "@/components/marketing/OpenclawStatusBadge";
import { OpenclawWaitlistForm } from "@/components/marketing/OpenclawWaitlistForm";
import { CopyCommand } from "@/components/marketing/CopyCommand";
import { FrontDoorNav } from "@/components/marketing/FrontDoorNav";
import { FooterContent } from "@/components/layout/Footer";
import { OPENCLAW_HEADLINE, OPENCLAW_SUBLINE, OPENCLAW_INSTALL_COMMAND } from "@/components/marketing/openclaw-content";
import { JOBS_VISITOR_COOKIE } from "@/lib/jobs-visitor-cookie";
import { SITE_URL } from "@/lib/seo/constants";

export const metadata: Metadata = {
    title: "Intervu — an overnight job-search agent",
    description: OPENCLAW_SUBLINE,
    alternates: {
        canonical: "/",
    },
    openGraph: {
        title: "Intervu — an overnight job-search agent",
        description: OPENCLAW_SUBLINE,
        url: SITE_URL,
    },
    twitter: {
        title: "Intervu — an overnight job-search agent",
        description: OPENCLAW_SUBLINE,
    },
};

/**
 * The automation-first front door. Everything the old `/` (the job SERP)
 * used to own moved to `/jobs` (`src/app/jobs/page.tsx`) — this route is
 * now a small, server-rendered pitch for the OpenClaw skill, not a search
 * page. The night-scene hero reuses the visual treatment (background,
 * WatchingWall, nav) of the old empty-query "overlay ask", minus the search
 * pill. Unlike that transient overlay (which sat fixed on top of an already-
 * scrollable SERP), this is a standalone route with nothing underneath it,
 * so it flows and scrolls as a normal document instead of being pinned to
 * one viewport.
 */
export default async function HomePage() {
    const cookieStore = await cookies();
    const isReturningSearcher = cookieStore.get(JOBS_VISITOR_COOKIE) != null;

    return (
        <div className="openclaw flex min-h-dvh flex-col items-center bg-[rgb(var(--oc-night))] px-6">
            <div className="relative flex w-full flex-1 flex-col overflow-x-clip">
                <WatchingWall className="absolute inset-0" />
                <FrontDoorNav />

                {/* Returning-searcher memory (lib/jobs-visitor-cookie.ts) —
                    never auto-redirects, just a slim reminder above the
                    pitch for people who've already searched on /jobs. */}
                {isReturningSearcher && (
                    <div className="relative z-10 border-b border-white/10 bg-black/20 px-4 py-2 text-center lg:px-8">
                        <Link href="/jobs" className="text-[13px] font-medium text-white/80 hover:text-white">
                            Go to the job board →
                        </Link>
                    </div>
                )}

                <div className="relative z-10 mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-8 px-4 py-12 text-center lg:px-8">
                    <OpenclawStatusBadge />
                    <h1 className="font-display text-[clamp(32px,4.4vw,48px)] font-black leading-[1.08] tracking-[-0.02em] text-white [text-wrap:balance]">
                        {OPENCLAW_HEADLINE}
                    </h1>
                    <p className="max-w-lg text-[15px] leading-relaxed text-white/60">{OPENCLAW_SUBLINE}</p>

                    <div className="relative mt-2 flex items-center justify-center">
                        <DawnGlow className="absolute h-[420px] w-[420px]" />
                        <WhatsAppThreadHero className="relative z-10" />
                    </div>

                    {/* Primary CTA — already running OpenClaw. */}
                    <div className="w-full max-w-sm">
                        <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.1em] text-white/40">
                            Have OpenClaw? One command:
                        </p>
                        <CopyCommand command={OPENCLAW_INSTALL_COMMAND} />
                    </div>

                    {/* Secondary CTA — no agent yet. */}
                    <div className="w-full max-w-sm">
                        <p className="mb-2 text-[13px] text-white/60">
                            No agent? The hosted version is coming — join the waitlist
                        </p>
                        <OpenclawWaitlistForm className="w-full" />
                    </div>

                    {/* Tertiary escape hatch — quiet, not a competing CTA. */}
                    <p className="font-mono text-[11px] text-white/35">
                        Prefer searching yourself?{" "}
                        <Link href="/jobs" className="underline underline-offset-2 hover:text-white/60">
                            Browse the job board →
                        </Link>
                    </p>
                </div>
            </div>

            {/* The root layout's own `Footer` hides itself on "/" (see its
                doc comment) since this page owns its own copy, wrapped in
                `.dark` since this scene is theme-invariant night. */}
            <div className="dark -mx-6 self-stretch">
                <FooterContent />
            </div>
        </div>
    );
}
