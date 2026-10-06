/**
 * `AgentPreferences.placeCountries`: the country a saved Settings place sits
 * in when its words alone don't name one ("Toronto", "Bengaluru"), read with
 * the gazetteer. Server-only, since the gazetteer is several MB; the browser's
 * fit labels get it with the preferences (`fetchAgentPreferencesAction`).
 */
import type { AgentPreferences } from "@/lib/agent/preferences";
import { countriesOfPlace } from "@/lib/jobs/candidate-signals";
import { gazetteerPlace } from "@/lib/jobs/place-notes";
import { loadGazetteer } from "@/lib/geo/gazetteer";
import { sanitizeLocation } from "@/lib/resume/contact-line";

export function withPlaceCountries(prefs: AgentPreferences): AgentPreferences {
    const place = sanitizeLocation(prefs.search.location);
    if (!place || countriesOfPlace(place).length > 0) return prefs;
    const country = gazetteerPlace(loadGazetteer())(place);
    return country ? { ...prefs, placeCountries: [country] } : prefs;
}
