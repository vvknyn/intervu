"use client";

// design-lint-allow-file: decorative mockup, not product chrome -- depicts a
// generic profile-completeness card on its own fixed palette. Retains raw
// hex colours and arbitrary radius/tracking values by design; exempt from the
// repo-wide banned-utility gate (tests/unit/design-language.test.ts).

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowSquareOut, Check, ShieldCheck, Trash, WarningCircle } from "@phosphor-icons/react";
import { BrandMark } from "@/components/brand/BrandMark";
import { AuthPopover } from "@/components/auth/auth-popover";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { McpHandoffNote } from "@/components/mcp/McpHandoffNote";
import { buildFactChips, deriveGhostSignals, ghostCheckedText, type FactChipKind } from "@/components/jobs/job-detail-facts";
import { PageHeader } from "@/components/layout/PageHeader";
import { siteChrome } from "@/components/layout/site-chrome";
import { PursuitListRow } from "@/components/tracker/PursuitListRow";
import { TrackRoleSheet, type TrackRoleDraft } from "@/components/tracker/TrackRoleSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CONNECT_CLIENTS, type ConnectClientId } from "@/lib/connect-clients";
import { handoffClientFromConnectTab, saveHandoffClient } from "@/lib/mcp/job-handoff";
import { formatDescription } from "@/lib/jobs/format-description";
import { classifyPostingFreshness } from "@/lib/jobs/posting-freshness";
import { checkFreshness } from "@/lib/jobs/badges";
import { formatRelativeAge } from "@/lib/jobs/freshness";
import {
    cleanCompany,
    decodeText,
    ghostMetaFor,
    locationText,
    postedAgeShort,
    prettyEnum,
    salaryText,
    titleCaseDisplay,
} from "@/lib/jobs/presentation";
import { derivePostedTs } from "@/lib/jobs/meilisearch";
import type { PublicJob } from "@/lib/jobs/types";
import {
    TRACKER_CHIP_FILTERS,
    countByTrackerFilter,
    matchesTrackerFilter,
    type TrackerFilter,
} from "@/lib/pursuits/tracker-display";
import type { Pursuit, PursuitStage } from "@/lib/pursuits/types";
import { cn } from "@/lib/utils";

// A frozen fixture value, deliberately a literal: this mock exists to render a
// stable picture, so it must not move when an env var does. Kept on the same
// origin as the real connector so the picture doesn't teach a dead domain.
const MCP_URL = "https://velai.app/api/mcp";
const MOCK_NOW = Date.UTC(2026, 7, 5, 15, 0, 0);
const TOTAL_ROLES = 248;

type MockPanel = "jobs" | "tracker" | "connect" | "settings";

const MOCK_PANELS: { id: MockPanel; label: string }[] = [
    { id: "jobs", label: "Jobs" },
    { id: "tracker", label: "Tracker" },
    { id: "connect", label: "Connect" },
    { id: "settings", label: "Settings" },
];

const CONNECT_MOCK_CLIENTS = CONNECT_CLIENTS.filter((c) =>
    (["claude", "chatgpt", "cursor"] as ConnectClientId[]).includes(c.id),
);

const STEP1_INTRO: Record<ConnectClientId, string> = {
    claude: "In Claude, open Settings → Connectors → Add custom connector and paste:",
    chatgpt: "In ChatGPT: Settings → Connectors (developer mode) → Add — requires a paid plan.",
    gemini: "The Gemini app can't take custom MCP connectors yet. In your Gemini CLI settings.json, add velai as an mcpServers entry pointing at:",
    cursor: "In Cursor, open Settings → MCP and add a new server pointing at:",
    openclaw: "In your openclaw.json, add velai under mcpServers pointing at the URL below.",
};

const CONNECT_PROMPTS = [
    "Find senior product manager roles in Berlin posted this week",
    "Save the Adobe role to my tracker",
    "Mark CareerPlug as applied",
    "What are my job search preferences?",
];

const FACT_CHIP_KEY: Record<FactChipKind, string> = {
    work_type: "workplace",
    employment_type: "type",
    experience_level: "level",
    salary: "salary",
    posted: "posted",
    first_seen: "first seen by us",
};

function factValue(kind: FactChipKind, label: string): string {
    return kind === "posted" || kind === "first_seen" ? label.replace(/^(Posted|First seen)\s+/i, "") : label;
}

function daysAgoIso(days: number): string {
    return new Date(MOCK_NOW - days * 86_400_000).toISOString();
}

