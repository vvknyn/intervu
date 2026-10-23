import type { Metadata } from "next";
import { EmptyStatesMock } from "@/components/mock/EmptyStatesMock";

export const metadata: Metadata = {
    title: "Empty states mock — Velai",
};

type PageProps = {
    searchParams: Promise<{ surface?: string }>;
};

/** Production empty/loading/offline fixtures for evidence and axe — not linked from nav. */
export default async function EmptyStatesMockPage({ searchParams }: PageProps) {
    const params = await searchParams;
    return <EmptyStatesMock surface={params.surface ?? null} />;
}
