import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    MAX_SILENT_PACKET_CACHE_ENTRIES,
    SILENT_PACKET_CACHE_KEY,
    clearSilentPacketCacheForTests,
    readSilentPacketCache,
    writeSilentPacketCache,
} from "../../src/lib/local-ai/silent-packet-cache";
import { heuristicTailorResume } from "../../src/lib/local-ai/tailor-resume";
import type { ResumeData } from "../../src/types/resume";

class FakeLocalStorage {
    private store = new Map<string, string>();
    getItem(key: string): string | null {
        return this.store.has(key) ? this.store.get(key)! : null;
    }
    setItem(key: string, value: string): void {
        this.store.set(key, value);
    }
    removeItem(key: string): void {
        this.store.delete(key);
    }
    clear(): void {
        this.store.clear();
    }
}

const fakeLocalStorage = new FakeLocalStorage();
(globalThis as unknown as { localStorage: FakeLocalStorage }).localStorage = fakeLocalStorage;

function sampleResume(): ResumeData {
    return {
        profile: {
            name: "Jane Doe",
            profession: "Product Manager",
            yearsOfExperience: 6,
            location: "Toronto",
            email: "jane@example.com",
            phone: "",
        },
        experience: [
            {
                id: "exp-1",
                company: "Acme Corp",
                role: "Senior Product Manager",
                dates: "2021 - Present",
                description: "Led product planning for B2B SaaS platform",
            },
        ],
        competencies: [{ category: "Skills", skills: ["Product planning"] }],
        education: [],
        generatedSummary: "Product manager with 6 years experience.",
    };
}

function sampleDraft() {
    return heuristicTailorResume(sampleResume(), {
        title: "Product Manager",
        company: "Acme Corp",
        tags: ["roadmap"],
        description: "Own the roadmap.",
    });
}

beforeEach(() => {
    fakeLocalStorage.clear();
    clearSilentPacketCacheForTests();
});

describe("silent packet cache", () => {
    it("round-trips a draft by cache key", () => {
        const draft = sampleDraft();
        writeSilentPacketCache("job-1:abc", draft);

        const stored = readSilentPacketCache("job-1:abc");
        assert.ok(stored);
        assert.equal(stored.summaryAfter, draft.summaryAfter);
        assert.equal(stored.engineLabel, draft.engineLabel);
        assert.ok(fakeLocalStorage.getItem(SILENT_PACKET_CACHE_KEY));
    });

    it("returns null for missing keys", () => {
        assert.equal(readSilentPacketCache("missing"), null);
    });

    it("prunes to the most recent N entries", () => {
        for (let i = 0; i < MAX_SILENT_PACKET_CACHE_ENTRIES + 3; i++) {
            writeSilentPacketCache(`job-${i}:fp`, sampleDraft());
        }

        assert.equal(readSilentPacketCache("job-0:fp"), null);
        assert.equal(readSilentPacketCache("job-1:fp"), null);
        assert.equal(readSilentPacketCache("job-2:fp"), null);
        assert.ok(readSilentPacketCache(`job-${MAX_SILENT_PACKET_CACHE_ENTRIES + 2}:fp`));
    });
});
