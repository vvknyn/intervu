/** Route transition placeholder — must not shift #main during Concept A Step 1. */
export default function Loading() {
    return (
        <div
            id="jobs-route-gate-inert"
            data-testid="jobs-route-loading-inert"
            className="hidden"
            aria-hidden
        />
    );
}
