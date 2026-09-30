import type { Metadata } from "next";
import { HubYourJobsMockClient } from "./HubYourJobsMockClient";

export const metadata: Metadata = {
    title: "Packs hub: tracker and recently viewed mock — Velai",
    robots: { index: false, follow: false },
};

/** Fixture-driven preview of the tracker and Recently viewed band under the
 *  pack tiles. `?state=` picks filled (default), `empty`, `loading`,
 *  `failed` or `signed-out`. See HubYourJobsMockClient's doc comment. */
export default function HubYourJobsMockPage() {
    return <HubYourJobsMockClient />;
}
