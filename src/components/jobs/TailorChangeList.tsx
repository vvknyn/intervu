"use client";

import { Button } from "@/components/ui/button";
import { startsOn, type TailorChange, type TailorDraft } from "@/lib/local-ai/tailor-resume";
import { addedWordRuns } from "@/lib/resume/word-diff";
import { cn } from "@/lib/utils";
import type { ResumeData } from "@/types/resume";

/**
 * What tailoring changed for this role, one row per change with the reason
 * and an Undo: the summary, each reworded line and each role's new line
 * order (grouped under the role), and each skills group. Two kinds start off
 * and wait for the person (`startsOn`): a rewrite that adds posting words the
 * résumé doesn't use ("Use"), and leaving a project out ("Leave out"). Copy
 * and Download use the changes left on (`applyTailorChanges`).
 */
export interface TailorChangeListProps {
    draft: TailorDraft;
    /** The résumé with the changes still on applied: what Copy and Download use. */
    kept: ResumeData;
    undone: ReadonlySet<string>;
    onToggle: (id: string) => void;
}

interface Section {
    key: string;
    title: string;
    changes: TailorChange[];
}

/** Within a role: leaving it out first, then its lines, then their order. */
const rank = (c: TailorChange) => (c.kind === "leave-out" ? 0 : c.kind === "order" ? 2 : 1);

function sectionsOf(draft: TailorDraft): Section[] {
    const sections: Section[] = [];
    const summary = draft.changes.filter((c) => c.kind === "summary");
    if (summary.length > 0) sections.push({ key: "summary", title: "Summary", changes: summary });
    const entries = [
        ...draft.base.experience.map((e) => ({ source: "experience" as const, entry: e })),
        ...(draft.base.projects ?? []).map((e) => ({ source: "project" as const, entry: e })),
    ];
    for (const { source, entry } of entries) {
        const mine = draft.changes
            .filter((c) => (c.kind === "line" || c.kind === "order" || c.kind === "leave-out") && c.source === source && c.entryId === entry.id)
            .sort((a, b) => rank(a) - rank(b) || (a.kind === "line" && b.kind === "line" ? a.index - b.index : 0));
        if (mine.length === 0) continue;
        sections.push({ key: `${source}:${entry.id}`, title: [entry.role, entry.company].filter(Boolean).join(" · "), changes: mine });
    }
    const skills = draft.changes.filter((c) => c.kind === "skills");
    if (skills.length > 0) sections.push({ key: "skills", title: "Skills", changes: skills });
    return sections;
}

function Rewording({ before, after }: { before: string; after: string }) {
    return (
        <>
            <p className="text-sm leading-relaxed text-foreground">
                {addedWordRuns(before, after).map((run, i) =>
                    run.added ? (
                        <mark key={i} className="bg-transparent font-semibold text-brand">
                            {run.text}
                        </mark>
                    ) : (
                        <span key={i}>{run.text}</span>
                    ),
                )}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Was: {before}</p>
        </>
    );
}

function ChangeBody({ change, kept, undone }: { change: TailorChange; kept: ResumeData; undone: boolean }) {
    switch (change.kind) {
        case "summary":
        case "line":
            // A suggestion still off shows what it would say, so the person can decide.
            return undone && startsOn(change) ? (
                <p className="text-sm leading-relaxed text-foreground">{change.before}</p>
            ) : (
                <Rewording before={change.before} after={change.after} />
            );
        case "leave-out":
            return (
                <p className="text-sm leading-relaxed text-foreground">
                    {undone ? "Still in this version. Leave it out?" : "Left out of this version."}
                </p>
            );
        case "order": {
            if (undone) return <p className="text-sm text-foreground">Lines stay in your order.</p>;
            const list = change.source === "project" ? kept.projects : kept.experience;
            const entry = list?.find((e) => e.id === change.entryId);
            const first = entry?.description.split("\n")[0]?.replace(/^[\s\-*•]+/, "") ?? "";
            return (
                <p className="text-sm leading-relaxed text-foreground">
                    Now first: <span className="text-muted-foreground">{first}</span>
                </p>
            );
        }
        case "skills":
            return (
                <p className="text-sm leading-relaxed text-foreground">
                    {(undone ? change.before : change.after).join(", ")}
                </p>
            );
    }
}

function shortLabel(change: TailorChange): string {
    const text =
        change.kind === "summary" || change.kind === "line"
            ? change.after
            : change.kind === "skills"
              ? change.category || "skills"
              : change.kind === "leave-out"
                ? "the whole project"
                : "line order";
    return text.length > 48 ? `${text.slice(0, 47)}…` : text;
}

/** Undo for a change that is on; for one that is off, what turning it on does. */
function toggleLabel(change: TailorChange, undone: boolean): string {
    if (!undone) return "Undo";
    if (startsOn(change)) return "Redo";
    return change.kind === "leave-out" ? "Leave out" : "Use";
}

export function TailorChangeList({ draft, kept, undone, onToggle }: TailorChangeListProps) {
    const sections = sectionsOf(draft);
    if (sections.length === 0) {
        return (
            <p className="text-sm text-muted-foreground" data-testid="tailor-no-changes">
                Your résumé already reads the way this posting does. Nothing to reword or move.
            </p>
        );
    }
    const on = draft.changes.length - draft.changes.filter((c) => undone.has(c.id)).length;
    return (
        <div className="space-y-4" data-testid="tailor-changes">
            <p className="text-sm text-muted-foreground" data-testid="tailor-changes-count">
                {on} of {draft.changes.length} {draft.changes.length === 1 ? "change" : "changes"} on. Each keeps what your résumé
                says, in this posting&apos;s words or order. Undo any you don&apos;t want; Copy and Download use the rest.
            </p>
            {sections.map((section) => (
                <section key={section.key} aria-label={section.title}>
                    <h3 className="text-xs font-semibold text-muted-foreground">{section.title}</h3>
                    <ul className="mt-1 divide-y divide-border">
                        {section.changes.map((change) => {
                            const isUndone = undone.has(change.id);
                            return (
                                <li
                                    key={change.id}
                                    className="flex items-start gap-3 py-2"
                                    data-testid="tailor-change"
                                    data-change-kind={change.kind}
                                    data-undone={isUndone ? "true" : "false"}
                                >
                                    <div className={cn("min-w-0 flex-1 break-words", isUndone && startsOn(change) && "opacity-80")}>
                                        <ChangeBody change={change} kept={kept} undone={isUndone} />
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {isUndone && startsOn(change) ? "Undone: your résumé's own wording stays." : change.why}
                                        </p>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="xs"
                                        aria-label={`${toggleLabel(change, isUndone)} ${section.title}: ${shortLabel(change)}`}
                                        data-testid="tailor-change-toggle"
                                        onClick={() => onToggle(change.id)}
                                        className="shrink-0"
                                    >
                                        {toggleLabel(change, isUndone)}
                                    </Button>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            ))}
        </div>
    );
}
