import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveCandidateSignals } from "../../src/lib/jobs/candidate-signals";
import type { AgentPreferences } from "../../src/lib/agent/preferences";
import {
    nextOpenStep,
    relocationAnswer,
    relocationChoiceOf,
    setupSearch,
    startingPlace,
} from "../../src/lib/onboarding/steps";

describe("nextOpenStep", () => {
    it("moves on to the next open step, wrapping round, and ends when all are answered", () => {
        assert.equal(nextOpenStep({ resume: "done", place: null, email: null }, "resume"), "place");
        assert.equal(nextOpenStep({ resume: null, place: "done", email: "skipped" }, "email"), "resume");
        assert.equal(nextOpenStep({ resume: "done", place: "skipped", email: "done" }, "email"), null);
    });
});

describe("startingPlace", () => {
    it("Settings first, then the résumé, then the connection's country, and says which", () => {
        assert.deepEqual(startingPlace({ settings: "Nairobi", resume: "Mombasa, Kenya", connectionCountry: "Kenya" }), {
            value: "Nairobi",
            source: "settings",
        });
        assert.deepEqual(startingPlace({ settings: " ", resume: "Hamilton, ON", connectionCountry: "Canada" }), {
            value: "Hamilton, ON",
            source: "resume",
        });
        assert.deepEqual(startingPlace({ settings: null, resume: null, connectionCountry: "Singapore" }), {
            value: "Singapore",
            source: "connection",
        });
        assert.deepEqual(startingPlace({ settings: null, resume: null, connectionCountry: null }), { value: "", source: null });
    });
});

describe("relocation answers", () => {
    const prefs = (relocation: string): AgentPreferences => ({ configured: true, search: {}, answers: { relocation, custom: {} } });
    const read = (text: string) => resolveCandidateSignals(null, prefs(text)).relocation;

    it("each choice reads back the way it was meant by the fit labels' own reader", () => {
        assert.deepEqual(read(relocationAnswer("no", "")!).value, { open: false, countries: [] });
        assert.deepEqual(read(relocationAnswer("anywhere", "")!).value, { open: true, countries: [] });
        const to = read(relocationAnswer("to", "United Kingdom, Germany")!).value;
        assert.equal(to?.open, true);
        assert.deepEqual([...(to?.countries ?? [])].sort(), ["Germany", "United Kingdom"]);
        assert.deepEqual(read(relocationAnswer("to", "Canada")!).value?.countries, ["Canada"]);
        assert.equal(relocationAnswer("to", "  "), null);
    });

    it("an answer this step wrote reads back into its choice; anything else starts unselected", () => {
        assert.deepEqual(relocationChoiceOf("Not open to relocating"), { choice: "no", places: "" });
        assert.deepEqual(relocationChoiceOf("Open to relocating anywhere"), { choice: "anywhere", places: "" });
        assert.deepEqual(relocationChoiceOf("Open to relocating to India"), { choice: "to", places: "India" });
        assert.deepEqual(relocationChoiceOf("yes, happy to move for the right team"), { choice: null, places: "" });
        assert.deepEqual(relocationChoiceOf(null), { choice: null, places: "" });
    });
});

describe("setupSearch", () => {
    const cases = [
        { roles: "Registered nurse", place: "Toronto, ON", remote: false, name: "Registered nurse in Toronto, ON", href: "?q=Registered+nurse&country=Toronto+ON" },
        { roles: "Primary school teacher", place: "Manchester, UK", remote: false, name: "Primary school teacher in Manchester, UK", href: "?q=Primary+school+teacher&country=Manchester+UK" },
        { roles: "Data analyst", place: "Bengaluru, Karnataka", remote: false, name: "Data analyst in Bengaluru, Karnataka", href: "?q=Data+analyst&country=Bengaluru+Karnataka" },
        { roles: "Software engineer", place: "Singapore", remote: true, name: "Software engineer in Singapore (remote only)", href: "?q=Software+engineer&work=remote&country=Singapore" },
        { roles: "Electrician", place: null, remote: false, name: "Electrician", href: "?q=Electrician" },
    ];
    for (const c of cases) {
        it(`${c.roles}${c.place ? ` in ${c.place}` : ""}: the roles where they can work, as the location box would put it`, () => {
            const search = setupSearch({ roles: c.roles, place: c.place, remoteOnly: c.remote, currentSearchHref: null });
            assert.equal(search?.name, c.name);
            assert.equal(search?.href, c.href);
        });
    }

    it("no roles: the search they were on, else nothing to offer", () => {
        assert.equal(setupSearch({ roles: null, place: "Kenya", remoteOnly: false, currentSearchHref: "?q=accountant&country=Kenya" })?.href, "?q=accountant&country=Kenya");
        assert.equal(setupSearch({ roles: " ", place: "Kenya", remoteOnly: false, currentSearchHref: "?country=Kenya" }), null);
        assert.equal(setupSearch({ roles: null, place: null, remoteOnly: false, currentSearchHref: null }), null);
    });
});
