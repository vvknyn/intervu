import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A field and its inline action(s) on one line — the standard "input with
 * attached action" form pattern (stacks on mobile, side-by-side from sm up).
 *
 * Input, Button (default size), and SelectTrigger (default size) all share
 * the field-01 h-8 control height, so a plain flex row's default
 * `align-items: stretch` already lines them up with no per-child override.
 */
function FieldRow({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="field-row"
            className={cn("flex flex-col gap-2 sm:flex-row", className)}
            {...props}
        />
    );
}

export { FieldRow };