function mockPursuit(
    id: string,
    company: string,
    position: string,
    status: PursuitStage,
    daysInTracker: number,
): Pursuit {
    const created = daysAgoIso(daysInTracker);
    return {
        id,
        company_name: company,
        position,
        status,
        user_id: "mock-user",
        created_at: created,
        updated_at: created,
    };
}

const MOCK_JOBS: PublicJob[] = [
    {
        id: "job-adobe-pm",
        title: "Senior Product Manager, Creative Cloud",
        company: "Adobe",
        company_domain: "adobe.com",
        location: "Remote · US",
        location_city: null,
        location_state: null,
        location_country: "US",
        work_type: "remote",
        description:
            "About this role\n\nAdobe is hiring a senior PM to shape the next generation of Creative Cloud collaboration tools. You will own the roadmap for cross-app workflows used by millions of creators.\n\nRequirements\n- 5+ years product management in B2B SaaS\n- Track record shipping features adopted by design teams\n- Comfort with analytics-driven prioritization",
        employment_type: "full_time",
        experience_level: "senior",
        salary_min: 128_000,
        salary_max: 145_000,
        salary_currency: "USD",
        salary_period: "year",
        visa_sponsorship: null,
        tags: ["product", "saas", "collaboration"],
        apply_url: "https://careers.adobe.com/us/en/job/example",
        source: "mock",
        posted_at: daysAgoIso(2),
        first_seen_at: daysAgoIso(2),
        posted_ts: MOCK_NOW - 2 * 86_400_000,
        updated_at: daysAgoIso(0),
        vacancy_status: "open",
        ghost_badge: "clear",
    },
    {
        id: "job-careerplug-pm",
        title: "Product Manager",
        company: "CareerPlug",
        company_domain: "careerplug.com",
        location: "Remote",
        location_city: null,
        location_state: null,
        location_country: "US",
        work_type: "remote",
        description:
            "CareerPlug builds hiring software for small businesses. You will define the product vision for applicant tracking features used by 10k+ employers.\n\nRequirements\n- 3+ years PM experience\n- HR tech or SMB SaaS background\n- Strong written communication",
        employment_type: "full_time",
        experience_level: "mid",
        salary_min: 115_000,
        salary_max: 130_000,
        salary_currency: "USD",
        salary_period: "year",
        visa_sponsorship: null,
        tags: ["hr tech", "smb"],
        apply_url: "https://www.careerplug.com/careers/example",
        source: "mock",
        posted_at: daysAgoIso(4),
        first_seen_at: daysAgoIso(4),
        posted_ts: MOCK_NOW - 4 * 86_400_000,
        updated_at: daysAgoIso(1),
        vacancy_status: "open",
        ghost_badge: "clear",
    },
    {
        id: "job-tracegains-pm",
        title: "Product Manager — Compliance Platform",
        company: "TraceGains",
        company_domain: "tracegains.com",
        location: "Denver, CO · Hybrid",
        location_city: "Denver",
        location_state: "CO",
        location_country: "US",
        work_type: "hybrid",
        description:
            "TraceGains connects food and beverage manufacturers with supplier compliance data. You will lead discovery for regulatory workflow automation.\n\nRequirements\n- Supply chain or compliance domain interest\n- Experience with enterprise buyers\n- SQL literacy a plus",
        employment_type: "full_time",
        experience_level: "mid",
        salary_min: 120_000,
        salary_max: 135_000,
        salary_currency: "USD",
        salary_period: "year",
        visa_sponsorship: null,
        tags: ["compliance", "supply chain"],
        apply_url: "https://tracegains.com/careers/example",
        source: "mock",
        posted_at: daysAgoIso(7),
        first_seen_at: daysAgoIso(7),
        posted_ts: MOCK_NOW - 7 * 86_400_000,
        updated_at: daysAgoIso(2),
        vacancy_status: "open",
        ghost_badge: "caution",
    },
    {
        id: "job-notion-pm",
        title: "Product Manager, Growth",
        company: "Notion",
        company_domain: "notion.so",
        location: "San Francisco, CA · Hybrid",
        location_city: "San Francisco",
        location_state: "CA",
        location_country: "US",
        work_type: "hybrid",
        description:
            "Notion's growth team is expanding activation experiments across self-serve and team plans.\n\nRequirements\n- Growth PM experience\n- Experimentation at scale\n- Data-informed decision making",
        employment_type: "full_time",
        experience_level: "senior",
        salary_min: 140_000,
        salary_max: 165_000,
        salary_currency: "USD",
        salary_period: "year",
        visa_sponsorship: null,
        tags: ["growth", "experiments"],
        apply_url: "https://www.notion.so/careers/example",
        source: "mock",
        posted_at: daysAgoIso(3),
        first_seen_at: daysAgoIso(3),
        posted_ts: MOCK_NOW - 3 * 86_400_000,
        updated_at: daysAgoIso(0),
        vacancy_status: "open",
        ghost_badge: "clear",
    },
    {
        id: "job-figma-pm",
        title: "Product Manager, Developer Platform",
        company: "Figma",
        company_domain: "figma.com",
        location: "Remote · US",
        location_city: null,
        location_state: null,
        location_country: "US",
        work_type: "remote",
        description:
            "Own the API and plugin ecosystem roadmap for Figma's developer platform.\n\nRequirements\n- Platform or developer tools PM\n- API product experience\n- Community engagement",
        employment_type: "full_time",
        experience_level: "senior",
        salary_min: 150_000,
        salary_max: 175_000,
        salary_currency: "USD",
        salary_period: "year",
        visa_sponsorship: null,
        tags: ["platform", "api"],
        apply_url: "https://www.figma.com/careers/example",
        source: "mock",
        posted_at: daysAgoIso(5),
        first_seen_at: daysAgoIso(5),
        posted_ts: MOCK_NOW - 5 * 86_400_000,
        updated_at: daysAgoIso(1),
        vacancy_status: "open",
        ghost_badge: "clear",
    },
    {
        id: "job-linear-pm",
        title: "Product Manager",
        company: "Linear",
        company_domain: "linear.app",
        location: "Remote · Global",
        location_city: null,
        location_state: null,
        location_country: null,
        work_type: "remote",
        description:
            "Linear is looking for a PM to improve issue tracking workflows for high-velocity engineering teams.\n\nRequirements\n- Developer tools experience\n- Opinionated about UX craft\n- Startup pace comfort",
        employment_type: "full_time",
        experience_level: "mid",
        salary_min: 135_000,
        salary_max: 155_000,
        salary_currency: "USD",
        salary_period: "year",
        visa_sponsorship: null,
        tags: ["developer tools"],
        apply_url: "https://linear.app/careers/example",
        source: "mock",
        posted_at: daysAgoIso(6),
        first_seen_at: daysAgoIso(6),
        posted_ts: MOCK_NOW - 6 * 86_400_000,
        updated_at: daysAgoIso(3),
        vacancy_status: "open",
        ghost_badge: "caution",
    },
];

