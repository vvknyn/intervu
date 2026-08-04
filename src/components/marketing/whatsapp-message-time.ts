/**
 * Pure derivation of each `WhatsAppThreadHero` bubble's displayed time from
 * the ONE base timestamp carried by `WHATSAPP_THREAD` (openclaw-content.ts)
 * — today only the first message has a real `timestamp` field, but this
 * looks it up generically (the first message with a `timestamp`, not a
 * hardcoded index) rather than assuming which array position carries it.
 * Every other bubble's time is `baseTimestamp + index` minutes — there is
 * deliberately no second, independent time source. Split out from the
 * component (mirrors `thread-render-mode.ts`'s split from
 * `WhatsAppThreadHero.tsx`) so the parsing/formatting is unit-testable
 * without rendering React.
 */

const BASE_TIMESTAMP_PATTERN = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i;

export function deriveMessageTime(baseTimestamp: string, index: number): string {
  const match = BASE_TIMESTAMP_PATTERN.exec(baseTimestamp.trim());
  if (!match) {
    throw new Error(`deriveMessageTime: unparseable base timestamp "${baseTimestamp}"`);
  }
  const [, hourStr, minuteStr, meridiem] = match;
  const baseHour24 = (Number(hourStr) % 12) + (meridiem.toLowerCase() === "pm" ? 12 : 0);

  const MINUTES_PER_DAY = 24 * 60;
  const totalMinutes = baseHour24 * 60 + Number(minuteStr) + index;
  const normalizedMinutes = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hour24 = Math.floor(normalizedMinutes / 60);
  const minute = normalizedMinutes % 60;

  const displayHour = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const displayMeridiem = hour24 < 12 ? "AM" : "PM";
  return `${displayHour}:${String(minute).padStart(2, "0")} ${displayMeridiem}`;
}
