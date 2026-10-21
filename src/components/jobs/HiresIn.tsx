"use client";

/**
 * "Hires in Canada": a remote role whose posting says it hires in the candidate's country in words its place
 * fields don't carry ("Remote, Canada; Austin, TX" under a United States tag, or a description that says
 * "open to candidates located in the US or Canada"). The note is `MatchComponent.hires` (lib/match/score.ts),
 * so a row, the detail pane and the MCP's `match` all say it from one read, and it never appears without
 * the posting's own line. A row shows the words and hovers or taps open the line; the detail shows the line.
 */
import { ContextHelp } from "@/components/ui/context-help";
import type { MatchComponent, MatchScore } from "@/lib/match/score";

export type HiresNote = NonNullable<MatchComponent["hires"]>;

/** The note a score carries, or `null` (no résumé, a role the candidate can't take, or one whose fields already say it). */
export function hiresNoteOf(score: MatchScore | null | undefined): HiresNote | null {
    return score?.components.find((component) => component.key === "location")?.hires ?? null;
}

/** "the United States", "the Netherlands"; other countries as they are. */
function countryName(country: string): string {
    return /^(united|netherlands|philippines)\b/i.test(country) ? `the ${country}` : country;
}

/** The row's word, with the posting's line on hover or tap. */
export function HiresInWord({ note }: { note: HiresNote }) {
    return (
        <span data-testid="hires-in" onClick={(event) => event.stopPropagation()} className="font-semibold text-verdict-good">
            <ContextHelp
                side="right"
                content={
                    <span data-testid="hires-in-quote" className="block max-w-xs text-sm leading-snug">
                        The posting says: “{note.quote}”
                    </span>
                }
            >
                Hires in {countryName(note.country)}
            </ContextHelp>
        </span>
    );
}

/** The detail pane's line: the word and the posting's own words beside it. */
export function HiresInLine({ note }: { note: HiresNote }) {
    return (
        <p data-testid="hires-in-line" className="mt-2 text-sm leading-snug text-muted-foreground">
            <span className="font-semibold text-verdict-good">Hires in {countryName(note.country)}</span>
            {" · "}“{note.quote}”
        </p>
    );
}
