import type { Metadata } from "next";
import { CompletenessMock } from "@/components/mock/CompletenessMock";

export const metadata: Metadata = {
    title: "Completeness mock",
};

/** Interactive product-completeness mock — full-bleed, no site chrome. */
export default function CompletenessMockPage() {
    return <CompletenessMock />;
}
