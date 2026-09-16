"use client";

import { IconContext } from "@phosphor-icons/react";

/**
 * Icon chokepoint (rulebook v2 clause 6 / GROUP-B icons spec): every phosphor
 * icon in the app defaults to 16px, "bold" weight (≈1.5px stroke at 16px)
 * instead of each call site restating `size={16} weight="bold"` — or, worse,
 * a different size/weight per author. A call site only needs an explicit
 * `size`/`weight` prop when it genuinely differs from the default (a 20px
 * icon inside a 40px control), which `IconContext.Provider` lets a nested
 * icon still override.
 *
 * Mounted once in app/layout.tsx, outside any single route, so all 36 routes
 * inherit it by construction. `@phosphor-icons/react`'s base icons (not the
 * `/dist/ssr` entry point) already require a client boundary to read this
 * context, so this wrapper being "use client" costs nothing new — the icons
 * themselves were already client components.
 *
 * Icons imported from `@phosphor-icons/react/dist/ssr` render as plain SVG
 * with no context read at all (that's the point — server components can use
 * them with no client boundary), so they sit outside this chokepoint by
 * construction and carry their own explicit `size`/`weight` props instead.
 */
export function IconDefaultsProvider({ children }: { children: React.ReactNode }) {
    return <IconContext.Provider value={{ size: 16, weight: "bold" }}>{children}</IconContext.Provider>;
}
