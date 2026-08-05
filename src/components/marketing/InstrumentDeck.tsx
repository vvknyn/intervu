"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthPopover } from "@/components/auth/auth-popover";
import { BrandMark } from "@/components/brand/BrandMark";
import { HowItWorksFilm } from "@/components/marketing/HowItWorksFilm";
import { OpenclawWaitlistForm } from "@/components/marketing/OpenclawWaitlistForm";
import {
    INSTRUMENT_META,
    INSTRUMENT_SUPPORT,
    MCP_CONNECTOR_HINT,
    MCP_CONNECTOR_URL,
    OPENCLAW_INSTALL_COMMAND,
    OPENCLAW_INSTALL_HINT,
} from "@/components/marketing/openclaw-content";
import {
    nextPathForLandingLane,
    signInCtaLabel,
    signedInCtaLabel,
    type LandingLane,
} from "@/lib/auth/landing-intent";
import { validateNextParam } from "@/lib/auth/product-routes";
import { getCurrentUser, onAuthChange, type User } from "@/lib/firebase/client-auth";
import type { HowItWorksFilmId } from "@/lib/marketing/how-it-works";

const LANES: { id: LandingLane; label: string }[] = [
    { id: "mcp", label: "Claude / ChatGPT" },
    { id: "claw", label: "OpenClaw" },
    { id: "board", label: "Job board" },
];

const LANE_CONTENT: Record<
    Exclude<LandingLane, "board">,
    { cmd: string; hint: string }
> = {
    mcp: { cmd: MCP_CONNECTOR_URL, hint: MCP_CONNECTOR_HINT },
    claw: { cmd: OPENCLAW_INSTALL_COMMAND, hint: OPENCLAW_INSTALL_HINT },
};

const BOARD_HINT =
    "Browse verified roles on the job board — sign in to search, save, and apply.";

const tabIdle = { color: "#8b919a" } as const;
const tabActive = {
    background: "rgba(255,255,255,0.07)",
    color: "#ececec",
} as const;

