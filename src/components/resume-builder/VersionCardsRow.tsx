"use client";

import { useState } from "react";
import Link from "next/link";
import { TailoredResumeVersion } from "@/types/resume";
import { formatRelativeAge } from "@/lib/jobs/freshness";
import { chipVariants } from "@/components/ui/chip";
import { cn } from "@/lib/utils";

interface VersionCardsRowProps {
    versions: TailoredResumeVersion[];
    /** undefined = base resume is the active view. */
    activeVersionId?: string;
}

/**
 * Shared chip shape for the base-resume entry and each tailored version
 * (docs-mockup.html Comp D — "version chips row (active = green-tint chip)").
 * Reuses the app-wide `chipVariants` (THE RULES #1/#5) rather than the
 * ruled-list-row this replaces, so the active version reads as "on" the
 * same way an active filter chip does everywhere else. Navigational, not
 * dismissible — there is no version-delete affordance to wire a chip "×" to.
 */
function VersionChip({
    href,
    testId,
    active,
    name,
    meta,
}: {
    href: string;
    testId: string;
    active: boolean;
    name: string;
    meta?: string;
}) {
    return (
        <Link href={href} data-testid={testId} className={chipVariants({ active })}>
            <span className={cn("truncate", active && "font-semibold")}>{name}</span>
            {meta && <span className="mono-data shrink-0 text-[11px] text-muted-foreground">{meta}</span>}
        </Link>
    );
}

/**
 * The hub's version-switcher: the base resume + one row per real tailored
 * version + a "+ new version" text link into /resume-tailor. No ATS score,
 * no match % — TailoredResumeVersion carries no such fields
 * (PORTAL-REDESIGN-SPEC.md, Page: Resume).
 */
export function VersionCardsRow({ versions, activeVersionId }: VersionCardsRowProps) {
    // Sampled once per mount, not per render — see src/app/page.tsx's `nowMs`
    // for why a bare `Date.now()` here would trip `react-hooks/purity`.
    const [now] = useState(() => Date.now());

    return (
        <div className="mb-[18px] flex flex-wrap items-center gap-2.5 border-t border-border pt-4">
            <VersionChip
                href="/resume-builder"
                testId="resume-version-base"
                active={!activeVersionId}
                name="Base resume"
                meta="default"
            />

            {versions.map((v) => (
                <VersionChip
                    key={v.id}
                    href={`/resume-builder?versionId=${v.id}`}
                    testId="resume-version-card"
                    active={activeVersionId === v.id}
                    name={v.versionName}
                    meta={v.createdAt ? `created ${formatRelativeAge(v.createdAt, now)}` : undefined}
                />
            ))}

            <Link
                href="/resume-tailor"
                data-testid="resume-new-version"
                className="font-mono text-[12px] text-muted-foreground underline underline-offset-2 transition-colors duration-100 hover:text-foreground"
            >
                + new version
            </Link>
        </div>
    );
}
