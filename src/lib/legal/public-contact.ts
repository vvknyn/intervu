/** Public support contact — privacy, terms, contact page, and email footers. */
export const PUBLIC_SUPPORT_EMAIL = "hello@thesubspace.io" as const;

/**
 * Self-serve account deletion in settings (`SettingsContainer` + `deleteAccount`).
 * Keep in sync with the danger-zone dialog (type DELETE, then confirm).
 */
export const ACCOUNT_SELF_SERVE_DELETION_FLOW =
  "Account tab → Delete account in the danger zone → type DELETE → confirm permanent deletion" as const;
