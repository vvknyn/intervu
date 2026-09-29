import { authRaisedPanelClassName } from "@/components/auth/auth-route-chrome";
import { cn } from "@/lib/utils";

export const posterInlinePanelClassName = authRaisedPanelClassName;

export const posterListPanelClassName = cn("overflow-hidden", authRaisedPanelClassName);

/** Capped width from `--shell-max` — use instead of `max-w-[var(--shell-max)]`. */
export const shellMaxWidthClassName = "shell-max-width";

/** Horizontal padding tied to `--list-inset` — use instead of `px-[var(--list-inset)]`. */
export const posterListInsetClassName = "poster-list-inset-x";
