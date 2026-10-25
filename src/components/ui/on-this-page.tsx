import * as React from "react";
import { SectionTitle } from "@/components/ui/heading";

/**
 * "On this page" for long articles. Write each h2 once as a `DocHeading`; the
 * anchor id derives from its title (an explicit `id` wins for anchors other
 * pages already link to) and `DocWithToc` builds the list from those same
 * elements, so a heading is never retyped. At >= lg the list sticks beside a
 * centred ~68ch column; on a phone it collapses into a native <details>.
 */
type DocHeadingProps = { id?: string; children: string };

/** "Cookies & analytics" -> "cookies-analytics". */
export function slugifyHeading(title: string): string {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function DocHeading({ id, children }: DocHeadingProps) {
    return <SectionTitle id={id ?? slugifyHeading(children)}>{children}</SectionTitle>;
}

/** Every `DocHeading` in a JSX tree, in document order, as { id, title }. */
export function collectHeadings(node: React.ReactNode): { id: string; title: string }[] {
    return React.Children.toArray(node).flatMap((child) => {
        if (!React.isValidElement<{ id?: string; children?: React.ReactNode }>(child)) return [];
        if (child.type === DocHeading) {
            const title = child.props.children as string;
            return [{ id: child.props.id ?? slugifyHeading(title), title }];
        }
        return collectHeadings(child.props.children);
    });
}

const TOC_LINK = "block py-1 text-sm text-muted-foreground hover:text-foreground";

export function DocWithToc({ children }: { children: React.ReactNode }) {
    const links = collectHeadings(children).map((h) => (
        <li key={h.id}>
            <a href={`#${h.id}`} className={TOC_LINK}>
                {h.title}
            </a>
        </li>
    ));
    return (
        <div className="lg:grid lg:grid-cols-[1fr_minmax(0,68ch)_1fr] lg:gap-10">
            <details className="mb-6 rounded-panel bg-surface px-4 py-3 lg:hidden">
                <summary className="cursor-pointer text-sm font-semibold text-foreground">On this page</summary>
                <ul className="mt-2">{links}</ul>
            </details>
            <nav
                aria-label="On this page"
                className="sticky top-[calc(var(--topbar-h)+1rem)] hidden self-start justify-self-end lg:block lg:w-56"
            >
                <p className="mb-2 text-xs font-semibold text-muted-foreground">On this page</p>
                <ul>{links}</ul>
            </nav>
            <div className="lg:col-start-2 lg:row-start-1">{children}</div>
        </div>
    );
}
