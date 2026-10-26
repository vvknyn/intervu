/**
 * The résumé-retention rule's numbers and wording, in one place. A saved résumé is deleted when the
 * account's paid/granted time ends (the sweep runs hourly); one warning goes out WARN_BEFORE_DAYS
 * before that. Pure, so the browser and the copy can quote it.
 */
export const WARN_BEFORE_DAYS = 7;
export const WARN_BEFORE_MS = WARN_BEFORE_DAYS * 86_400_000;
/** Tail of every sentence that states when the saved résumé goes. */
export const DELETED_WHEN = "within an hour after your paid time ends";
