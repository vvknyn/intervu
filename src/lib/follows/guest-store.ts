"use client";

/**
 * Guest follows — client-only localStorage store for signed-out company
 * follows (spec §Follow). Merged into Firestore at sign-in via
 * `syncGuestFollowsToServer` (`use-follows.ts`).
 */

import type { FollowedCompany } from "./types";

const STORAGE_KEY = "intervu.follows.guest";

const listeners = new Set<() => void>();

export function subscribeGuestFollows(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

function notify(): void {
    listeners.forEach((cb) => cb());
}

function read(): FollowedCompany[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as FollowedCompany[]) : [];
    } catch {
        return [];
    }
}

function write(list: FollowedCompany[]): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
        /* quota exceeded / private mode */
    }
    notify();
}

export function listGuestFollows(): FollowedCompany[] {
    return read();
}

export function addGuestFollow(input: Omit<FollowedCompany, "createdAt">): FollowedCompany {
    const list = read();
    const i = list.findIndex((f) => f.domain === input.domain);
    const now = new Date().toISOString();
    const row: FollowedCompany = {
        ...input,
        createdAt: i === -1 ? now : list[i].createdAt,
    };
    const next = i === -1 ? [...list, row] : list.map((f, idx) => (idx === i ? row : f));
    write(next);
    return row;
}

export function removeGuestFollow(domain: string): void {
    write(read().filter((f) => f.domain !== domain));
}

export function clearGuestFollows(): void {
    write([]);
}
