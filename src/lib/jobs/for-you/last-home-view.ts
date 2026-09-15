import type { JobsHomeView } from "@/lib/jobs/for-you/home-view";

export const LAST_JOBS_HOME_VIEW_KEY = "intervu.jobs.homeView";

const listeners = new Set<() => void>();

function getStorage(): Storage | null {
    if (typeof globalThis.localStorage === "undefined") return null;
    return globalThis.localStorage;
}

export function readLastJobsHomeView(): JobsHomeView | null {
    const storage = getStorage();
    if (!storage) return null;
    try {
        const raw = storage.getItem(LAST_JOBS_HOME_VIEW_KEY);
        if (raw === "for-you" || raw === "search") return raw;
        return null;
    } catch {
        return null;
    }
}

export function writeLastJobsHomeView(view: JobsHomeView): void {
    const storage = getStorage();
    if (!storage) return;
    try {
        storage.setItem(LAST_JOBS_HOME_VIEW_KEY, view);
    } catch {
        // Private browsing / quota — in-memory listeners still fire.
    }
    listeners.forEach((listener) => listener());
}

export function subscribeLastJobsHomeView(onStoreChange: () => void): () => void {
    listeners.add(onStoreChange);
    if (typeof window !== "undefined") {
        window.addEventListener("storage", onStoreChange);
    }
    return () => {
        listeners.delete(onStoreChange);
        if (typeof window !== "undefined") {
            window.removeEventListener("storage", onStoreChange);
        }
    };
}
