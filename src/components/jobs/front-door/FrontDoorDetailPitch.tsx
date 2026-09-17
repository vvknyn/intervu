"use client";

import Link from "next/link";
import { PostingCheckSignalsGrid } from "@/components/jobs/JobDetail";
import { GHOST_CHECK_TAGLINE, REPRESENTATIVE_GHOST_SIGNALS } from "@/components/jobs/job-detail-facts";
import { VARIANT_COPY } from "@/components/mcp/McpHandoffNote";
import { RESUME_UPLOAD_SIGNIN_LINE } from "@/lib/jobs/resume-cta-copy";
import { FOOTER_PROVENANCE_LINE, GHOST_RESEARCH_HREF, GHOST_SCREENING_CLAUSE } from "@/lib/marketing-stats";
import { cn } from "@/lib/utils";

/**
 * Fills the desktop detail pane at rest (requirement 3) instead of a
 * pre-selected row's JobDetail, or the plain "Select a role…" placeholder
 * it replaces here. No job is open yet, so this "pitches" what the pane
 * does once one is — reusing the SAME copy/data those real surfaces use,
 * never inventing new marketing claims:
 *  - `FOOTER_PROVENANCE_LINE` — the site footer's own provenance line,
 *    same split-on-`GHOST_SCREENING_CLAUSE`-and-link convention
 *    (Footer.tsx) so the linked claim isn't duplicated as plain text here.
 *  - "Posting check" — `REPRESENTATIVE_GHOST_SIGNALS`, a literal subset of
 *    what `deriveGhostSignals` actually emits (job-detail-facts.ts), with
 *    the same glyph + `<b className="capitalize">{s.kind}</b>` convention
 *    JobDetail.tsx uses for a real job's signals — just without that
 *    panel's relist/age-note branches, which need a real `PublicJob`.
 *  - "Connect AI" — `VARIANT_COPY.intelligence` (McpHandoffNote.tsx) text
 *    only: that component's own bordered/boxed JSX is the wrong weight for
 *    a quiet at-rest pane (requirement 5), so only its copy is reused, not
 *    its markup.
 *  - "Sign in" — `RESUME_UPLOAD_SIGNIN_LINE`, the same line the front-door
 *    band (FrontDoorResumeBand.tsx) states below.
 * Requirement 5 (one filled action per screen at rest): every link/button
 * here is plain underlined text — nothing filled or bordered-as-a-button.
 */
export function FrontDoorDetailPitch({ onSignInClick }: { onSignInClick: () => void }) {
    const intelligence = VARIANT_COPY.intelligence;
    return (
        <div className="divide-y divide-border p-6 text-sm text-foreground" data-testid="detail-pane-placeholder">
            <div className="pb-4 text-xs text-muted-foreground">
                {FOOTER_PROVENANCE_LINE.split(GHOST_SCREENING_CLAUSE).map((part, i, parts) => (
                    <span key={i}>
                        {part}
                        {i < parts.length - 1 && (
                            <Link
                                href={GHOST_RESEARCH_HREF}
                                className="underline underline-offset-2 hover:text-foreground"
                            >
                                {GHOST_SCREENING_CLAUSE}
                            </Link>
                        )}
                    </span>
                ))}
            </div>

            <div className="py-4">
                <p className="text-xs font-semibold text-muted-foreground">Posting check</p>
                <PostingCheckSignalsGrid>
                    {REPRESENTATIVE_GHOST_SIGNALS.map((s) => (
                        <div key={s.text} className="flex items-start gap-2">
                            <span
                                className={cn(
                                    "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-sm font-semibold",
                                    s.status === "favorable" ? "text-live" : "text-muted-foreground",
                                )}
                                aria-hidden
                            >
                                {s.status === "favorable" ? "✓" : s.status === "unfavorable" ? "—" : null}
                            </span>
                            <div className="min-w-0 flex-1 leading-snug">
                                <b className="capitalize">{s.kind}</b> <span className="text-muted-foreground">{s.text}</span>
                            </div>
                        </div>
                    ))}
                </PostingCheckSignalsGrid>
                <p className="pt-3 text-xs text-muted-foreground">{GHOST_CHECK_TAGLINE}</p>
            </div>

            <div className="py-4">
                <p className="text-xs font-semibold text-muted-foreground">{intelligence.heading}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                    {intelligence.sentence}{" "}
                    <Link
                        href="/connect"
                        className="font-semibold text-brand underline underline-offset-4 hover:text-brand"
                    >
                        Connect it once
                    </Link>
                </p>
            </div>

            <div className="pt-4 text-sm text-muted-foreground">
                {RESUME_UPLOAD_SIGNIN_LINE}{" "}
                <button
                    type="button"
                    onClick={onSignInClick}
                    className="font-semibold text-brand underline underline-offset-4 hover:text-brand"
                >
                    Sign in
                </button>
            </div>
        </div>
    );
}
