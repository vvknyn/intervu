/**
 * Native print, not canvas rasterization. The on-screen live preview sits
 * inside a scale() transform wrapper, which corrupts browser print — so a
 * separate, untransformed, portaled copy (#resume-print-root, rendered by
 * ResumeEditor) is what actually prints; see the scoped `@media print` rule
 * in globals.css. Toggling `printing-resume` on <html> is what makes that
 * copy visible while everything else is hidden for the print pass.
 *
 * Single source of truth for the print trigger — both the in-editor
 * "Print / PDF" toolbar button and the hub header's "Export PDF" button
 * call this same function.
 */
export function printResume(): void {
    const root = document.documentElement;
    root.classList.add("printing-resume");
    let cleaned = false;
    const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        root.classList.remove("printing-resume");
    };
    window.addEventListener("afterprint", cleanup, { once: true });
    // Safety net: `afterprint` doesn't fire reliably in every browser.
    setTimeout(cleanup, 5000);
    window.print();
}
