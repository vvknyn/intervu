"use client";

// design-lint-allow-file: decorative mockup, not product chrome -- depicts a
// generic dark-mode auth screen on its own fixed palette. Retains raw hex
// colours and arbitrary radius/tracking values by design; exempt from the
// repo-wide banned-utility gate (tests/unit/design-language.test.ts).

import { useMemo, useState } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/brand/BrandMark";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { siteChrome } from "@/components/layout/site-chrome";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
    nextPathForLandingLane,
    signInCtaLabel,
    type LandingLane,
} from "@/lib/auth/landing-intent";
import { INSTRUMENT_META, INSTRUMENT_SUPPORT } from "@/components/marketing/openclaw-content";
import {
    cleanCompany,
    decodeText,
    locationText,
    postedAgeShort,
    salaryText,
    titleCaseDisplay,
} from "@/lib/jobs/presentation";
import { derivePostedTs } from "@/lib/jobs/meilisearch";
import type { PublicJob } from "@/lib/jobs/types";
import { CONNECT_HEALTH_COPY } from "@/lib/mcp/connect-health-copy";
import { cn } from "@/lib/utils";

const MOCK_NOW = Date.UTC(2026, 7, 5, 15, 0, 0);

type MockPhase = "landing" | "bounce" | "app";
type MockPanel = "jobs" | "connect";
type ConsentState = "pending" | "connected";

const LANES: { id: LandingLane; label: string }[] = [
    { id: "mcp", label: "Claude / ChatGPT" },
    { id: "claw", label: "OpenClaw" },
    { id: "board", label: "Job board" },
];

const MOCK_JOBS: PublicJob[] = [
    {
        id: "mock-adobe",
        title: "Senior Product Manager",
        company: "Adobe",
        company_domain: "adobe.com",
        location: "Remote · US",
        location_city: null,
        location_state: null,
        location_country: "US",
        work_type: "remote",
        description: "Shape Creative Cloud collaboration tools for millions of creators.",
        employment_type: "full_time",
        experience_level: "senior",
        salary_min: 128_000,
        salary_max: 145_000,
        salary_currency: "USD",
        salary_period: "year",
        visa_sponsorship: null,
        tags: ["product"],
        apply_url: "https://careers.adobe.com/example",
        source: "mock",
        posted_at: new Date(MOCK_NOW - 2 * 86_400_000).toISOString(),
        first_seen_at: new Date(MOCK_NOW - 2 * 86_400_000).toISOString(),
        posted_ts: MOCK_NOW - 2 * 86_400_000,
        updated_at: new Date(MOCK_NOW).toISOString(),
        vacancy_status: "open",
        ghost_badge: "clear",
    },
    {
        id: "mock-linear",
        title: "Product Manager, Growth",
        company: "Linear",
        company_domain: "linear.app",
        location: "Remote",
        location_city: null,
        location_state: null,
        location_country: "US",
        work_type: "remote",
        description: "Own activation and expansion for teams shipping faster with Linear.",
        employment_type: "full_time",
        experience_level: "mid",
        salary_min: 140_000,
        salary_max: 165_000,
        salary_currency: "USD",
        salary_period: "year",
        visa_sponsorship: null,
        tags: ["saas"],
        apply_url: "https://linear.app/careers/example",
        source: "mock",
        posted_at: new Date(MOCK_NOW - 5 * 86_400_000).toISOString(),
        first_seen_at: new Date(MOCK_NOW - 5 * 86_400_000).toISOString(),
        posted_ts: MOCK_NOW - 5 * 86_400_000,
        updated_at: new Date(MOCK_NOW).toISOString(),
        vacancy_status: "open",
        ghost_badge: "clear",
    },
    {
        id: "mock-notion",
        title: "Product Manager, AI",
        company: "Notion",
        company_domain: "notion.so",
        location: "San Francisco · Hybrid",
        location_city: "San Francisco",
        location_state: "CA",
        location_country: "US",
        work_type: "hybrid",
        description: "Ship AI-assisted workflows inside Notion's core editor.",
        employment_type: "full_time",
        experience_level: "senior",
        salary_min: 150_000,
        salary_max: 190_000,
        salary_currency: "USD",
        salary_period: "year",
        visa_sponsorship: null,
        tags: ["ai", "product"],
        apply_url: "https://www.notion.so/careers/example",
        source: "mock",
        posted_at: new Date(MOCK_NOW - 1 * 86_400_000).toISOString(),
        first_seen_at: new Date(MOCK_NOW - 1 * 86_400_000).toISOString(),
        posted_ts: MOCK_NOW - 1 * 86_400_000,
        updated_at: new Date(MOCK_NOW).toISOString(),
        vacancy_status: "open",
        ghost_badge: "clear",
    },
];

