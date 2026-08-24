import type { Metadata } from "next";
import { SearchEmphasisMock } from "@/components/mock/SearchEmphasisMock";

export const metadata: Metadata = {
    title: "Search-emphasis mock — Intervu",
    robots: { index: false, follow: false },
};

/** Shadow-free ways to give the /jobs search box weight, for picking one. */
export default function SearchEmphasisMockPage() {
    return <SearchEmphasisMock />;
}