const INITIAL_PURSUITS: Pursuit[] = [
    mockPursuit("t1", "Adobe", "Senior Product Manager", "interested", 5),
    mockPursuit("t2", "CareerPlug", "Product Manager", "applied", 12),
    mockPursuit("t3", "TraceGains", "PM — Compliance", "interviewing", 8),
];

interface MockCredential {
    id: string;
    name: string;
    kind: string;
    connected: string;
    lastUsed: string;
}

const INITIAL_CREDENTIALS: MockCredential[] = [
    { id: "c1", name: "Claude", kind: "OAuth connection", connected: "Aug 1, 2026", lastUsed: "2h ago" },
    { id: "c2", name: "Cursor", kind: "OAuth connection", connected: "Jul 28, 2026", lastUsed: "1d ago" },
];

function CopyUrlBar() {
    const [copied, setCopied] = useState(false);
    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(MCP_URL);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            /* clipboard denied */
        }
    };
    return (
        <div className="flex items-stretch rounded-none border-2 border-foreground">
            <code className="flex-1 truncate px-3 py-2.5 text-sm text-foreground">{MCP_URL}</code>
            <button
                type="button"
                onClick={handleCopy}
                className="shrink-0 rounded-none border-l-2 border-foreground px-3 py-2.5 text-xs font-semibold text-foreground transition hover:bg-muted"
            >
                {copied ? "Copied" : "Copy"}
            </button>
        </div>
    );
}

