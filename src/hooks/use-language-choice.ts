"use client";

import { useCallback, useState } from "react";
import { saveLanguageChoice } from "@/hooks/use-agent-preferences";
import { toast } from "@/lib/toast";

/**
 * Changes the languages a person reads postings in, from any list that shows the control
 * (`LanguagesControl`): saved to their account, or kept in this browser for a signed-out visitor
 * (`saveLanguageChoice`). `pending` is true while it saves; a save that fails says so where they changed it.
 */
export function useLanguageChoice(uid: string | null): { pending: boolean; choose: (stored: string[]) => Promise<void> } {
    const [pending, setPending] = useState(false);
    const choose = useCallback(
        async (stored: string[]) => {
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
