import type { Metadata } from "next";
import { HeaderIdentityMock } from "@/components/mock/HeaderIdentityMock";

export const metadata: Metadata = {
    title: "Header identity mock — Velai",
};

/** Signed-in header account trigger: photo, name-initials, email-initials. */
export default function HeaderIdentityMockPage() {
    return <HeaderIdentityMock />;
}