function MockJobRow({
    job,
    active,
    onClick,
}: {
    job: PublicJob;
    active: boolean;
    onClick: () => void;
}) {
    const flagged = job.ghost_badge === "caution" || job.ghost_badge === "likely_ghost";
    const salary = salaryText(job);
    const age = postedAgeShort(derivePostedTs(job), MOCK_NOW);
    const level = prettyEnum(job.experience_level);
    const employment = prettyEnum(job.employment_type);
    const loc = locationText(job);
    const modeLabel = job.work_type === "remote" ? "Remote" : job.work_type ? prettyEnum(job.work_type) : null;
    const locationLine = job.work_type === "remote" ? "Remote" : modeLabel ? `${loc} · ${modeLabel}` : loc;

    return (
        <div
            role="option"
            tabIndex={0}
            aria-selected={active}
            data-testid="job-row"
            onClick={onClick}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onClick();
                }
            }}
            className={cn(
                "group mb-2 grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 gap-y-1 rounded-[14px] border border-border bg-card p-4 text-left transition-[border-color,box-shadow] duration-150 hover:border-[#7e8896] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:-outline-offset-2",
                active && "border-foreground",
            )}
        >
            <div className="row-span-2 self-start">
                <CompanyLogo domain={job.company_domain} name={job.company} size="md" />
            </div>
            <div className="min-w-0">
                <div className="text-sm font-semibold leading-snug text-foreground">
                    {titleCaseDisplay(decodeText(job.title))}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{cleanCompany(job.company) || "Unknown company"}</div>
            </div>
            <span
                className={cn(
                    "inline-flex h-fit items-center gap-1 self-start rounded-full border px-1.5 py-0.5 text-xs",
                    flagged
                        ? "border-border bg-card text-muted-foreground"
                        : "border-live-tint-border bg-live-tint-bg text-verdict-live",
                )}
            >
                {flagged ? "review" : "verified"}
            </span>
            <div className="col-span-full flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
                <span>{locationLine}</span>
                {age && (
                    <>
                        <span aria-hidden>·</span>
                        <span>{age}</span>
                    </>
                )}
                <span aria-hidden>·</span>
                <span>{salary ? `from ${salary}` : "pay n/a"}</span>
                {level && (
                    <span className="inline-flex items-center rounded-full border border-border bg-card px-1.5 py-0.5 text-xs text-muted-foreground">
                        {level}
                    </span>
                )}
                {employment && employment.toLowerCase() !== "full-time" && employment.toLowerCase() !== "full time" && (
                    <span className="inline-flex items-center rounded-full border border-border bg-card px-1.5 py-0.5 text-xs text-muted-foreground">
                        {employment}
                    </span>
                )}
            </div>
        </div>
    );
}

