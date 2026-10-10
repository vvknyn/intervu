import type { TailorDraft } from "@/lib/local-ai/tailor-resume";

export function hasMeaningfulDiff(draft: TailorDraft): boolean {
    return draft.changes.length > 0;
}
