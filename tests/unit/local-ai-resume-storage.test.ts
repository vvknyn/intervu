import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    LOCAL_AI_RESUME_KEY,
    readLocalAiResume,
    writeLocalAiResume,
    clearLocalAiResume,
} from "../../src/lib/local-ai/resume-storage";
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
            name: "Ada Lovelace",
            profession: "Software Engineer",
            yearsOfExperience: 5,
            location: "London",
            email: "ada@example.com",
            phone: "",
        },
        experience: [],
        competencies: [{ category: "Tech", skills: ["TypeScript"] }],
        education: [],
        generatedSummary: "",
    };
}

beforeEach(() => {
    fakeLocalStorage.clear();
});

describe("local-ai resume storage", () => {
    it("round-trips résumé data and updatedAt", () => {
        const data = sampleResume();
        const updatedAt = "2026-09-12T12:00:00.000Z";
        writeLocalAiResume(data, updatedAt);

        const stored = readLocalAiResume();
        assert.ok(stored);
        assert.deepEqual(stored.data, data);
        assert.equal(stored.updatedAt, updatedAt);
        assert.ok(fakeLocalStorage.getItem(LOCAL_AI_RESUME_KEY));
    });

    it("returns null when nothing is stored", () => {
        assert.equal(readLocalAiResume(), null);
    });

    it("returns null for corrupt JSON", () => {
        fakeLocalStorage.setItem(LOCAL_AI_RESUME_KEY, "{not valid json");
        assert.equal(readLocalAiResume(), null);
    });

    it("returns null when payload shape is wrong", () => {
        fakeLocalStorage.setItem(LOCAL_AI_RESUME_KEY, JSON.stringify({ foo: "bar" }));
        assert.equal(readLocalAiResume(), null);
    });

    it("clearLocalAiResume removes stored résumé", () => {
        writeLocalAiResume(sampleResume());
        clearLocalAiResume();
        assert.equal(readLocalAiResume(), null);
    });
});