const tabIdle = { color: "#8b919a" } as const;
const tabActive = {
    background: "rgba(255,255,255,0.07)",
    color: "#ececec",
} as const;

function agentLabel(lane: LandingLane): string {
    if (lane === "claw") return "OpenClaw";
    return "Claude";
}

function MockJobRow({ job, onClick }: { job: PublicJob; onClick: () => void }) {
    const age = postedAgeShort(derivePostedTs(job), MOCK_NOW);
    const salary = salaryText(job);
    return (
        <button
            type="button"
            onClick={onClick}
            className="mb-2 grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 gap-y-1 rounded-[14px] border border-border bg-card p-4 text-left transition-[border-color,box-shadow] duration-150 hover:border-[#7e8896]"
        >
            <div className="row-span-2 self-start">
                <CompanyLogo domain={job.company_domain} name={job.company} size="md" />
            </div>
            <div className="min-w-0 text-left">
                <div className="text-sm font-semibold leading-snug">{titleCaseDisplay(decodeText(job.title))}</div>
                <div className="mt-1 text-xs text-muted-foreground">{cleanCompany(job.company)}</div>
            </div>
            <span className="inline-flex h-fit items-center rounded-full border border-live-tint-border bg-live-tint-bg px-1.5 py-0.5 text-xs text-verdict-live">
                verified
            </span>
            <div className="col-span-full flex flex-wrap gap-x-3 text-xs text-faint">
                <span>{locationText(job)}</span>
                {age && <span>· {age}</span>}
                <span>· {salary ? `from ${salary}` : "pay n/a"}</span>
            </div>
        </button>
    );
}

