/** Whether a wheel event on `target` should advance the pack deck (false inside description scroll). */
export function shouldAdvancePackOnWheel(target: EventTarget | null): boolean {
    if (target == null) return true;
    const el = target as Element;
    if (typeof el.closest !== "function") return true;
    return el.closest("[data-pack-scroll]") == null;
}
