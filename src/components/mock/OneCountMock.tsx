"use client";

import { VisitSince } from "@/components/jobs/BoardVisitBanner";
import { RecommendedListNotes } from "@/components/jobs/for-you/RecommendedListNotes";
import { deckListFor, withListRemovals } from "@/lib/jobs/for-you/band-order";
import { collapseByEmployer } from "@/lib/jobs/for-you/employer-slot";
import { formatHubFitLine } from "@/lib/jobs/for-you/left-out-copy";
import type { PublicJob } from "@/lib/jobs/types";
import type { MatchScore } from "@/lib/match/score";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const DAY = 86_400_000;
const job = (id: string, employer: string, ageDays: number): PublicJob =>
    ({ id, title: "Product Manager", company: employer, company_domain: `${employer}.com`, apply_url: "/apply", posted_at: new Date(NOW - ageDays * DAY).toISOString() }) as PublicJob;
const score = (total: number, extra: Partial<MatchScore> = {}): MatchScore => ({ total, role: "own", components: [{ key: "relevance", label: "Relevance", detail: "t", score: total / 100 }], ...extra });

type Rows = { job: PublicJob; score: MatchScore }[];
const ABROAD = { components: [{ key: "relevance", label: "Relevance", detail: "t", score: 0.9 }, { key: "location", label: "Location", detail: "t", score: 0.1, reason: "remote_abroad" }] } as Partial<MatchScore>;

/** 37 fit roles, 12 ranked lower (a level cut), 5 left out (older than the window), at 30 employers. */
function fitRows(): Rows {
    const rows: Rows = [];
    for (let i = 0; i < 37; i++) rows.push({ job: job(`fit-${i}`, `fit${i % 30}`, 3), score: score(90) });
    for (let i = 0; i < 12; i++) rows.push({ job: job(`lvl-${i}`, `lvl${i % 6}`, 3), score: score(85, { newToManaging: true } as Partial<MatchScore>) });
    for (let i = 0; i < 5; i++) rows.push({ job: job(`old-${i}`, `old${i}`, 60), score: score(90) });
    return rows;
}

/** Nothing fits: 3 weaker fits lead, 9 roles abroad rank lower (so the tail is not "the closest"). */
function nearRows(): Rows {
    const rows: Rows = [];
    for (let i = 0; i < 3; i++) rows.push({ job: job(`weak-${i}`, `weak${i}`, 3), score: score(50) });
    for (let i = 0; i < 9; i++) rows.push({ job: job(`abr-${i}`, `abr${i % 4}`, 3), score: score(50, ABROAD) });
    return rows;
}

function fixture(rows: Rows) {
    const byId = new Map(rows.map((r) => [r.job.id, r.score] as const));
    const { ranked, lower, summary } = deckListFor(rows.map((r) => r.job), (j) => byId.get(j.id) ?? null, NOW);
    return { slots: collapseByEmployer([...ranked, ...lower], (j) => j), summary: withListRemovals(summary, {}) };
}

const rowClass = "mb-3 flex flex-wrap items-center justify-between gap-3 px-[var(--list-inset)] pb-2 text-sm text-muted-foreground";
const Alert = () => (
    <span data-testid="mock-job-alert" className="flex items-center gap-2 text-foreground">
        Job alert <span aria-hidden className="inline-block h-5 w-9 rounded-pill bg-muted" />
    </span>
);

/** The two list heads as `JobsContent` builds them: the ranked one from `formatHubFitLine`, the Freshest one with its quiet visit suffix. */
export function OneCountMock() {
    const { slots, summary } = fixture(fitRows());
    const near = fixture(nearRows());
    return (
        <main className="mx-auto max-w-3xl space-y-10 py-8">
            <section data-testid="mock-ranked">
                <div className={rowClass}>
                    <div className="flex flex-wrap items-center gap-2">
                        <span data-testid="result-line" className="font-semibold text-foreground tabular-nums">
                            {formatHubFitLine(summary)}
                        </span>
                    </div>
                    <Alert />
                </div>
                <RecommendedListNotes summary={summary} employers={slots.length} onInclude={() => undefined} />
            </section>
            <section data-testid="mock-near">
                <div className={rowClass}>
                    <div className="flex flex-wrap items-center gap-2">
                        <span data-testid="result-line" className="font-semibold text-foreground tabular-nums">
                            {formatHubFitLine(near.summary)}
                        </span>
                    </div>
                    <Alert />
                </div>
                <RecommendedListNotes summary={near.summary} employers={near.slots.length} onInclude={() => undefined} />
            </section>
            <section data-testid="mock-fresh">
                <div className={rowClass}>
                    <div className="flex flex-wrap items-center gap-2">
                        <span data-testid="result-line" className="font-semibold text-foreground tabular-nums">
                            712 roles from the last 90 days · updated 3h ago
                        </span>
                        <VisitSince count={{ kind: "exact", value: 565 }} />
                    </div>
                    <Alert />
                </div>
            </section>
        </main>
    );
}
