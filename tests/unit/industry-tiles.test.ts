import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    INDUSTRY_TILE_IDS,
    MAX_PACK_TILES,
    industryFilterTileIds,
    visibleIndustryTiles,
    type IndustryTileCounts,
} from "../../src/lib/jobs/for-you/industry-tiles";
import { jobMatchesHubPack, type HubPackId } from "../../src/lib/jobs/for-you/hub-pack-filters";
import { INDUSTRY_IDS } from "../../src/lib/jobs/resume-industry";
import type { PublicJob } from "../../src/lib/jobs/types";

const exact = (value: number) => ({ kind: "exact" as const, value });
/** Counts as the hub reads them: the roles each tile's list opens with ("all" = the pack's own list). */
const settled = (
    rowCounts: Partial<Record<HubPackId, number>>,
    extra: { all?: number; fresh?: number | null; salary?: number | null; remote?: number | null } & Partial<Pick<IndustryTileCounts, "wholePack" | "foundNothing">> = {},
): IndustryTileCounts => {
    const { all = 100, fresh = 20, salary = 40, remote, wholePack, foundNothing } = extra;
    const counts: IndustryTileCounts["counts"] = { all: exact(all) };
    for (const [id, n] of Object.entries(rowCounts)) counts[id as HubPackId] = exact(n);
    counts.fresh = fresh === null ? null : exact(fresh);
    counts.salary = salary === null ? null : exact(salary);
    if (remote !== undefined) counts.remote = remote === null ? null : exact(remote);
    return { counts, wholePack, foundNothing, settled: true };
};

describe("which pack tiles a résumé visitor sees", () => {
    it("no tech tile is offered to a health, trades or service résumé", () => {
        for (const industry of ["health", "trades", "service", "logistics", "education"] as const) {
            for (const tech of ["ai", "good", "lead", "apply"] as const) {
                assert.ok(!INDUSTRY_TILE_IDS[industry].includes(tech), `${industry} offers ${tech}`);
            }
        }
    });

    it("1-Click tailored apply is gone for every résumé: every listing has an apply link", () => {
        for (const industry of INDUSTRY_IDS) assert.ok(!INDUSTRY_TILE_IDS[industry].includes("apply"), industry);
    });

    it("while counting, shows the industry's first tiles and the universal ones", () => {
        const tiles = visibleIndustryTiles("health", { ...settled({}), settled: false });
        assert.deepEqual(tiles, ["all", "health_lead", "health_part_time", "health_research", "health_community", "fresh", "salary"]);
    });

    it("hides a tile with fewer than 3 roles and lets the next one in", () => {
        const tiles = visibleIndustryTiles(
            "health",
            settled({ health_lead: 12, health_part_time: 2, health_research: 9, health_community: 30, health_remote: 5, health_new_grad: 0 }),
        );
        assert.deepEqual(tiles, ["all", "health_lead", "health_research", "health_community", "health_remote", "fresh", "salary"]);
    });

    it("hides a tile that holds nearly the whole list, since it narrows nothing", () => {
        const tiles = visibleIndustryTiles("tech", settled({ ai: 95, lead: 10, good: 4 }, { remote: 30, fresh: 20, salary: 96 }));
        assert.ok(!tiles.includes("ai"), "95 of 100 roles");
        assert.ok(!tiles.includes("salary"), "96 of 100 roles");
        assert.deepEqual(tiles, ["all", "remote", "lead", "good", "fresh"]);
    });

    it("in a small pack, hides a tile that holds every role in it", () => {
        // A health science grad's pack of 8 roles, all of them research roles: the tile is the list again.
        const small = { all: 8, fresh: 2, salary: 4 };
        assert.deepEqual(visibleIndustryTiles("health", settled({ health_research: 8 }, { ...small, wholePack: true })), ["all", "salary"]);
        // Some of the search's rows not read: a share of 8 says too little to hide the tile.
        assert.ok(visibleIndustryTiles("health", settled({ health_research: 8 }, { ...small, wholePack: false })).includes("health_research"));
    });

    it("never shows more than six tiles beside All", () => {
        const every: Partial<Record<HubPackId, number>> = {};
        for (const id of INDUSTRY_TILE_IDS.health) every[id] = 10;
        const tiles = visibleIndustryTiles("health", settled(every));
        assert.equal(tiles.length, MAX_PACK_TILES + 1);
        assert.deepEqual(tiles.slice(-2), ["fresh", "salary"]);
    });

    it("a pack with no roles shows only All", () => {
        const tiles = visibleIndustryTiles("health", settled({}, { all: 0, fresh: 0, salary: 0, foundNothing: true }));
        assert.deepEqual(tiles, ["all"]);
        const failedCounts = visibleIndustryTiles("tech", settled({}, { all: 0, remote: null, fresh: null, salary: null, foundNothing: true }));
        assert.deepEqual(failedCounts, ["all"], "a failed tile count doesn't keep a tile in an empty pack");
    });

    it("a tile whose count failed stays: a missing number is not a reason to hide it", () => {
        const tiles = visibleIndustryTiles("health", settled({ health_lead: 5 }, { fresh: null, salary: 30 }));
        assert.ok(tiles.includes("fresh"));
    });

    it("counts a filter tile's own search only when the industry shows it", () => {
        assert.deepEqual(industryFilterTileIds("tech"), ["remote", "fresh", "salary"]);
        assert.deepEqual(industryFilterTileIds("health"), ["fresh", "salary"]);
    });
});

