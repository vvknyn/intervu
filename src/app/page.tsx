import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { WatchingWall } from "@/components/marketing/WatchingWall";
import { WhatsAppThreadHero } from "@/components/marketing/WhatsAppThreadHero";
import { OpenclawStatusBadge } from "@/components/marketing/OpenclawStatusBadge";
import { OpenclawWaitlistForm } from "@/components/marketing/OpenclawWaitlistForm";
import { CopyCommand } from "@/components/marketing/CopyCommand";
import {
    OPENCLAW_HEADLINE,
    OPENCLAW_SUBLINE,
    OPENCLAW_INSTALL_COMMAND,
    WHILE_YOU_SLEPT_STEPS,
    RUNS_ON_YOUR_MACHINE,
} from "@/components/marketing/openclaw-content";
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
 * page.
 *
 * One visual world (2026-08-04): this page used to force a coral/violet
 * night palette via a `.openclaw` scope regardless of the site's own
 * light/dark toggle — the thing that made the jump from here into the app
 * feel like a different product. It now renders in the app's own tokens
 * (`--background`/`--foreground`/`--brand`, same `TopBar` everyone else
 * gets) and follows the theme toggle like every other route.
 *
 * The hero section below is still exactly one viewport tall and complete
 * on its own — headline, install command, waitlist, escape hatch to
 * `/jobs` — so nobody has to scroll to act (`min-h-[calc(100dvh-58px)]`
 * accounts for `TopBar`'s own fixed 58px — its `h-14` content row plus its
 * `border-b-2` — since `TopBar` now renders above this page instead of
 * this page owning a competing nav of its own). Additional ollama-style
 * sections live below that first viewport for people who scroll; the page
 * as a whole is no longer artificially pinned to a single screen.
 */
export default async function HomePage() {
    const cookieStore = await cookies();
    const isReturningSearcher = cookieStore.get(JOBS_VISITOR_COOKIE) != null;

    return (
        <>
            <section className="relative flex min-h-[calc(100dvh-58px)] flex-col overflow-x-clip px-4 lg:px-8">
                <WatchingWall className="absolute inset-0" />

                {/* Returning-searcher memory (lib/jobs-visitor-cookie.ts) —
                    never auto-redirects, just a slim reminder above the
                    pitch for people who've already searched on /jobs. */}
                {isReturningSearcher && (
                    <div className="relative z-10 -mx-4 border-b border-border bg-muted/40 px-4 py-2 text-center lg:-mx-8 lg:px-8">
                        <Link href="/jobs" className="text-[13px] font-medium text-muted-foreground hover:text-foreground">
                            Go to the job board →
                        </Link>
                    </div>
                )}

                <div className="relative z-10 mx-auto grid w-full max-w-[1280px] flex-1 grid-cols-1 content-center items-center gap-8 py-2 lg:grid-cols-[7fr_5fr] lg:gap-12">
                    <div className="flex flex-col items-center gap-5 text-center lg:items-start lg:text-left">
                        <OpenclawStatusBadge />
                        <h1 className="text-display max-w-2xl font-extrabold leading-[1.08] tracking-[-0.02em] text-foreground [text-wrap:balance]">
                            {OPENCLAW_HEADLINE}
                        </h1>
                        <p className="max-w-lg text-[15px] leading-relaxed text-muted-foreground">{OPENCLAW_SUBLINE}</p>

                        {/* Primary CTA — already running OpenClaw. */}
                        <div className="mt-1 w-full max-w-md">
                            <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.1em] text-faint">
                                Have OpenClaw? One command:
                            </p>
                            <CopyCommand command={OPENCLAW_INSTALL_COMMAND} />
                        </div>

                        {/* Secondary CTA — no agent yet. */}
                        <div className="w-full max-w-md">
                            <p className="mb-2 text-[13px] text-muted-foreground">
                                No agent? The hosted version is coming — join the waitlist
                            </p>
                            <OpenclawWaitlistForm className="w-full" />
                        </div>

                        {/* Tertiary escape hatch — quiet, not a competing CTA. */}
                        <p className="font-mono text-[11px] text-faint">
                            Prefer searching yourself?{" "}
                            <Link href="/jobs" className="underline underline-offset-2 hover:text-foreground">
                                Browse the job board →
                            </Link>
                        </p>
                    </div>

                    <div className="relative flex items-center justify-center">
                        <WhatsAppThreadHero className="relative z-10" />
                    </div>
                </div>
            </section>

            {/* Below the fold — ollama-style rhythm (96px, within the
                96-160px marketing range), reached only by scrolling. The
                hero above is already complete without it. */}
            <section aria-labelledby="while-you-slept-heading" className="border-t border-border py-24">
                <div className="mx-auto max-w-5xl px-4 lg:px-8">
                    <h2
                        id="while-you-slept-heading"
                        className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
                    >
                        While you slept
                    </h2>
                    <ol className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
                        {WHILE_YOU_SLEPT_STEPS.map((step, i) => (
                            <li key={step.title} className="flex flex-col gap-2">
                                <span className="font-mono text-xs text-faint">{String(i + 1).padStart(2, "0")}</span>
                                <p className="font-semibold text-foreground">{step.title}</p>
                                <p className="text-sm text-muted-foreground">{step.body}</p>
                            </li>
                        ))}
                    </ol>
                </div>
            </section>

            <section aria-labelledby="runs-local-heading" className="border-t border-border py-24">
                <div className="mx-auto max-w-5xl px-4 text-center lg:px-8">
                    <h2 id="runs-local-heading" className="sr-only">
                        Runs on your machine
                    </h2>
                    <p className="mx-auto max-w-xl text-base text-foreground">{RUNS_ON_YOUR_MACHINE.long}</p>
                    <Link
                        href="/openclaw"
                        className="mt-6 inline-block text-sm font-medium text-foreground underline underline-offset-2 hover:text-brand"
                    >
                        See the full walkthrough →
                    </Link>
                </div>
            </section>
        </>
    );
}
