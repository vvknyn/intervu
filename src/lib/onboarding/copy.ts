/** "2 steps left" — what the strip and the account menu say about setup still open. */
export function setupStepsLeftLabel(left: number): string {
    return `${left} ${left === 1 ? "step" : "steps"} left`;
}