const job = (title: string, extra: Partial<PublicJob> = {}): PublicJob =>
    ({ id: title, title, company: "", tags: [], work_type: "onsite", employment_type: "full_time", experience_level: "mid", ...extra }) as PublicJob;
const inTile = (id: HubPackId, j: PublicJob) => jobMatchesHubPack(j, id);

describe("what each health tile holds", () => {
    it("leadership counts charge nurses and nurse managers, not staff nurses or case managers", () => {
        for (const title of ["Charge Nurse - ICU", "Nurse Manager, Emergency", "Director of Nursing", "Supervisor, Medical Laboratory"]) {
            assert.ok(inTile("health_lead", job(title)), title);
        }
        for (const title of ["Staff Nurse", "Staff Physical Therapist", "RN Case Manager", "Registered Nurse"]) {
            assert.ok(!inTile("health_lead", job(title)), title);
        }
    });

    it("part-time and per diem reads the title and the employment type", () => {
        assert.ok(inTile("health_part_time", job("Registered Nurse - Per Diem")));
        assert.ok(inTile("health_part_time", job("RN, PRN Float Pool")));
        assert.ok(inTile("health_part_time", job("Registered Nurse", { employment_type: "part_time" })));
        assert.ok(!inTile("health_part_time", job("Registered Nurse")));
    });

    it("research, community, telehealth and new grad each keep their own roles", () => {
        assert.ok(inTile("health_research", job("Clinical Research Coordinator II")));
        assert.ok(inTile("health_research", job("Laboratory Technologist")));
        assert.ok(inTile("health_community", job("Home Care Nurse")));
        assert.ok(inTile("health_community", job("Public Health Nurse", { company: "Toronto Public Health" })));
        assert.ok(!inTile("health_community", job("Registered Nurse", { company: "Community Hospital" })), "a community hospital is still a hospital");
        assert.ok(inTile("health_remote", job("Telehealth Registered Nurse")));
        assert.ok(inTile("health_remote", job("Utilization Review Nurse", { work_type: "remote" })));
        assert.ok(inTile("health_new_grad", job("New Grad RN Residency Program")));
        assert.ok(!inTile("health_new_grad", job("Resident Care Aide")));
    });
});

describe("a few tiles from the other industries", () => {
    it("trades, logistics, service and education tiles read the job title", () => {
        assert.ok(inTile("trades_apprentice", job("Electrical Apprentice")));
        assert.ok(inTile("trades_lead", job("Site Foreman")));
        assert.ok(inTile("log_cdl", job("CDL-A Truck Driver - OTR")));
        assert.ok(inTile("log_warehouse", job("Forklift Operator")));
        assert.ok(inTile("service_food", job("Line Cook")));
        assert.ok(inTile("service_lead", job("Shift Supervisor")));
        assert.ok(inTile("edu_k12", job("Math Teacher", { company: "Peel District School Board" })));
        assert.ok(inTile("edu_higher", job("Lecturer, Nursing", { company: "Humber College" })));
        assert.ok(inTile("edu_part_time", job("Occasional Teacher")));
        assert.ok(inTile("fin_accounting", job("Senior Accountant")));
        assert.ok(inTile("fin_banking", job("Analyst", { company: "Royal Bank of Canada" })));
        assert.ok(inTile("biz_enterprise", job("Enterprise Account Executive")));
        assert.ok(inTile("office_hr", job("HR Coordinator")));
    });
});
