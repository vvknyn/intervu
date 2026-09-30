/**
 * The single declaration of the telemetry wire-name vocabulary.
 */
export const ANALYTICS_EVENTS = {
  search_submitted: "search_submitted",
  result_clicked: "result_clicked",
  apply_clicked: "apply_clicked",
  job_saved: "job_saved",
  company_followed: "company_followed",
  auth_started: "auth_started",
  auth_nudge_shown: "auth_nudge_shown",
  auth_method_selected: "auth_method_selected",
  signup_completed: "signup_completed",
  auth_callback_failed: "auth_callback_failed",
  turnstile_error: "turnstile_error",

  job_viewed: "job_viewed",
  job_unsaved: "job_unsaved",
  job_marked_applied: "job_marked_applied",
  job_shared: "share_initiated",
  job_match_expanded: "job_match_expanded",

  company_viewed: "company_viewed",
  company_unfollowed: "company_unfollowed",

  search_zero_results: "search_zero_results",
  search_filter_applied: "search_filter_applied",
  search_results_paged: "search_results_paged",
  results_impressed: "results_impressed",

  search_alert_impressed: "search_alert_impressed",
  search_alert_submitted: "search_alert_submitted",
  search_alert_verified: "search_alert_verified",
  search_alert_dismissed: "search_alert_dismissed",

  application_stage_changed: "application_stage_changed",
  resume_uploaded: "resume_uploaded",

  resume_gate_shown: "resume_gate_shown",
  resume_upload_started: "resume_upload_started",
  resume_upload_selected: "resume_upload_selected",
  resume_upload_accepted: "resume_upload_accepted",
  resume_upload_rejected: "resume_upload_rejected",
  resume_parse_started: "resume_parse_started",
  resume_parse_succeeded: "resume_parse_succeeded",
  resume_parse_failed: "resume_parse_failed",
  resume_review_completed: "resume_review_completed",

  pricing_viewed: "pricing_viewed",
  upgrade_clicked: "upgrade_clicked",
  founding_member_paid: "founding_member_paid",
  founding_seat_reserved: "founding_seat_reserved",
  landed_pledge_clicked: "landed_pledge_clicked",

  home_viewed: "home_viewed",
  home_action_clicked: "home_action_clicked",
  pack_opened: "pack_opened",
} as const;

export type AnalyticsEventKey = keyof typeof ANALYTICS_EVENTS;

export type SignupMethod = "email" | "google" | "username" | "passkey";
