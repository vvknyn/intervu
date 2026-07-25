import Link from "next/link";
import { TailoredResumeVersion, RecommendationPriority } from "@/types/resume";

interface TailoringSidebarCardProps {
    /** The selected tailored version, or undefined when the base resume is active. */
    version: TailoredResumeVersion | undefined;
}

/** Priority → token color, pure and local: this card is the one new token-only
 * surface in the hub, so it doesn't borrow resume-tailor's raw-Tailwind-color
 * getPriorityColor (that page keeps its existing palette this pass — see
 * PORTAL-REDESIGN-SPEC.md, "/resume-tailor itself: tokens/shell inheritance
 * only"). */
function priorityDotClass(priority: RecommendationPriority): string {
    switch (priority) {
        case "high":
            return "bg-destructive";
        case "medium":
            return "bg-warn-dot";
        case "low":
            return "bg-muted-foreground";
    }
}

/**
 * Sidebar: real stored TailoringRecommendations for the selected version, or
 * a plain prompt when there are none to show. CUT vs. the mock: keyword-match
 * %, missing-keyword chips, and the whole "ATS scan" card — none of those
 * fields exist on TailoredResumeVersion (PORTAL-REDESIGN-SPEC.md).
 */
export function TailoringSidebarCard({ version }: TailoringSidebarCardProps) {
    const recommendations = version?.recommendations ?? [];

    return (
        <div className="rounded-xl border border-border bg-card p-5" data-testid="resume-tailoring-card">
            <div className="font-display text-base font-semibold">Tailoring</div>

            {version ? (
                <div className="mt-1 font-mono text-[11.5px] text-muted-foreground">
                    vs. {version.positionTitle} @ {version.companyName}
                </div>
            ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                    Select a tailored version to see its recommendations, or start a new one.
                </p>
            )}

            {recommendations.length > 0 && (
                <div className="mt-4 flex flex-col gap-3">
                    {recommendations.map((rec) => (
                        <div key={rec.id} className="flex items-start gap-2.5">
                            <span
                                className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${priorityDotClass(rec.priority)}`}
                            />
                            <div className="min-w-0">
                                <div className="text-sm font-medium text-foreground">{rec.title}</div>
                                {rec.reasoning && (
                                    <div className="mt-0.5 text-xs text-muted-foreground">{rec.reasoning}</div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {version && recommendations.length === 0 && (
                <p className="mt-3 text-sm text-muted-foreground">
                    No stored recommendations for this version.
                </p>
            )}

            <Link
                href="/resume-tailor"
                data-testid="resume-open-tailor"
                className="mt-4 block rounded-md border-[1.5px] border-foreground py-2.5 text-center text-[13px] font-semibold transition-colors hover:bg-foreground hover:text-background"
            >
                Open tailor →
            </Link>
        </div>
    );
}
