"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { formatDescription, type DescBlock } from "@/lib/jobs/format-description";

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
                    return (
                        <HeadingTag
                            key={i}
                            className={cn(
                                "mb-2 mt-7 font-semibold leading-snug text-inherit first:mt-0",
                                b.fine ? "text-sm text-muted-foreground" : "text-base",
                            )}
                        >
                            {b.text}
                        </HeadingTag>
                    );
                }
                if (b.type === "list") {
                    return (
                        <ul
                            key={i}
                            className={cn(
                                "mb-4 list-disc space-y-2 pl-5 marker:text-muted-foreground last:mb-0",
                                b.fine && "text-sm leading-normal text-muted-foreground",
                            )}
                        >
                            {(b.items ?? []).map((it, j) => (
                                <li key={j} className="pl-1">
                                    {it}
                                </li>
                            ))}
                        </ul>
                    );
                }
                return (
                    <p
                        key={i}
                        className={cn(
                            "mb-4 whitespace-pre-line last:mb-0",
                            b.fine && "text-sm leading-normal text-muted-foreground",
                        )}
                    >
                        {b.lead && <strong className="font-semibold text-inherit">{b.lead} </strong>}
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
