import type { Metadata } from "next";
import { Suspense } from "react";
import { RelatedJobsMock } from "@/components/mock/RelatedJobsMock";

export const metadata: Metadata = {
    title: "More like this mock",
    robots: { index: false, follow: false },
};

/** Fixture-driven detail pane with its "More like this" list filled — the
 *  list is signed-in only on the board and needs a live corpus, so neither
 *  a local server nor a signed-out visit ever shows it. `?state=` picks a
 *  pane state (default, company, long, nodomain, closed, remote, minimal,
 *  signedin); `?view=page` renders the job page layout instead. */
export default function RelatedJobsMockPage() {
    return (
        <Suspense>
            <RelatedJobsMock />
        </Suspense>
    );
}
