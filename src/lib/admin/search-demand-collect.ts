/**
 * Server-only read behind the admin "Search demand" view: the last
 * DEMAND_WINDOW_DAYS of the anonymous search log, opened by the app (each
 * record is sealed with our key, so only the app can read the words), then
 * summarized by the pure `summarizeSearchDemand`.
 */
import { getAdminDb } from "@/lib/firebase/admin";
import { summarizeSearchDemand, type DemandRow, type SearchDemand } from "./search-demand";

export const DEMAND_WINDOW_DAYS = 30;

/** Most rows one read opens; a busier window reports `truncated`. */
const DEMAND_MAX_ROWS = 20_000;

export async function collectSearchDemand(now: number = Date.now()): Promise<SearchDemand> {
    const since = new Date(now - DEMAND_WINDOW_DAYS * 86_400_000).toISOString();
    const snapshot = await getAdminDb()
        .collection("search_events")
        .where("createdAt", ">=", since)
        .orderBy("createdAt", "desc")
        .limit(DEMAND_MAX_ROWS)
        .get();
    const rows = snapshot.docs.map((doc) => doc.data() as DemandRow);
    return summarizeSearchDemand(rows, DEMAND_WINDOW_DAYS, rows.length === DEMAND_MAX_ROWS);
}
