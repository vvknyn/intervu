"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { formatDescription, type DescBlock } from "@/lib/jobs/format-description";

const LEADING_EMOJI_RE = /^[\p{Extended_Pictographic}\u2600-\u27BF]/u;

/**
 * Contextual emoji marker for a job-description section heading. Gives every
 * posting an approachable, scannable visual rhythm without mutating the
 * underlying `DescBlock.text` contract tested by `format-description-layout`.
 */
export function headingEmoji(text: string | undefined, fine?: boolean): string {
    const raw = (text ?? "").trim();
    if (!raw || LEADING_EMOJI_RE.test(raw)) return "";
    if (fine) return "⚖️";
    const lower = raw.toLowerCase().replace(/[:.!?]+$/, "").trim();

    if (
        lower === "about the role" ||
        lower === "about this role" ||
        lower === "the role" ||
        lower === "your role" ||
        lower === "role overview" ||
        lower === "overview" ||
        lower === "summary" ||
        lower === "position summary" ||
        lower === "job summary" ||
        lower === "position purpose" ||
        lower === "the opportunity" ||
        lower === "job description"
    ) {
        return "✨";
    }
    if (
        lower === "about us" ||
        lower === "about the company" ||
        lower === "about the team" ||
        lower === "the company" ||
        lower === "the team" ||
        lower === "company description" ||
        lower === "who we are" ||
        lower === "our mission" ||
        lower.startsWith("about ")
    ) {
        return "🏢";
    }
    if (
        lower.includes("responsibilit") ||
        lower.includes("what you'll do") ||
        lower.includes("what you\u2019ll do") ||
        lower.includes("what you will do") ||
        lower.includes("what you'll be doing") ||
        lower.includes("your impact") ||
        lower.includes("essential function") ||
        lower.includes("essential dut") ||
        lower === "duties" ||
        lower.includes("success looks like") ||
        lower.includes("job entail")
    ) {
        return "🎯";
    }
    if (
        lower.includes("nice to have") ||
        lower.includes("preferred") ||
        lower.includes("bonus")
    ) {
        return "🌱";
    }
    if (
        lower.includes("qualificat") ||
        lower.includes("requirement") ||
        lower.includes("what you bring") ||
        lower.includes("what you'll bring") ||
        lower.includes("what you\u2019ll bring") ||
        lower.includes("what you will bring") ||
        lower.includes("should bring") ||
        lower.includes("looking for") ||
        lower === "who you are" ||
        lower === "your background" ||
        lower.includes("skill") ||
        lower.includes("experience") ||
        lower.includes("education")
    ) {
        return "🧠";
    }
    if (
        lower.includes("compensation") ||
        lower.includes("salary") ||
        lower.includes("pay range") ||
        lower === "pay"
    ) {
        return "💰";
    }
    if (
        lower.includes("benefit") ||
        lower.includes("perk") ||
        lower.includes("what we offer") ||
        lower.includes("our offer")
    ) {
        return "🎁";
    }
    if (
        lower.includes("why join") ||
        lower.includes("values") ||
        lower.includes("culture")
    ) {
        return "🚀";
    }
    if (
        lower.includes("location") ||
        lower.includes("work environment")
    ) {
        return "📍";
    }
    if (
        lower.includes("job type") ||
        lower.includes("employment type") ||
        lower.includes("vacancy") ||
        lower.includes("schedule") ||
        lower.includes("clearance") ||
        lower.includes("additional information")
    ) {
        return "📋";
    }
    return "📌";
}

export function leadEmoji(lead: string | undefined, fine?: boolean): string {
    const raw = (lead ?? "").trim();
    if (!raw || fine || LEADING_EMOJI_RE.test(raw)) return "";
    const lower = raw.toLowerCase().replace(/[:.!?]+$/, "").trim();
    if (lower.includes("location") || lower.includes("workplace") || lower.includes("office")) return "📍";
    if (lower.includes("compensation") || lower.includes("salary") || lower.includes("pay")) return "💰";
    if (lower.includes("benefit") || lower.includes("perk")) return "🎁";
    if (lower.includes("role") || lower.includes("summary") || lower.includes("overview")) return "✨";
    if (lower.includes("responsibilit") || lower.includes("duties")) return "🎯";
    if (lower.includes("requirement") || lower.includes("qualificat") || lower.includes("skill")) return "🧠";
    if (lower.includes("schedule") || lower.includes("hours") || lower.includes("type") || lower.includes("status")) return "📋";
    return "";
}

