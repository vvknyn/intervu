import type { Metadata } from "next";
import { SearchDockMock } from "@/components/mock/SearchDockMock";

export const metadata: Metadata = {
    title: "Search-dock mock — Velai",
};

/** Scroll-docking the /jobs search into the header, three ways. */
export default function SearchDockMockPage() {
    return <SearchDockMock />;
}
