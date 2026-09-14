import type { PackSections } from "@/lib/jobs/for-you/pack-sections";

export type DescriptionPaneState = "loading" | "empty" | "content";

/**
 * What ForYouPack's description pane should show. Pendingness comes ONLY
 * from the `descriptionPending` flag the fetch reports — never from
 * inspecting the shape of `description` itself. A description that is
 * still an empty/falsy value while a fetch is in flight (e.g. `""` before
 * the real copy arrives) must still read as "loading", never fall through
 * to "empty" — that fallthrough was the bug this guards against.
 *
 * Deliberately independent of pack-sections.ts's own logic (only borrows
 * its `PackSections` type): this decision is about pane state, not about
 * how a description gets split into sections.
 */
export function descriptionPaneState(
    descriptionPending: boolean | undefined,
    sections: PackSections,
): DescriptionPaneState {
    if (descriptionPending) return "loading";
    const hasContent =
        sections.about.length + sections.responsibilities.length + sections.requirements.length > 0;
    return hasContent ? "content" : "empty";
}
