"use client";

import { useState } from "react";
import Link from "next/link";
import { TailoredResumeVersion } from "@/types/resume";
import { formatRelativeAge } from "@/lib/jobs/freshness";

interface VersionCardsRowProps {
    versions: TailoredResumeVersion[];
    /** undefined = base resume is the active view. */
    activeVersionId?: string;
}

/**
 * Shared row shape for the base-resume entry and each tailored version — a
 * ruled list row, not a card (editorial pass). Active = 2px ink left rule +
 * ink text; inactive keeps a transparent left rule (so activating a row
 * never shifts its neighbors) and muted text that inks on hover.
 */
function VersionRow({
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
        <Link
            href={href}
            data-testid={testId}
            className={`flex items-baseline justify-between gap-3 border-b border-b-border border-l-2 py-2.5 pl-3 transition-colors duration-100 ${
                active
                    ? "border-l-foreground text-foreground"
                    : "border-l-transparent text-muted-foreground hover:text-foreground"
            }`}
        >
            <span className={`truncate text-[13.5px] ${active ? "font-semibold" : "font-medium"}`}>{name}</span>
            {meta && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{meta}</span>}
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
        <div className="mb-[18px] flex flex-col border-t border-border">
            <VersionRow
                href="/resume-builder"
                testId="resume-version-base"
                active={!activeVersionId}
                name="Base resume"
                meta="default"
            />

            {versions.map((v) => (
                <VersionRow
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
                className="py-2.5 pl-3 font-mono text-[12px] text-muted-foreground underline underline-offset-2 transition-colors duration-100 hover:text-foreground"
            >
                + new version
            </Link>
        </div>
    );
}