export function AuthGateMock() {
    const [signedIn, setSignedIn] = useState(false);
    const [phase, setPhase] = useState<MockPhase>("landing");
    const [lane, setLane] = useState<LandingLane>("board");
    const [panel, setPanel] = useState<MockPanel>("jobs");
    const [pendingNext, setPendingNext] = useState("/jobs");
    const [consent, setConsent] = useState<ConsentState>("pending");
    const [selectedJobId, setSelectedJobId] = useState(MOCK_JOBS[0].id);
    const [detailOpen, setDetailOpen] = useState(false);

    const selectedJob = useMemo(
        () => MOCK_JOBS.find((j) => j.id === selectedJobId) ?? MOCK_JOBS[0],
        [selectedJobId],
    );

    const reset = () => {
        setSignedIn(false);
        setPhase("landing");
        setLane("board");
        setPanel("jobs");
        setPendingNext("/jobs");
        setConsent("pending");
        setDetailOpen(false);
    };

    const openJobsBoard = () => {
        setPhase("app");
        setPanel("jobs");
    };

    const startConnectSignIn = (fromLane: LandingLane) => {
        const next = nextPathForLandingLane(fromLane);
        setPendingNext(next);
        if (signedIn) {
            setPhase("app");
            setPanel("connect");
            setConsent("pending");
            return;
        }
        setPhase("bounce");
    };

    const handleLandingCta = () => {
        if (lane === "board") {
            openJobsBoard();
            return;
        }
        startConnectSignIn(lane);
    };

    const openJob = (id: string) => {
        setSelectedJobId(id);
        setDetailOpen(true);
    };

    return (
        <div
            className="min-h-screen text-[#ececec]"
            style={{
                background:
                    "radial-gradient(900px 500px at 50% 40%, #1a1f27 0%, transparent 60%), #12151a",
            }}
        >
            <div className={cn("border-b px-4 py-2 text-center text-xs", siteChrome.border, siteChrome.bar, siteChrome.muted)}>
                <span className="">Auth-gate mock — not live</span>
                {" · "}
                <button type="button" onClick={reset} className="text-brand underline-offset-2 hover:underline">
                    Reset to signed-out
                </button>
                {" · "}
                <Link href="/mock/completeness" className="text-brand underline-offset-2 hover:underline">
                    Completeness mock
                </Link>
            </div>

            {phase === "landing" && (
                <main className="flex min-h-[calc(100dvh-40px)] flex-col items-center justify-center px-5 pb-12 pt-16">
                    <div className="mb-9 flex flex-col items-center">
                        <div className="flex items-center gap-5">
                            <BrandMark className="h-24 w-24 text-[#ececec] sm:h-28 sm:w-28" />
                            <span className="text-4xl font-semibold leading-none sm:text-4xl">
                                velai
                            </span>
                        </div>
                        <p
                            className="mt-4 whitespace-nowrap text-center text-sm leading-none text-[#c4c9d1]"
                            data-testid="mock-landing-meta"
                        >
                            {INSTRUMENT_META}
                        </p>
                        <p className="mt-2.5 max-w-[34ch] text-center text-xs leading-snug text-[#8b919a]">
                            {INSTRUMENT_SUPPORT}
                        </p>
                    </div>

                    <div
                        className="mb-6 w-full max-w-[520px] rounded-none border-0 p-2"
                        style={{ background: "rgba(255,255,255,0.045)" }}
                    >
                        {/* tab-kit: KEEP — design-mock fixture with its own inline-style palette, not shipped chrome */}
                        <div className="grid grid-cols-3 gap-1" role="tablist" aria-label="Intent">
                            {LANES.map(({ id, label }) => (
                                <button
                                    key={id}
                                    type="button"
                                    role="tab" // tab-kit: KEEP — design-mock fixture with its own inline-style palette, not shipped chrome
                                    aria-selected={lane === id}
                                    onClick={() => setLane(id)}
                                    className="ctl-md cursor-pointer rounded-none border-0 px-2.5 text-center text-xs"
                                    style={lane === id ? tabActive : tabIdle}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <button
                        type="button"
                        data-testid="mock-sign-in-cta"
                        onClick={handleLandingCta}
                        className="ctl-lg cursor-pointer rounded-none border-0 px-6 text-sm text-[#12151a]"
                        style={{ background: "#ececec" }}
                    >
                        {signInCtaLabel(lane)}
                    </button>
                </main>
            )}

            {phase === "bounce" && (
                <main className="flex min-h-[calc(100dvh-40px)] flex-col items-center justify-center px-5 text-center">
                    <h1 className="text-2xl font-semibold">Sign in to connect your AI</h1>
                    <p className="mt-3 max-w-md text-sm text-[#8b919a]">
                        After sign-in you open Connect to pair {agentLabel(lane === "board" ? "mcp" : lane)}.
                    </p>
                    <p className="mt-1 text-xs text-[#5c636e]">next={pendingNext}</p>
                    <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                        <Button
                            className="rounded-none bg-[#ececec] text-[#12151a] hover:bg-[#ececec]/90"
                            onClick={() => {
                                setSignedIn(true);
                                setPhase("app");
                                setPanel("connect");
                                setConsent("pending");
                            }}
                        >
                            Continue as demo
                        </Button>
                        <button
                            type="button"
                            onClick={() => setPhase("landing")}
                            className="text-xs text-[#8b919a] underline-offset-2 hover:underline"
                        >
                            Back
                        </button>
                    </div>
                </main>
            )}

            {phase === "app" && (
                <>
                    <header className={cn("sticky top-0 z-40 border-b", siteChrome.bar, siteChrome.border)}>
                        <div className="mx-auto flex h-16 w-full max-w-[920px] items-center justify-between px-5 sm:px-7">
                            <div className="flex items-center gap-2.5">
                                <BrandMark className="h-10 w-10" />
                                <span className="text-lg font-semibold">velai</span>
                            </div>
                            <nav className="flex items-center gap-4 text-xs">
                                <button
                                    type="button"
                                    onClick={() => setPanel("jobs")}
                                    className={panel === "jobs" ? siteChrome.active : siteChrome.mutedHover}
                                >
                                    Jobs
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (!signedIn) {
                                            setPendingNext("/connect?client=claude");
                                            setPhase("bounce");
                                            return;
                                        }
                                        setPanel("connect");
                                        setConsent("pending");
                                    }}
                                    className={panel === "connect" ? siteChrome.active : siteChrome.mutedHover}
                                >
                                    Connect
                                </button>
                                {!signedIn && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setPendingNext("/jobs");
                                            setPhase("bounce");
                                        }}
                                        className="text-brand"
                                    >
                                        Sign in
                                    </button>
                                )}
                            </nav>
                        </div>
                    </header>

                    {panel === "jobs" && (
                        <main className="mx-auto w-full max-w-[720px] px-5 py-8 sm:px-7">
                            <p className="mb-4 text-xs text-[#8b919a]">
                                Mock SERP · browse free · detail needs sign-in
                            </p>
                            {MOCK_JOBS.map((job) => (
                                <MockJobRow key={job.id} job={job} onClick={() => openJob(job.id)} />
                            ))}
                        </main>
                    )}

                    {panel === "connect" && signedIn && (
                        <main className="mx-auto w-full max-w-[720px] px-5 py-10 sm:px-7">
                            <h1 className="text-2xl font-semibold">Connect your agent</h1>
                            <p className="mt-2 max-w-xl text-sm text-[#8b919a]">
                                Sign-in linked this browser. Next: allow your AI in the connector popup.
                            </p>

                            {consent === "pending" ? (
                                <div className="mt-8 max-w-md rounded-none border border-[#3a4049] bg-muted p-6">
                                    <p className="text-sm text-[#ececec]">
                                        Allow {agentLabel(lane === "board" ? "mcp" : lane)} to access velai?
                                    </p>
                                    <Button
                                        className="mt-5 rounded-none bg-[#ececec] text-[#12151a] hover:bg-[#ececec]/90"
                                        onClick={() => setConsent("connected")}
                                    >
                                        Allow
                                    </Button>
                                </div>
                            ) : (
                                <div className="mt-8 max-w-md rounded-none border border-live-tint-border bg-live-tint-bg/20 p-6">
                                    <p className="text-sm font-semibold text-verdict-live">Connected</p>
                                    <p className="mt-3 text-sm leading-relaxed text-[#c4c9d1]">{CONNECT_HEALTH_COPY}</p>
                                </div>
                            )}
                        </main>
                    )}

                    <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
                        <SheetContent
                            side="bottom"
                            hideCloseButton
                            overlayClassName="bg-[rgba(18,21,26,0.42)]"
                            className="left-1/2 max-h-[min(640px,var(--overlay-max-h))] w-full max-w-[720px] -translate-x-1/2 overflow-hidden rounded-t-[18px] border border-border border-b-0 p-0"
                        >
                            <SheetTitle className="sr-only">
                                {decodeText(selectedJob.title)} at {cleanCompany(selectedJob.company)}
                            </SheetTitle>
                            <div className="relative min-h-[280px] overflow-hidden">
                                <div
                                    className={cn(
                                        "px-5 pb-6 pt-4",
                                        !signedIn && "pointer-events-none select-none",
                                    )}
                                    aria-hidden={!signedIn}
                                >
                                    <div className="flex items-start gap-3">
                                        <CompanyLogo
                                            domain={selectedJob.company_domain}
                                            name={selectedJob.company}
                                            size="lg"
                                        />
                                        <div>
                                            <h2 className="text-lg font-semibold">{decodeText(selectedJob.title)}</h2>
                                            <p className="mt-1 text-sm text-muted-foreground">
                                                {cleanCompany(selectedJob.company)} · {locationText(selectedJob)}
                                            </p>
                                        </div>
                                    </div>
                                    <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                                        {selectedJob.description}
                                    </p>
                                </div>
                                {!signedIn && (
                                    <div
                                        data-testid="mock-detail-signin-gate"
                                        className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-card px-6 text-center"
                                    >
                                        <p className="text-sm font-semibold text-foreground">
                                            Sign in to view this role
                                        </p>
                                        <Button
                                            onClick={() => {
                                                setSignedIn(true);
                                                setDetailOpen(false);
                                            }}
                                        >
                                            Sign in
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </SheetContent>
                    </Sheet>
                </>
            )}
        </div>
    );
}