function MockJobDetail({
    job,
    onSignIn,
    onClose,
}: {
    job: PublicJob;
    onSignIn: () => void;
    onClose?: () => void;
}) {
    const staleCheck = checkFreshness(job, MOCK_NOW) === "stale";
    const ghost = ghostMetaFor(job, MOCK_NOW);
    const freshness = classifyPostingFreshness(job, MOCK_NOW);
    const postedRelative =
        freshness.postedMs != null ? formatRelativeAge(new Date(freshness.postedMs).toISOString(), MOCK_NOW) : null;
    const firstSeenRelative =
        freshness.firstSeenMs != null ? formatRelativeAge(new Date(freshness.firstSeenMs).toISOString(), MOCK_NOW) : null;
    const blocks = useMemo(() => formatDescription(job.description), [job.description]);
    const chips = buildFactChips(job, postedRelative, firstSeenRelative);
    const ghostSignals = deriveGhostSignals(job, freshness, blocks.length, MOCK_NOW);
    const checkedText = ghostCheckedText(job, MOCK_NOW);
    const handoffJob = {
        id: job.id,
        title: titleCaseDisplay(decodeText(job.title)),
        company: cleanCompany(job.company) || job.company || "Unknown company",
        location: locationText(job) || null,
    };

    return (
        <div className="overflow-hidden border-0 bg-transparent">
            <div className="border-b border-border px-5 pb-3.5 pt-1">
                <div className="flex items-start gap-3">
                    <CompanyLogo domain={job.company_domain} name={job.company} size="lg" />
                    <div className="min-w-0 flex-1">
                        <h2 className="text-lg font-semibold leading-tight">{titleCaseDisplay(decodeText(job.title))}</h2>
                        <div className="mt-1 text-sm text-muted-foreground">
                            {cleanCompany(job.company) || "Unknown company"} · {locationText(job)}
                        </div>
                        {chips.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                                {chips.map((c) => (
                                    <span
                                        key={c.kind}
                                        className="mono-data inline-flex items-center gap-1.5 border border-border bg-background px-2.5 py-1.5 text-xs text-foreground"
                                    >
                                        <b className="text-muted-foreground">{FACT_CHIP_KEY[c.kind]}</b>
                                        <span className={c.kind === "first_seen" ? "verified-underline" : undefined}>
                                            {factValue(c.kind, c.label)}
                                        </span>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                    {onClose && (
                        <button
                            type="button"
                            aria-label="Close"
                            onClick={onClose}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-base text-muted-foreground hover:text-foreground"
                        >
                            ×
                        </button>
                    )}
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2 px-5">
                    {job.apply_url && (
                        <Button className="gap-2" onClick={() => window.open(job.apply_url, "_blank", "noopener,noreferrer")}>
                            <ArrowSquareOut size={16} />
                            Apply
                        </Button>
                    )}
                    <Button variant="quiet" className="gap-2" onClick={onSignIn}>
                        <Check size={16} />
                        Sign in to save
                    </Button>
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5">
                    <button
                        type="button"
                        disabled
                        title="Available after sign-in"
                        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground opacity-60 disabled:pointer-events-none"
                    >
                        <Check size={16} />
                        Mark as applied
                    </button>
                </div>
            </div>

            <div className="px-5 pb-6 pt-4">
                {ghost && (
                    <div className={cn("mb-5 border p-3.5", ghost.cls)}>
                        <div className="flex items-start gap-2.5">
                            {job.ghost_badge === "clear" && !staleCheck ? (
                                <ShieldCheck size={18} className="mt-0.5 shrink-0" weight="fill" />
                            ) : (
                                <WarningCircle size={18} className="mt-0.5 shrink-0" weight="fill" />
                            )}
                            <div>
                                <div className="verified-underline text-xs font-semibold">{ghost.label}</div>
                                <div className="mt-0.5 text-xs leading-relaxed opacity-90">{ghost.explain}</div>
                            </div>
                        </div>
                        {ghostSignals.length > 0 && (
                            <div className="mono-data mt-3 grid grid-cols-1 gap-x-5 gap-y-1.5 text-xs sm:grid-cols-2">
                                {ghostSignals.map((s) => (
                                    <span key={s.text}>
                                        {s.status === "favorable" ? "✓ " : "— "}
                                        {s.text}
                                    </span>
                                ))}
                            </div>
                        )}
                        <div className="verified-underline mono-data mt-2.5 inline-block text-xs opacity-80">
                            every signal automated · {checkedText.charAt(0).toLowerCase()}
                            {checkedText.slice(1)}
                        </div>
                    </div>
                )}

                <div className="mb-5">
                    <div className="mb-2 text-xs font-semibold">About this role</div>
                    {blocks.length > 0 ? (
                        <div className="text-sm leading-relaxed text-muted-foreground">
                            {blocks.map((b, i) => {
                                if (b.type === "heading") {
                                    return (
                                        <h4
                                            key={i}
                                            className="mb-1.5 mt-4 text-xs font-semibold text-foreground first:mt-0"
                                        >
                                            {b.text}
                                        </h4>
                                    );
                                }
                                if (b.type === "list") {
                                    return (
                                        <ul key={i} className="mb-3 list-disc space-y-1 pl-5 last:mb-0">
                                            {(b.items ?? []).map((it, j) => (
                                                <li key={j}>{it}</li>
                                            ))}
                                        </ul>
                                    );
                                }
                                return (
                                    <p key={i} className="mb-3 whitespace-pre-line last:mb-0">
                                        {b.lead && <strong className="text-foreground">{b.lead} </strong>}
                                        {b.text}
                                    </p>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="border border-dashed border-border bg-muted px-3.5 py-3 text-xs text-muted-foreground">
                            No description was captured for this role.
                        </div>
                    )}
                </div>

                <McpHandoffNote job={handoffJob} />
            </div>
        </div>
    );
}

function TrackerStatusChips({
    filter,
    counts,
    total,
    onChange,
}: {
    filter: TrackerFilter;
    counts: ReturnType<typeof countByTrackerFilter>;
    total: number;
    onChange: (f: TrackerFilter) => void;
}) {
    return (
        <div className="mb-3.5 flex flex-wrap gap-2">
            {TRACKER_CHIP_FILTERS.map(({ key, label }) => {
                const n = key === "all" ? total : counts[key];
                return (
                    <button
                        key={key}
                        type="button"
                        aria-pressed={filter === key}
                        onClick={() => onChange(key)}
                        className={cn(
                            "rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors",
                            filter === key && "border-foreground bg-foreground text-background",
                        )}
                    >
                        {label} <span className="opacity-70">{n}</span>
                    </button>
                );
            })}
        </div>
    );
}

export function CompletenessMock() {
    const [panel, setPanel] = useState<MockPanel>("jobs");
    const [selectedJobId, setSelectedJobId] = useState(MOCK_JOBS[0].id);
    const [detailOpen, setDetailOpen] = useState(false);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [authOpen, setAuthOpen] = useState(false);

    const [pursuits, setPursuits] = useState(INITIAL_PURSUITS);
    const [trackerFilter, setTrackerFilter] = useState<TrackerFilter>("all");
    const [syncBannerOpen, setSyncBannerOpen] = useState(true);
    const [trackSheetOpen, setTrackSheetOpen] = useState(false);
    const [connectTab, setConnectTab] = useState<ConnectClientId>("claude");
    const [credentials, setCredentials] = useState(INITIAL_CREDENTIALS);

    const selectedJob = MOCK_JOBS.find((j) => j.id === selectedJobId) ?? MOCK_JOBS[0];
    const activeClient = CONNECT_MOCK_CLIENTS.find((c) => c.id === connectTab)!;

    const trackerCounts = useMemo(() => countByTrackerFilter(pursuits), [pursuits]);
    const filteredPursuits = useMemo(
        () => pursuits.filter((p) => matchesTrackerFilter(p, trackerFilter)),
        [pursuits, trackerFilter],
    );

    const openJob = useCallback((id: string) => {
        setSelectedJobId(id);
        setDetailOpen(true);
    }, []);

    const handleTrackSave = async (draft: TrackRoleDraft) => {
        if (!draft.company.trim() || !draft.position.trim()) return;
        setPursuits((prev) => [
            ...prev,
            mockPursuit(`t-${Date.now()}`, draft.company.trim(), draft.position.trim(), draft.status, 0),
        ]);
        setTrackSheetOpen(false);
    };

    const revokeCredential = (id: string) => {
        setCredentials((prev) => prev.filter((c) => c.id !== id));
    };

    return (
        <div className="min-h-screen bg-background text-foreground">
            <div className={cn("border-b px-4 py-2 text-center text-xs", siteChrome.border, siteChrome.bar, siteChrome.muted)}>
                <span className="">Completeness mock — not live</span>
                {" · "}
                <Link href="/mock/auth-gate" className="text-brand underline-offset-2 hover:underline">
                    Auth-gate mock
                </Link>
                {" · "}
                <Link href="/jobs" className="text-brand underline-offset-2 hover:underline">
                    Back to jobs
                </Link>
            </div>

            <header className={cn("sticky top-0 z-40 border-b", siteChrome.bar, siteChrome.border)}>
                <div className="mx-auto flex h-16 w-full max-w-[920px] items-center justify-between px-5 sm:px-7">
                    <div className="flex items-center gap-2.5 text-[#ececec]">
                        <BrandMark className="h-10 w-10" />
                        <span className="text-lg font-semibold">velai</span>
                    </div>
                    <nav aria-label="Mock panels" className="flex items-center gap-[18px] text-xs">
                        {MOCK_PANELS.map(({ id, label }) => (
                            <button
                                key={id}
                                type="button"
                                aria-current={panel === id ? "page" : undefined}
                                onClick={() => setPanel(id)}
                                className={panel === id ? siteChrome.active : siteChrome.mutedHover}
                            >
                                {label}
                            </button>
                        ))}
                    </nav>
                </div>
            </header>

            {panel === "jobs" && (
                <div
                    className="min-h-[calc(100vh-7rem)] text-foreground"
                    style={{
                        background: "radial-gradient(900px 500px at 50% 20%, #1a1f27 0%, transparent 55%), #12151a",
                    }}
                >
                    <main className="mx-auto w-full max-w-[920px] px-4 pb-20 pt-7 sm:px-5">
                        <section className="rounded-none border-0 bg-muted p-3">
                            <div className="flex flex-wrap gap-2">
                                <Input
                                    readOnly
                                    defaultValue="product manager"
                                    aria-label="Role search"
                                    className="h-[46px] min-w-[260px] flex-[1_1_260px] rounded-none border-0 bg-black px-3.5 text-base md:text-sm text-[#ececec] shadow-none placeholder:text-[#5c636e] focus-visible:border-0 focus-visible:bg-black focus-visible:ring-0"
                                />
                                <Input
                                    readOnly
                                    defaultValue="Remote"
                                    aria-label="Location search"
                                    className="h-[46px] max-w-[200px] flex-[0_1_200px] rounded-none border-0 bg-black px-3.5 text-base md:text-sm text-[#ececec] shadow-none placeholder:text-[#5c636e] focus-visible:border-0 focus-visible:bg-black focus-visible:ring-0"
                                />
                                <Button className="h-[46px] rounded-none bg-[#ececec] px-[18px] text-xs font-semibold text-[#12151a] hover:opacity-90">
                                    Search
                                </Button>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
                                <button
                                    type="button"
                                    aria-expanded={filtersOpen}
                                    onClick={() => setFiltersOpen((v) => !v)}
                                    className={cn(
                                        "rounded-none border-0 bg-black px-3 py-1.5 text-xs text-[#ececec]",
                                        filtersOpen && "bg-[#ececec] text-[#12151a]",
                                    )}
                                >
                                    Filters · 3
                                </button>
                                <span className="text-xs text-[#8b919a]">Remote · Past month · Hide stale</span>
                            </div>
                            {filtersOpen && (
                                <div className="panel-enter mt-3 rounded-none border-0 bg-black p-4 text-xs text-[#ececec]">
                                    Active filters shown above — mock only, not wired to search.
                                </div>
                            )}
                        </section>

                        <div className="mt-9">
                            <div className="mb-3">
                                <span data-testid="result-line" className="text-xs text-muted-foreground tabular-nums">
                                    {TOTAL_ROLES.toLocaleString()} roles
                                </span>
                            </div>
                            <div id="jobs-results-list" role="listbox" aria-label="Job results">
                                {MOCK_JOBS.map((job) => (
                                    <MockJobRow
                                        key={job.id}
                                        job={job}
                                        active={selectedJobId === job.id && detailOpen}
                                        onClick={() => openJob(job.id)}
                                    />
                                ))}
                            </div>
                        </div>
                    </main>
                </div>
            )}

            {panel === "tracker" && (
                <main className="mx-auto w-full max-w-[920px] px-5 pb-16 pt-6 sm:px-7">
                    <PageHeader
                        size="display"
                        fullWidth
                        sticky={false}
                        title="Tracker"
                        description="Your records — not submissions. Agent drafts still stop before send."
                        actions={
                            <Button size="sm" onClick={() => setTrackSheetOpen(true)}>
                                Track a role
                            </Button>
                        }
                    />
                    <TrackerStatusChips
                        filter={trackerFilter}
                        counts={trackerCounts}
                        total={pursuits.length}
                        onChange={setTrackerFilter}
                    />
                    {syncBannerOpen && (
                        <div className="mb-3.5 flex items-center justify-between rounded-none border border-border bg-muted px-4 py-2.5 text-sm text-foreground">
                            <span>Synced 2 guest roles after you signed in</span>
                            <button
                                type="button"
                                onClick={() => setSyncBannerOpen(false)}
                                className="text-muted-foreground hover:text-foreground"
                                aria-label="Dismiss"
                            >
                                ×
                            </button>
                        </div>
                    )}
                    {filteredPursuits.length === 0 ? (
                        <div className="px-2 py-9 text-sm text-muted-foreground">
                            Nothing in this lane.{" "}
                            <Button variant="outline" size="sm" className="ml-1.5 h-8" onClick={() => setTrackSheetOpen(true)}>
                                Track a role
                            </Button>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-2">
                            {filteredPursuits.map((p) => (
                                <PursuitListRow key={p.id} pursuit={p} onClick={() => {}} />
                            ))}
                        </div>
                    )}
                </main>
            )}

            {panel === "connect" && (
                <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
                    <h1 className="font-display text-display font-semibold text-foreground">
                        Your AI already knows how to job hunt. Give it the real market.
                    </h1>
                    <p className="mt-3 max-w-xl text-sm text-muted-foreground">
                        Pair velai with the AI client you already use through MCP, and let it search and track verified job
                        listings for you.
                    </p>
                    <div data-testid="connect-tabs" role="tablist" aria-label="AI client" className="mt-8 flex gap-2 overflow-x-auto">
                        {CONNECT_MOCK_CLIENTS.map((client) => (
                            <button
                                key={client.id}
                                type="button"
                                role="tab"
                                aria-selected={connectTab === client.id}
                                onClick={() => {
                                    setConnectTab(client.id);
                                    const handoff = handoffClientFromConnectTab(client.id);
                                    if (handoff) saveHandoffClient(handoff);
                                }}
                                className={cn(
                                    "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-none border px-4 py-2 text-sm transition",
                                    connectTab === client.id
                                        ? "border-foreground bg-foreground text-background"
                                        : "border-border text-foreground hover:border-foreground",
                                )}
                            >
                                {client.label}
                            </button>
                        ))}
                    </div>
                    <div className="mt-6 space-y-6">
                        <div className="rounded-none border border-border p-6">
                            <p className="text-xs font-semibold text-foreground">1 · Connect</p>
                            <p className="mt-3 text-sm text-foreground">{STEP1_INTRO[connectTab]}</p>
                            {activeClient.supportsDirectConnect && (
                                <div className="mt-3">
                                    <CopyUrlBar />
                                </div>
                            )}
                        </div>
                        <div className="rounded-none border border-border p-6">
                            <p className="text-xs font-semibold text-foreground">2 · Approve</p>
                            <p className="mt-3 text-sm text-foreground">Approve once — you&apos;re paired.</p>
                            <ul className="mt-3 space-y-1.5 text-sm">
                                <li className="flex items-start gap-2 text-brand">
                                    <span aria-hidden>✓</span>
                                    <span>Search verified jobs for you</span>
                                </li>
                                <li className="flex items-start gap-2 text-brand">
                                    <span aria-hidden>✓</span>
                                    <span>File jobs you approve to your tracker</span>
                                </li>
                                <li className="flex items-start gap-2 text-foreground">
                                    <span aria-hidden>✗</span>
                                    <span>It can never apply anywhere without you</span>
                                </li>
                            </ul>
                        </div>
                    </div>
                    <section className="mt-10 rounded-none border-2 border-foreground p-6 sm:p-8">
                        <h2 className="text-lg font-semibold text-foreground">Try these first</h2>
                        <ul className="mt-3 space-y-2">
                            {CONNECT_PROMPTS.map((prompt) => (
                                <li key={prompt} className="text-sm italic text-foreground">
                                    &ldquo;{prompt}&rdquo;
                                </li>
                            ))}
                        </ul>
                    </section>
                    <p className="mt-6 max-w-xl text-xs text-muted-foreground">
                        Revocable any time in settings. Your AI&apos;s subscription does the thinking — velai provides the data.
                    </p>
                </main>
            )}

            {panel === "settings" && (
                <main className="mx-auto w-full max-w-[920px] px-5 py-10 sm:px-7">
                    <section className="border-t border-border pt-6">
                        <h2 className="mb-1 text-lg font-semibold">Connected agents</h2>
                        <p className="mb-4 text-sm text-muted-foreground">
                            Let Claude or another AI agent search jobs and update your tracker on your behalf.
                        </p>
                        {credentials.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                No agents connected yet.{" "}
                                <button
                                    type="button"
                                    onClick={() => setPanel("connect")}
                                    className="text-brand underline underline-offset-2 hover:text-brand"
                                >
                                    Pair one from Connect.
                                </button>
                            </p>
                        ) : (
                            <div className="space-y-2">
                                {credentials.map((cred) => (
                                    <div
                                        key={cred.id}
                                        className="flex items-center justify-between gap-4 rounded-lg border border-border p-3"
                                    >
                                        <div className="min-w-0">
                                            <p className="truncate text-sm">{cred.name}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {cred.kind} · connected {cred.connected} · last used {cred.lastUsed}
                                            </p>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 shrink-0 px-2.5 text-xs text-muted-foreground hover:text-destructive"
                                            onClick={() => revokeCredential(cred.id)}
                                        >
                                            <Trash size={13} />
                                            Revoke
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                </main>
            )}

            <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
                <SheetContent
                    side="bottom"
                    hideCloseButton
                    overlayClassName="bg-[rgba(18,21,26,0.42)]"
                    className="left-1/2 flex max-h-[min(88dvh,760px)] w-full max-w-[720px] -translate-x-1/2 flex-col overflow-hidden rounded-t-[18px] border border-border border-b-0 p-0"
                >
                    <div className="flex shrink-0 justify-center py-2.5 pt-2.5" aria-hidden>
                        <span className="h-1 w-9 rounded-full bg-[#d0d6de]" />
                    </div>
                    <SheetTitle className="sr-only">
                        {decodeText(selectedJob.title)} at {cleanCompany(selectedJob.company)}
                    </SheetTitle>
                    <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
                        <MockJobDetail
                            key={selectedJob.id}
                            job={selectedJob}
                            onSignIn={() => setAuthOpen(true)}
                            onClose={() => setDetailOpen(false)}
                        />
                    </div>
                </SheetContent>
            </Sheet>

            <TrackRoleSheet open={trackSheetOpen} onOpenChange={setTrackSheetOpen} onSave={handleTrackSave} />

            <AuthPopover
                open={authOpen}
                onOpenChange={setAuthOpen}
                showTrigger={false}
                trigger="user"
                valueLine={
                    <>
                        <b className="text-foreground">Create a free account</b> — save roles to your tracker and sync across
                        devices.
                    </>
                }
            />
        </div>
    );
}
