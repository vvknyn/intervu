import type { Metadata } from "next";
import { SearchAlertMock } from "@/components/mock/SearchAlertMock";

export const metadata: Metadata = {
    title: "Search-alert mock",
};

/** The signed-out job alert form in both places it opens, for pixel verification and the layout journey. */
export default function SearchAlertMockPage() {
    return <SearchAlertMock />;
}
