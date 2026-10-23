import type { Metadata } from "next";
import { HistoryMockClient } from "./HistoryMockClient";

export const metadata: Metadata = {
    title: "History mock",
};

/** Fixture-driven /yours/history preview — filled by default, `?state=empty`
 *  for the empty state. See HistoryMockClient's doc comment for why this
 *  route exists. */
export default function HistoryMockPage() {
    return <HistoryMockClient />;
}
