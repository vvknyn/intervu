/** True only when this fetch started in the epoch that is still current. */
export function isCurrentSessionEpoch(requestEpoch: number, currentEpoch: number): boolean {
    return requestEpoch === currentEpoch;
}

export function reduceSessionEpoch(
    state: { epoch: number; user: unknown },
    event:
        | { type: "sign-out" }
        | { type: "resolved"; requestEpoch: number; user: unknown },
): { epoch: number; user: unknown } {
    if (event.type === "sign-out") return { epoch: state.epoch + 1, user: null };
    if (!isCurrentSessionEpoch(event.requestEpoch, state.epoch)) return state;
    return { epoch: state.epoch, user: event.user };
}
