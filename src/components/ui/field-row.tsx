import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A field and its inline action(s) on one line — the standard "input with
 * attached action" form pattern (stacks on mobile, side-by-side from sm up).
 *
 * Exists because the control primitives don't share a height: Input is h-10
 * while Button and SelectTrigger are h-9. Two explicit heights in a flex row
 * defeat the default `align-items: stretch`, so the action sits 4px short of
 * the field.
 *
 * The fix releases the action's fixed height rather than pinning a matching
 * number, so the row stays aligned if either primitive's height changes later.
 * `h-auto` is a no-op in the stacked mobile layout, where the button's content
 * height already equals h-9.
 */
function FieldRow({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="field-row"
            className={cn("flex flex-col gap-2 sm:flex-row [&>button]:h-auto", className)}
            {...props}
        />
    );
}

export { FieldRow };