export function InstrumentDeck({ jobCount }: { jobCount: string | null }) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [lane, setLane] = useState<LandingLane>("mcp");
    const [copied, setCopied] = useState(false);
    const [film, setFilm] = useState<HowItWorksFilmId | null>(null);
    const [user, setUser] = useState<User | null>(null);
    const [authOpen, setAuthOpen] = useState(false);
    const [pendingNext, setPendingNext] = useState<string | null>(null);

    const agentLane = lane === "board" ? null : lane;
    const active = agentLane ? LANE_CONTENT[agentLane] : null;

    useEffect(() => {
        const current = getCurrentUser();
        if (current) setUser(current);
        return onAuthChange(setUser);
    }, []);

    useEffect(() => {
        if (searchParams.get("signin") === "1" && !user) {
            setAuthOpen(true);
        }
    }, [searchParams, user]);

    const handleAuthed = () => {
        const next =
            validateNextParam(searchParams.get("next")) ??
            validateNextParam(pendingNext) ??
            "/jobs";
        setPendingNext(null);
        router.push(next);
    };

    const openSignIn = () => {
        setPendingNext(nextPathForLandingLane(lane));
        setAuthOpen(true);
    };

    const handleCopy = async () => {
        if (!active) return;
        try {
            await navigator.clipboard.writeText(active.cmd);
            setCopied(true);
            setTimeout(() => setCopied(false), 1100);
        } catch {
            // Clipboard denied — command stays visible for manual copy.
        }
    };

    const signedInHref = nextPathForLandingLane(lane);

    return (
        <main
            className="flex min-h-dvh flex-col items-center justify-center px-5 pb-12 pt-[72px]"
            style={{
                background:
                    "radial-gradient(900px 500px at 50% 40%, #1a1f27 0%, transparent 60%), #12151a",
            }}
        >
            <div className="mb-9 flex flex-col items-center">
                <div className="flex items-center gap-5">
                    <BrandMark className="h-24 w-24 text-[#ececec] sm:h-28 sm:w-28" />
                    <span className="text-[52px] font-semibold leading-none tracking-[-0.045em] text-[#ececec] sm:text-[60px]">
                        intervu
                    </span>
                </div>
                {jobCount ? (
                    <p
                        className="mt-2.5 flex items-center gap-2 font-mono text-[12px] tracking-[0.02em] text-[#8b919a]"
                        data-testid="landing-job-count"
                    >
                        <span
                            aria-hidden
                            className="instrument-breathe h-1.5 w-1.5 shrink-0 rounded-full bg-[#7cb87a]"
                        />
                        <span>
                            <span className="text-[#c4c9d1]">{jobCount}</span> jobs
                        </span>
                    </p>
                ) : null}
                <p
                    className="mt-4 whitespace-nowrap text-center text-[15px] leading-none tracking-[-0.015em] text-[#c4c9d1]"
                    data-testid="landing-meta"
                >
                    {INSTRUMENT_META}
                </p>
                <p
                    className="mt-2.5 max-w-[34ch] text-center text-[13px] leading-snug text-[#8b919a]"
                    data-testid="landing-support"
                >
                    {INSTRUMENT_SUPPORT}
                </p>
            </div>

            <div
                className="w-full max-w-[520px] rounded-none border-0 p-2 backdrop-blur-[18px]"
                style={{
                    background: "rgba(255,255,255,0.045)",
                    boxShadow: "0 24px 48px rgba(0,0,0,0.28)",
                }}
            >
                <div
                    className="mb-2 grid grid-cols-3 gap-1"
                    role="tablist"
                    aria-label="How to use intervu"
                >
                    {LANES.map(({ id, label }) => (
                        <button
                            key={id}
                            type="button"
                            role="tab"
                            aria-selected={lane === id}
                            onClick={() => setLane(id)}
                            className="cursor-pointer rounded-none border-0 px-2.5 py-3.5 text-center text-[13px] font-medium leading-tight transition-colors duration-200 hover:text-[#ececec]"
                            style={lane === id ? tabActive : tabIdle}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {active ? (
                    <div className="flex items-center gap-2.5 rounded-none border-0 bg-black/30 px-3.5 py-3.5">
                        <span className="shrink-0 font-mono text-xs text-[#5c636e]">&gt;_</span>
                        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[12.5px] text-[#7cb87a]">
                            {active.cmd}
                        </code>
                        <button
                            type="button"
                            onClick={handleCopy}
                            className="shrink-0 cursor-pointer border-0 bg-transparent px-0.5 py-1 font-mono text-[11px] font-medium uppercase tracking-[0.06em] transition-colors"
                            style={{ color: copied ? "#7cb87a" : "#5c636e" }}
                        >
                            {copied ? "Copied" : "Copy"}
                        </button>
                    </div>
                ) : (
                    <div className="rounded-none border-0 bg-black/30 px-3.5 py-3.5 font-mono text-[12.5px] text-[#7cb87a]">
                        /jobs — verified board
                    </div>
                )}
            </div>

            <p className="mt-[18px] max-w-[36ch] text-center text-[13px] leading-[1.45] text-[#5c636e]">
                {active?.hint ?? BOARD_HINT}
            </p>

            {agentLane ? (
                <button
                    type="button"
                    onClick={() => setFilm(agentLane)}
                    className="mt-3 cursor-pointer border-0 bg-transparent font-mono text-[11px] uppercase tracking-[0.08em] text-[#7cb87a] underline-offset-4 transition-colors hover:text-[#9fd09d] hover:underline"
                    data-testid="how-it-works"
                >
                    How it works
                </button>
            ) : null}

            {lane === "claw" ? (
                <div className="mt-6 w-full max-w-[520px]">
                    <p className="mb-2 text-center text-[13px] text-[#8b919a]">
                        No agent yet? The hosted version is coming — join the waitlist
                    </p>
                    <OpenclawWaitlistForm className="w-full [&_button]:border-0 [&_button]:bg-transparent [&_button]:text-[#ececec] [&_input]:border-0 [&_input]:bg-black/30 [&_input]:text-[#ececec] [&_input]:placeholder:text-[#5c636e]" />
                </div>
            ) : null}

            {!user ? (
                lane === "board" ? (
                    <Link
                        href="/jobs"
                        data-testid="landing-sign-in-browse"
                        className="mt-8 inline-block rounded-none px-6 py-3.5 text-[14px] font-medium text-[#12151a] transition-opacity hover:opacity-90"
                        style={{ background: "#ececec" }}
                    >
                        {signInCtaLabel(lane)}
                    </Link>
                ) : (
                    <button
                        type="button"
                        data-testid="landing-sign-in-browse"
                        onClick={openSignIn}
                        className="mt-8 cursor-pointer rounded-none border-0 px-6 py-3.5 text-[14px] font-medium text-[#12151a] transition-opacity hover:opacity-90"
                        style={{ background: "#ececec" }}
                    >
                        {signInCtaLabel(lane)}
                    </button>
                )
            ) : (
                <Link
                    href={signedInHref}
                    data-testid="landing-browse-jobs"
                    className="mt-8 inline-block rounded-none px-6 py-3.5 text-[14px] font-medium text-[#12151a] transition-opacity hover:opacity-90"
                    style={{ background: "#ececec" }}
                >
                    {signedInCtaLabel(lane)}
                </Link>
            )}

            <HowItWorksFilm film={film} onOpenChange={(open) => !open && setFilm(null)} />
            <AuthPopover open={authOpen} onOpenChange={setAuthOpen} showTrigger={false} onAuthed={handleAuthed} />
        </main>
    );
}
