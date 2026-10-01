"use client";

import { Sparkle } from "@phosphor-icons/react";

/**
 * The /jobs front door for a visitor whose résumé is already on file (in the
 * account, or in this browser for a guest). Search at rest opens straight on
 * their résumé-ranked list once per visit; this is the way back to it after
 * they have left it (cleared the search, gone back to rest). Takes the place
 * of `FrontDoorResumeBand`, which invites visitors who have no résumé yet.
 */
export function FrontDoorMatchesCta({ onShowMatches }: { onShowMatches: () => void }) {
    return (
        <div className="mx-auto mt-6 max-w-[960px] text-center">
            <button
                type="button"
                data-testid="front-door-matches"
                onClick={onShowMatches}
                className="ctl-md ctl-button inline-flex items-center justify-center gap-1.5 bg-brand px-5 text-brand-foreground transition-colors hover:opacity-90"
            >
                <Sparkle size={16} weight="bold" aria-hidden />
                See roles that fit your résumé
            </button>
        </div>
    );
}
