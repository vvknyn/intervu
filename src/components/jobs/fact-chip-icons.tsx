import { MapPin, House, Clock, ChartBar, CurrencyDollar, Calendar, type Icon } from "@phosphor-icons/react";
import type { FactChipKind } from "@/components/jobs/job-detail-facts";

/**
 * Single icon-set chokepoint for the fact grammar shared by JobCard (SERP
 * row) and JobDetail (SERP pane + `/jobs/[slug]`) — board-redesign.html /
 * serp-readout-redesign.html section 3: "`key value` chip becomes
 * `icon value`... one icon set, used everywhere." `location` is not a
 * `FactChipKind` (job-detail-facts.ts's `buildFactChips` deliberately
 * excludes it — JobDetail already renders location in its identity header)
 * but both card and detail need a location icon for their own fact rows, so
 * it's folded into this same map rather than living in a second one.
 *
 * The mock's icon set assumes lucide; this repo carries zero lucide
 * dependency (@phosphor-icons/react only, confirmed by grep) — Phosphor
 * equivalents substituted 1:1, documented as an intentional deviation.
 */
export const FACT_CHIP_ICON: Record<FactChipKind | "location", Icon> = {
    location: MapPin,
    work_type: House,
    employment_type: Clock,
    experience_level: ChartBar,
    salary: CurrencyDollar,
    posted: Calendar,
    first_seen: Calendar,
};