/** Render structured description blocks (heading / para / list). Descriptions
 *  arrive flattened from the Subspace feed; `formatDescription` reconstructs
 *  the structure. See lib/jobs/format-description.ts.
 *
 *  Reading rhythm: section headings at the sub-heading step with room above
 *  them, 1rem between blocks, list items spaced apart with quiet markers, and
 *  equal-opportunity / agency boilerplate (`fine`) a step smaller and muted.
 *  Ink is inherited, never pinned, so postcard paper and the canvas each
 *  supply their own (tests/unit/surface-postcard-ink-rebind.test.ts).
 *
 *  `headingLevel` is the caller's own "About this role" section-heading
 *  level + 1 — these headings ("Key Responsibilities" etc.) sit one level
 *  under it in the outline, so each mount passes what keeps that true: the
 *  inline pane/sheet (JobDetail.tsx, "About this role" = h3) passes 4, the
 *  standalone document (JobDetailDocument.tsx, "About this role" = h2)
 *  passes 3. No default — a heading level is never a safe guess. */
export function JobDescription({ blocks, headingLevel }: { blocks: DescBlock[]; headingLevel: 3 | 4 }) {
    const HeadingTag = `h${headingLevel}` as const;
    return (
        <div className="text-base leading-relaxed text-inherit text-pretty">
            {blocks.map((b, i) => {
                if (b.type === "heading") {
                    const icon = headingEmoji(b.text, b.fine);
                    return (
                        <HeadingTag
                            key={i}
                            className={cn(
                                "mb-2.5 mt-6 flex items-baseline gap-2 border-t border-border pt-4 font-semibold leading-snug text-inherit first:mt-0 first:border-t-0 first:pt-0",
                                b.fine ? "text-sm text-muted-foreground" : "text-base",
                            )}
                        >
                            {icon ? (
                                <span aria-hidden className="shrink-0 select-none">
                                    {icon}
                                </span>
                            ) : null}
                            <span>{b.text}</span>
                        </HeadingTag>
                    );
                }
                if (b.type === "list") {
                    return (
                        <ul
                            key={i}
                            className={cn(
                                "mb-4 list-disc space-y-2 pl-5 marker:text-live last:mb-0",
                                b.fine && "text-sm leading-normal text-muted-foreground marker:text-muted-foreground",
                            )}
                        >
                            {(b.items ?? []).map((it, j) => (
                                <li key={j} className="pl-1 leading-relaxed">
                                    {it}
                                </li>
                            ))}
                        </ul>
                    );
                }
                const inlineIcon = leadEmoji(b.lead, b.fine);
                return (
                    <p
                        key={i}
                        className={cn(
                            "mb-4 whitespace-pre-line last:mb-0",
                            b.fine && "text-sm leading-normal text-muted-foreground",
                        )}
                    >
                        {b.lead && (
                            <strong className="font-semibold text-inherit">
                                {inlineIcon ? (
                                    <span aria-hidden className="mr-1.5 select-none">
                                        {inlineIcon}
                                    </span>
                                ) : null}
                                {b.lead}{" "}
                            </strong>
                        )}
                        {b.text}
                    </p>
                );
            })}
        </div>
    );
}

/**
 * A job's description as every job surface shows it: the rules' layout
 * (lib/jobs/format-description.ts), the same on the server and in the browser.
 * No model lays it out (Vivek 2026-10-11 removed the on-device models), so the
 * words are always the posting's own, in its own order.
 */
export function FormattedJobDescription({
    description,
    headingLevel,
}: {
    description: string | null | undefined;
    headingLevel: 3 | 4;
}) {
    const blocks = useMemo(() => formatDescription(description), [description]);
    return (
        <div data-testid="job-description-body" data-layout="rules">
            <JobDescription blocks={blocks} headingLevel={headingLevel} />
        </div>
    );
}
