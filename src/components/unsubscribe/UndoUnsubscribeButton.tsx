"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { undoUnsubscribeAction } from "@/actions/unsubscribe";

/** Calls the "use server" action directly on click — same shape
 *  `SettingsContainer.tsx` uses for `deleteAccount()`, not a form post. */
export function UndoUnsubscribeButton({ token }: { token: string }) {
    const [state, setState] = useState<"idle" | "pending" | "done" | "error">("idle");

    if (state === "done") {
        return <p className="text-sm text-foreground">You&apos;re back on the list.</p>;
    }

    return (
        <div>
            <Button
                variant="outline"
                disabled={state === "pending"}
                onClick={async () => {
                    setState("pending");
                    const result = await undoUnsubscribeAction(token);
                    setState(result.ok ? "done" : "error");
                }}
            >
                {state === "pending" ? "Undoing…" : "Wasn't me — resubscribe"}
            </Button>
            {state === "error" && (
                <p className="mt-2 text-[13px] text-destructive">That didn&apos;t work — try reloading the original link.</p>
            )}
        </div>
    );
}
