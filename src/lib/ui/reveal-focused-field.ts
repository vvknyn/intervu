import type { FocusEvent } from "react"

const KEYBOARD_SETTLE_MS = 300

/** Pure: is this focus target a control that opens the on-screen keyboard? */
export function isTextEntry(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLInputElement) {
    return !["button", "checkbox", "radio", "file", "submit", "reset", "range", "color", "image"].includes(target.type)
  }
  return false
}

/**
 * `onFocusCapture` for a dialog/sheet root: when a text field takes focus, scroll
 * it into view inside the overlay's body once now, again when the keyboard has
 * resized the visual viewport, and once more after it has settled. The body is
 * the only scroller (footer is a flex sibling, not an overlay), so the footer can
 * never end up covering the field.
 */
export function revealFocusedField(event: FocusEvent<HTMLElement>): void {
  const el = event.target
  if (!isTextEntry(el)) return
  const reveal = () => {
    if (el.isConnected) el.scrollIntoView({ block: "nearest" })
  }
  reveal()
  window.visualViewport?.addEventListener("resize", reveal, { once: true })
  window.setTimeout(reveal, KEYBOARD_SETTLE_MS)
}
