/** A machine token (lowercase letters/digits joined by "_" or "-", no spaces) is shown as words:
 *  "big_tech" → "Big tech", "full_time" → "Full time". Free text passes through. No consumer compares the raw value. */
const MACHINE_TOKEN = /^[a-z0-9]+(?:[_-][a-z0-9]+)+$/;

export function humanizeToken(value: string): string {
  if (!MACHINE_TOKEN.test(value)) return value;
  const words = value.replace(/[_-]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A categorical facet value (work mode, employment type, level): a machine token is humanized and a
 *  bare lowercase word ("remote") is capitalized to match. */
export function categoryLabel(value: string): string {
  const label = humanizeToken(value);
  return /^[a-z]/.test(label) ? label.charAt(0).toUpperCase() + label.slice(1) : label;
}
