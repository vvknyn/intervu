"use client";

import { useState } from "react";
import { BookmarkSimple, X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import {
    deleteSavedSearch,
    hrefFromJobsUrlState,
    persistSavedSearch,
    suggestSavedSearchName,
    type SavedSearch,
} from "@/lib/jobs/saved-searches";
import type { JobsUrlState } from "@/lib/jobs/url-state";

export function SavedSearchesPanel({
    saved,
    urlState,
    canSave,
    onApply,
    className,
}: {
    saved: SavedSearch[];
    urlState: JobsUrlState;
    /** Parent decides when the current URL state is worth persisting. */
    canSave: boolean;
    onApply: (href: string) => void;
    className?: string;
}) {
    const [naming, setNaming] = useState(false);
    const [nameDraft, setNameDraft] = useState("");

    const startSave = () => {
        setNameDraft(suggestSavedSearchName(urlState));
        setNaming(true);
    };

    const commitSave = () => {
        const name = nameDraft.trim();
        if (!name) return;
        persistSavedSearch({ name, href: hrefFromJobsUrlState(urlState) });
        setNaming(false);
        setNameDraft("");
    };

    if (!canSave && saved.length === 0) return null;

    return (
        <div data-testid="saved-searches-panel" className={cn("mt-2 flex flex-col gap-2", className)}>
            {canSave && !naming && (
                <button
                    type="button"
                    data-testid="save-search-trigger"
                    onClick={startSave}
                    className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[#ececec]/80 underline underline-offset-[3px] hover:text-[#ececec]"
                >
                    <BookmarkSimple size={14} aria-hidden />
                    Save this search
                </button>
            )}
            {naming && (
                <div className="flex flex-wrap items-center gap-2">
                    <input
                        data-testid="save-search-name"
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") commitSave();
                            if (e.key === "Escape") setNaming(false);
                        }}
                        className="h-8 min-w-[10rem] rounded-none border border-[#ececec]/30 bg-black/30 px-2 text-[12px] text-[#ececec] outline-none focus:border-[#ececec]/60"
                        aria-label="Saved search name"
                        autoFocus
                    />
                    <button
                        type="button"
                        data-testid="save-search-commit"
                        onClick={commitSave}
                        className="text-[12px] font-medium text-[#ececec] underline underline-offset-[3px]"
                    >
                        Save
                    </button>
                    <button
                        type="button"
                        onClick={() => setNaming(false)}
                        className="text-[12px] text-[#ececec]/60 underline underline-offset-[3px]"
                    >
                        Cancel
                    </button>
                </div>
            )}
            {saved.length > 0 && (
                <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
                    {saved.map((s) => (
                        <li key={s.id} className="inline-flex items-center gap-1">
                            <button
                                type="button"
                                data-testid="saved-search-item"
                                onClick={() => onApply(s.href)}
                                className="max-w-[14rem] truncate text-[12px] text-[#ececec] underline underline-offset-[3px] hover:opacity-80"
                                title={s.name}
                            >
                                {s.name}
                            </button>
                            <button
                                type="button"
                                data-testid="saved-search-remove"
                                onClick={() => deleteSavedSearch(s.id)}
                                className="text-[#ececec]/50 hover:text-[#ececec]"
                                aria-label={`Remove saved search ${s.name}`}
                            >
                                <X size={12} />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
