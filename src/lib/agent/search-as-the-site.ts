/**
 * `searchJobs` as velai.app's own server serves it to a person (`siteSearch`):
 * list rows carry what their descriptions say about place, and an id lookup
 * gets the job pane's filled description. Shared by the MCP tools and the
 * daily picks run, so a role reads the same to a connected AI, in the email
 * and on the site. No client IP is passed, so no IP location default applies.
 *
 * Server only: it reaches Meilisearch and the description reader.
 */
import { searchJobs } from "@/lib/jobs/search";
import { hydrateJobDescription } from "@/lib/jobs/hydrate-description";
import { withDescriptionPlace, withPlaceRestrictions } from "@/lib/jobs/place-notes";
import { siteSearch } from "./site-search";

export const searchAsTheSite = siteSearch({
    search: (params) => searchJobs(params),
    hydrate: (id) => hydrateJobDescription(id, null),
    rowPlaces: (hits, opts) => withPlaceRestrictions(hits, opts),
    wholePlace: withDescriptionPlace,
});
