import type { CachedInterviewData } from "@/lib/interview-cache";
import { InterviewCache } from "@/lib/interview-cache";
import type { PrepSessionMode } from "@/lib/prep/session-progress";
import { parseSessionState } from "@/lib/prep/session-progress";

const INTERVIEW_PREP_CACHE_KEY = "interview_prep_cache";
const SESSION_STORAGE_PREFIX = "intervu_prep_session_v1_";
const PREFERRED_VIEW_STORAGE_KEY = "intervu_prep_preferred_view_v1";

export type PrepPlanView = "session" | "package";

export interface CachedPlanListItem {
  cacheKey: string;
  company: string;
  position: string;
  round: string;
  jdFingerprint?: string;
  createdAt: number;
  expiresAt: number;
}

export interface ResumableSessionItem {
  planCacheKey: string;
  mode: PrepSessionMode;
  updatedAt: string;
  company: string;
  position: string;
  round: string;
}

let testCacheOverride: Record<string, CachedInterviewData> | null = null;
let testSessionStorage: Record<string, string> | null = null;
let testPreferredViewStore: Record<string, PrepPlanView> | null = null;

export function __testSetInterviewCacheEntries(entries: CachedInterviewData[]): void {
  if (process.env.NODE_ENV !== "test") return;
  testCacheOverride = {};
  for (const entry of entries) {
    testCacheOverride[entry.cacheKey] = entry;
  }
}

export function __testSetSessionEntries(entries: Record<string, string>): void {
  if (process.env.NODE_ENV !== "test") return;
  testSessionStorage = entries;
}

export function __testClearPreferredViews(): void {
  if (process.env.NODE_ENV !== "test") return;
  testPreferredViewStore = {};
}

function readPreferredViewStore(): Record<string, PrepPlanView> {
  if (testPreferredViewStore) return testPreferredViewStore;

  if (typeof localStorage === "undefined") return {};

  try {
    const stored = localStorage.getItem(PREFERRED_VIEW_STORAGE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored) as Record<string, PrepPlanView>;
    return parsed ?? {};
  } catch {
    return {};
  }
}

function writePreferredViewStore(store: Record<string, PrepPlanView>): void {
  if (testPreferredViewStore) {
    testPreferredViewStore = store;
    return;
  }

  if (typeof localStorage === "undefined") return;

  try {
    localStorage.setItem(PREFERRED_VIEW_STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* ignore quota errors */
  }
}

export function getPreferredView(planCacheKey: string): PrepPlanView | null {
  const store = readPreferredViewStore();
  return store[planCacheKey] ?? null;
}

export function setPreferredView(planCacheKey: string, view: PrepPlanView): void {
  const store = readPreferredViewStore();
  store[planCacheKey] = view;
  writePreferredViewStore(store);
}

function readCacheEntries(): Record<string, CachedInterviewData> {
  if (testCacheOverride) return testCacheOverride;

  if (typeof localStorage === "undefined") return {};

  try {
    const stored = localStorage.getItem(INTERVIEW_PREP_CACHE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored) as Record<string, CachedInterviewData>;
    return parsed ?? {};
  } catch {
    return {};
  }
}

export function listCachedPlans(): CachedPlanListItem[] {
  const entries = readCacheEntries();

  return Object.values(entries)
    .filter((entry) => !InterviewCache.isExpired(entry.expiresAt))
    .map((entry) => ({
      cacheKey: entry.cacheKey,
      company: entry.company,
      position: entry.position,
      round: entry.round,
      jdFingerprint: entry.jdFingerprint,
      createdAt: entry.createdAt,
      expiresAt: entry.expiresAt,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function lookupPlanMetadata(planCacheKey: string): Pick<CachedPlanListItem, "company" | "position" | "round"> {
  const entries = readCacheEntries();
  const cached = entries[planCacheKey];
  if (cached) {
    return {
      company: cached.company,
      position: cached.position,
      round: cached.round,
    };
  }
  return { company: "Unknown", position: "Unknown", round: "Unknown" };
}

export function listResumableSessions(): ResumableSessionItem[] {
  const sessionEntries: Array<[string, string]> = [];

  if (testSessionStorage) {
    for (const [key, value] of Object.entries(testSessionStorage)) {
      if (key.startsWith(SESSION_STORAGE_PREFIX)) {
        sessionEntries.push([key, value]);
      }
    }
  } else if (typeof localStorage !== "undefined") {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(SESSION_STORAGE_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (raw) sessionEntries.push([key, raw]);
    }
  } else {
    return [];
  }

  const sessions: ResumableSessionItem[] = [];

  for (const [, raw] of sessionEntries) {

    const state = parseSessionState(raw);
    if (!state) continue;

    const meta = lookupPlanMetadata(state.planCacheKey);
    sessions.push({
      planCacheKey: state.planCacheKey,
      mode: state.mode,
      updatedAt: state.updatedAt,
      ...meta,
    });
  }

  return sessions.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}
