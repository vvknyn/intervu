import { DismissMock } from "./DismissMock";

/** Every dismissible notice at a chosen column width, `?w=<css px>` (journey J-NAV-45). */
export default async function DismissMockPage({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
    const { w } = await searchParams;
    return <DismissMock width={Number(w) || 470} />;
}
