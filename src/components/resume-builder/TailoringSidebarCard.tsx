import Link from "next/link";
import { TailoredResumeVersion, RecommendationPriority } from "@/types/resume";

interface TailoringSidebarCardProps {
    /** The selected tailored version, or undefined when the base resume is active. */
    version: TailoredResumeVersion | undefined;
}

/**
 * Priority → verdict-channel glyph + tone (editorial pass spec: "▲ high in
 * risk/caution ink, — low in muted", no progress bars, no colored dots).
 * `medium` reads as the same ▲ glyph in the caution tone, one step down from
 * `high`'s risk tone — the two-tier dot scale the mock used (destructive /
 * warn / muted) collapses onto the ledger's existing tone vocabulary rather
 * than inventing a third color.
 */
function priorityGlyph(priority: RecommendationPriority): { glyph: string; cls: string } {
    switch (priority) {
        case "high":
            return { glyph: "▲", cls: "text-verdict-risk" };
        case "medium":
            return { glyph: "▲", cls: "text-verdict-caution" };
        case "low":
            return { glyph: "—", cls: "text-muted-foreground" };
    }
}

/**
 * Rail "Tailoring" section (editorial pass: a ruled section, same shape as
 * PipelineCard/GhostRadarCard — border-t border-foreground + mono
 * micro-label). Real stored TailoringRecommendations for the selected
 * version, or a plain prompt when there are none to show. CUT vs. the mock:
 * keyword-match %, missing-keyword chips, and the whole "ATS scan" card —
 * none of those fields exist on TailoredResumeVersion (PORTAL-REDESIGN-SPEC.md).
 */
export function TailoringSidebarCard({ version }: TailoringSidebarCardProps) {
    const recommendations = version?.recommendations ?? [];

    return (
        <div className="border-t border-border pt-2.5" data-testid="resume-tailoring-card">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Tailoring</span>

            {version ? (
                <p className="mt-2 font-mono text-[12.5px] text-foreground">
                    vs. {version.positionTitle} @ {version.companyName}
                </p>
            ) : (
                <p className="mt-2 text-[13px] text-muted-foreground">
                    Select a tailored version to see its recommendations, or{" "}
                    <Link href="/resume-tailor" className="text-foreground underline underline-offset-2 hover:opacity-70">
                        start a new one
                    </Link>
                    .
                </p>
            )}

            {recommendations.length > 0 && (
                <div className="mt-3 flex flex-col gap-2.5">
                    {recommendations.map((rec) => {
                        const { glyph, cls } = priorityGlyph(rec.priority);
                        return (
                            <div key={rec.id} className="flex items-start gap-2">
                                <span className={`font-mono text-[12px] ${cls}`}>{glyph}</span>
                                <div className="min-w-0">
                                    <div className="text-[13px] font-medium text-foreground">{rec.title}</div>
                                    {rec.reasoning && (
                                        <div className="mt-0.5 text-[12px] text-muted-foreground">{rec.reasoning}</div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {version && recommendations.length === 0 && (
                <p className="mt-3 text-[13px] text-muted-foreground">
                    No stored recommendations for this version.
                </p>
            )}

            <Link
                href="/resume-tailor"
                data-testid="resume-open-tailor"
                className="mt-4 inline-block font-mono text-[12px] text-foreground underline underline-offset-2 transition-colors duration-100 hover:opacity-70"
            >
                open tailor →
            </Link>
        </div>
    );
}
