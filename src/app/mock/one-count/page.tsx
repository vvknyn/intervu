import type { Metadata } from "next";
import { OneCountMock } from "@/components/mock/OneCountMock";

export const metadata: Metadata = { title: "One count mock" };

/** The /jobs results-line head (ranked and Freshest) over fixture lists, for evidence and Playwright. Not linked from nav. */
export default function OneCountMockPage() {
    return <OneCountMock />;
}
