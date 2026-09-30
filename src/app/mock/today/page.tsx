import type { Metadata } from "next";
import { TodayMockClient } from "./TodayMockClient";

export const metadata: Metadata = {
    title: "Packs home: Today header mock — Velai",
    robots: { index: false, follow: false },
};

/** Fixture-driven preview of the Today header above the pack tiles.
 *  `?state=` picks filled (default), `first`, `empty`, `loading` or
 *  `failed`. See TodayMockClient's doc comment. */
export default function TodayMockPage() {
    return <TodayMockClient />;
}
