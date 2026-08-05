"use client";

import { useState } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/brand/BrandMark";
import { HowItWorksFilm } from "@/components/marketing/HowItWorksFilm";
import { OpenclawWaitlistForm } from "@/components/marketing/OpenclawWaitlistForm";
import {
    INSTRUMENT_META,
    MCP_CONNECTOR_HINT,
    MCP_CONNECTOR_URL,
    OPENCLAW_INSTALL_COMMAND,
    OPENCLAW_INSTALL_HINT,
} from "@/components/marketing/openclaw-content";
import type { HowItWorksFilmId } from "@/lib/marketing/how-it-works";

type Lane = "mcp" | "claw";

const LANES: { id: Lane | "board"; label: string }[] = [
    { id: "mcp", label: "Claude / ChatGPT" },
    { id: "claw", label: "OpenClaw" },
    { id: "board", label: "Job board" },
];

const LANE_CONTENT: Record<Lane, { cmd: string; hint: string }> = {
    mcp: { cmd: MCP_CONNECTOR_URL, hint: MCP_CONNECTOR_HINT },
    claw: { cmd: OPENCLAW_INSTALL_COMMAND, hint: OPENCLAW_INSTALL_HINT },
};

const tabIdle = { color: "#8b919a" } as const;
const tabActive = {
    background: "rgba(255,255,255,0.07)",
    color: "#ececec",
} as const;

export function InstrumentDeck({ jobCount }: { jobCount: string | null }) {
    const [lane, setLane] = useState<Lane>("mcp");
    const [copied, setCopied] = useState(false);
    const [film, setFilm] = useState<HowItWorksFilmId | null>(null);

    const active = LANE_CONTENT[lane];

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(active.cmd);
            setCopied(true);
            setTimeout(() => setCopied(false), 1100);
        } catch {
            // Clipboard denied — command stays visible for manual copy.
        }
    };

    return (
        <main
            className="flex min-h-dvh flex-col items-center justify-center px-5 pb-12 pt-[72px]"
            style={{
                background:
                    "radial-gradient(900px 500px at 50% 40%, #1a1f27 0%, transparent 60%), #12151a",
            }}
        >
            <div className="mb-9 flex flex-col items-center">
                <div className="flex items-center gap-4">
                    <BrandMark className="h-16 w-16 text-[#ececec]" />
                    <span className="text-[44px] font-semibold leading-none tracking-[-0.045em] text-[#ececec] sm:text-[48px]">
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
                    {LANES.map(({ id, label }) => {
                        const className =
                            "cursor-pointer rounded-none border-0 px-2.5 py-3.5 text-center text-[13px] font-medium leading-tight transition-colors duration-200 hover:text-[#ececec]";
                        if (id === "board") {
                            return (
                                <Link
                                    key={id}
                                    href="/jobs"
                                    role="tab"
                                    aria-selected={false}
                                    className={className}
                                    style={tabIdle}
                                >
                                    {label}
                                </Link>
                            );
                        }
                        return (
                            <button
                                key={id}
                                type="button"
                                role="tab"
                                aria-selected={lane === id}
                                onClick={() => setLane(id)}
                                className={className}
                                style={lane === id ? tabActive : tabIdle}
                            >
                                {label}
                            </button>
                        );
                    })}
                </div>

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
            </div>

            <p className="mt-[18px] max-w-[36ch] text-center text-[13px] leading-[1.45] text-[#5c636e]">
                {active.hint}
            </p>

            <button
                type="button"
                onClick={() => setFilm(lane)}
                className="mt-3 cursor-pointer border-0 bg-transparent font-mono text-[11px] uppercase tracking-[0.08em] text-[#7cb87a] underline-offset-4 transition-colors hover:text-[#9fd09d] hover:underline"
                data-testid="how-it-works"
            >
                How it works
            </button>

            {lane === "claw" ? (
                <div className="mt-6 w-full max-w-[520px]">
                    <p className="mb-2 text-center text-[13px] text-[#8b919a]">
                        No agent yet? The hosted version is coming — join the waitlist
                    </p>
                    <OpenclawWaitlistForm className="w-full [&_button]:border-0 [&_button]:bg-transparent [&_button]:text-[#ececec] [&_input]:border-0 [&_input]:bg-black/30 [&_input]:text-[#ececec] [&_input]:placeholder:text-[#5c636e]" />
                </div>
            ) : null}

            <HowItWorksFilm film={film} onOpenChange={(open) => !open && setFilm(null)} />
        </main>
    );
}
