"use client";

import { useCallback, useState } from "react";
import { saveLanguageChoice } from "@/hooks/use-agent-preferences";
import { toast } from "@/lib/toast";

/**
 * Changes the languages a person reads postings in, from any list that shows the control
 * (`LanguagesControl`): saved to their account (`saveLanguageChoice`). For You, Today and Settings all need one, so
 * with none there is nothing to save to. `pending` is true while it saves; a save that fails says so where they changed it.
 */
export function useLanguageChoice(uid: string | null): { pending: boolean; choose: (stored: string[]) => Promise<void> } {
    const [pending, setPending] = useState(false);
    const choose = useCallback(
        async (stored: string[]) => {
            if (!uid) return;
            setPending(true);
            try {
                if (!(await saveLanguageChoice(uid, stored))) toast.error("Couldn't save your languages. Try again.");
            } finally {
                setPending(false);
            }
        },
        [uid],
    );
    return { pending, choose };
}
