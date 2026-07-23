import { z } from "zod";

/**
 * Server-action input validation chokepoint.
 *
 * Server actions receive arguments straight from the client — they are an
 * untrusted boundary even with Firestore rules behind them (bad shapes can write
 * junk fields, oversize payloads, or wrong types). Every mutating action should
 * funnel its input through `validate(schema, input)` so the rules live in one
 * place and the failure shape is uniform.
 *
 * Pure function: no I/O, no auth — safe to unit-test directly.
 *
 * @returns a discriminated union keyed on `ok`. On success `{ ok: true, data }`;
 *          on failure `{ ok: false, error }` (a single human-readable string).
 *          Never throws on validation failure, so callers can return the error in
 *          their existing `{ error }` result shape. The `ok` discriminant lets
 *          TypeScript narrow `data` after an `if (!parsed.ok) return …` guard.
 */
export type ValidateResult<T> =
  | { ok: true; data: T; error?: undefined }
  | { ok: false; data?: undefined; error: string };

export function validate<T>(schema: z.ZodType<T>, input: unknown): ValidateResult<T> {
  const result = schema.safeParse(input);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, error: formatZodError(result.error) };
}

/** Flatten a ZodError into a compact `field: message; field: message` string. */
export function formatZodError(error: z.ZodError): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  // De-dupe (multiple issues can collapse to the same message) and join.
  return [...new Set(issues)].join("; ") || "Invalid input";
}

/* --------------------------------- Shared field schemas --------------------------------- */

/** Trimmed, non-empty, length-capped string. */
export const nonEmptyString = (max = 5000) =>
  z.string().trim().min(1, "is required").max(max, `must be ${max} characters or fewer`);

/** Optional trimmed string; empty string normalizes to undefined. */
export const optionalString = (max = 5000) =>
  z
    .string()
    .trim()
    .max(max, `must be ${max} characters or fewer`)
    .optional()
    .transform((v) => (v ? v : undefined));

/** A URL we'd store/deep-link to. Must be http(s). Optional. */
export const optionalHttpUrl = z
  .string()
  .trim()
  .url("must be a valid URL")
  .refine((u) => /^https?:\/\//i.test(u), "must be an http(s) URL")
  .max(2048, "URL is too long")
  .optional()
  .or(z.literal("").transform(() => undefined));

// The pursuit stage union (jobs-first bloom PR2, spec §3) — this WIDENS the
// same `status` field the five original statuses already lived on, so old
// `applications` docs remain valid without a migration. `applicationStatus`
// stays exported under its original name for existing importers.
export const applicationStatus = z.enum([
  "interested",
  "resume_ready",
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
]);

/* --------------------------------- Action input schemas --------------------------------- */

/** markJobAppliedAction input. `jobId` is optional so existing callers that
 *  predate the pursuit job_id linkage keep working unchanged (falls back to
 *  a plain create — see actions/jobs.ts). */
export const markJobAppliedSchema = z.object({
  company: nonEmptyString(200),
  title: nonEmptyString(300),
  applyUrl: optionalHttpUrl,
  jobId: optionalString(200),
});

/** updateApplication `updates` payload — every field optional, but no unknown keys. */
export const updateApplicationSchema = z
  .object({
    company_name: optionalString(200),
    position: optionalString(300),
    job_url: optionalHttpUrl,
    applied_at: optionalString(64),
    status: applicationStatus.optional(),
    resume_version_id: optionalString(200),
    cover_letter: optionalString(50000),
    interview_date: optionalString(64),
  })
  .strict();

/** A job snapshot captured at go-after time (spec §3) — carried on the
 *  pursuit so tailor/prep survive the listing expiring out of Meilisearch.
 *  Nullability mirrors `PublicJob`'s own fields. */
const jobSnapshotShape = {
  title: nonEmptyString(300),
  company: z.string().trim().max(200).nullable(),
  location: z.string().trim().max(200).nullable(),
  description: z.string().trim().max(20000).nullable(),
  apply_url: z.string().trim().max(2048),
};

/** upsertPursuitForJob input — the find-or-create-by-job_id chokepoint
 *  shared by goAfterJobAction and markJobAppliedAction. */
export const upsertPursuitSchema = z.object({
  job_id: nonEmptyString(200),
  ...jobSnapshotShape,
  stage: applicationStatus,
});

/** createManualPursuit input (the search seed line, spec §3 "outside
 *  interviews") — no job_id, no snapshot fields: just the two typed inputs.
 *  `status` is optional (defaults to "interviewing" — the seed line's own
 *  stage) so the guest→auth merge (`syncGuestPursuitsToServer`) can also
 *  route a manual guest pursuit through this same create chokepoint without
 *  losing whatever stage the guest already advanced it to. */
export const createManualPursuitSchema = z.object({
  company: nonEmptyString(200),
  position: nonEmptyString(300),
  status: applicationStatus.optional(),
});

/** A single provider API key save (profile.ts saveProviderApiKey). */
export const saveProviderApiKeySchema = z.object({
  provider: z.enum(["openrouter", "groq"]),
  // Empty string is allowed: it's the "clear this provider's key" signal.
  key: z.string().max(512, "API key is too long"),
});

/** feedback create (feedback.ts submitFeedback). */
export const submitFeedbackSchema = z.object({
  type: z.enum(["bug", "feedback", "other"]),
  message: nonEmptyString(5000),
  path: z.string().trim().max(2048).default(""),
});
