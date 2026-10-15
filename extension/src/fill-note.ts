/**
 * What the card says about the résumé it attached to a form: how much of what
 * Velai proposed for the job the person accepted in the panel. A module of its
 * own so the on-page card doesn't bundle the tailoring code.
 */
export function attachedNote(tailored: { accepted: number; proposed: number }): string {
    const { accepted, proposed } = tailored;
    if (proposed === 0) return "";
    const changes = (n: number) => `${n} proposed ${n === 1 ? "change" : "changes"}`;
    return accepted === 0
        ? ` Your résumé went in as you wrote it; ${changes(proposed)} ${proposed === 1 ? "is" : "are"} waiting for your OK in the panel.`
        : ` Your résumé went in with the ${accepted} of ${changes(proposed)} you accepted.`;
}
