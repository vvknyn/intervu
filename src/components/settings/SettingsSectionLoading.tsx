import { WaitState } from "@/components/ui/wait-state";
import { cn } from "@/lib/utils";

/** Labeled loading row for settings cards (P1-8 — not bare "Loading…"), on the shared wait ladder. */
export function SettingsSectionLoading({ label, className }: { label: string; className?: string }) {
    return <WaitState label={label} className={cn("py-2", className)} />;
}
