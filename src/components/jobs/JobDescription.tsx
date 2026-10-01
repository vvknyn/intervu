"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { formatDescription, type DescBlock } from "@/lib/jobs/format-description";
import { labelDescriptionOnDevice, layOutWithModelLetters } from "@/lib/local-ai/label-description";
import { localAiTaskReady, type LocalAiTaskPriority } from "@/lib/local-ai/run-task";

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

export type DescriptionLayoutSource = "rules" | "device";

/**
 * The rules' layout at once (and on the server), then — where local AI is on
 * — the on-device model's line labels once they arrive (cached per device, so
 * a posting it has seen lays out right on the first paint after mount).
 * `background` queues the model call behind whatever the person is looking
 * at; switching to `visible` moves it up.
 */
export function useFormattedDescription(
    description: string | null | undefined,
    priority: LocalAiTaskPriority = "visible",
): {
    blocks: DescBlock[];
    source: DescriptionLayoutSource;
} {
    const rules = useMemo(() => formatDescription(description), [description]);
    const [device, setDevice] = useState<{ description: string; blocks: DescBlock[] } | null>(null);

    useEffect(() => {
        if (!description?.trim() || !localAiTaskReady()) return;
        const controller = new AbortController();
        void labelDescriptionOnDevice({ description, priority, signal: controller.signal }).then((letters) => {
            if (controller.signal.aborted || !letters) return;
            const laidOut = layOutWithModelLetters(description, letters);
            if (laidOut.changed) setDevice({ description, blocks: laidOut.blocks });
        });
        return () => controller.abort();
    }, [description, priority]);

    const current = device?.description === description ? device : null;
    return { blocks: current?.blocks ?? rules, source: current ? "device" : "rules" };
}

/**
 * A job's description as every job surface shows it: the formatted layout,
 * and — when the on-device model moved lines around — a line saying so with
 * a switch to the text exactly as it was captured, so nobody has to trust a
 * layout they can't check.
 */
export function FormattedJobDescription({
    description,
    headingLevel,
    priority,
}: {
    description: string | null | undefined;
    headingLevel: 3 | 4;
    priority?: LocalAiTaskPriority;
}) {
    const { blocks, source } = useFormattedDescription(description, priority);
    const [originalFor, setOriginalFor] = useState<string | null>(null);
    const showOriginal = source === "device" && originalFor === description;

    return (
        <div data-testid="job-description-body" data-layout={source}>
            {showOriginal ? (
                <p className="whitespace-pre-line text-base leading-relaxed text-inherit" data-testid="job-description-original">
                    {description}
                </p>
            ) : (
                <JobDescription blocks={blocks} headingLevel={headingLevel} />
            )}
            {source === "device" && (
                <p className="mt-5 text-sm text-muted-foreground">
                    Laid out on your device.{" "}
                    <button
                        type="button"
                        className="cursor-pointer underline underline-offset-2 hover:text-inherit"
                        aria-pressed={showOriginal}
                        onClick={() => setOriginalFor(showOriginal ? null : (description ?? null))}
                    >
                        {showOriginal ? "Show formatted" : "Show original text"}
                    </button>
                </p>
            )}
        </div>
    );
}
