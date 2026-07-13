import type { QuestionsData, SystemDesignData } from "@/types";
import {
  getCacheKeyForPlan,
  resolveCacheLookup,
} from "@/lib/interview-cache";
import {
  fingerprintJobContext,
  type PrepJobContext,
} from "@/lib/prep/job-context";

export interface PlanCacheKeyResolution {
  primaryKey: string;
  legacyKey: string;
  jdFingerprint?: string;
}

export function hasJdContent(ctx: PrepJobContext): boolean {
  return (
    (ctx.content.originalJd?.trim().length ?? 0) > 0 ||
    (ctx.content.normalizedJd?.trim().length ?? 0) > 0
  );
}

export function resolvePlanCacheKey(jobContext: PrepJobContext): PlanCacheKeyResolution {
  const company = jobContext.identity.companyName;
  const position = jobContext.identity.jobTitle;
  const round = jobContext.interview.round;
  const jdFingerprint = hasJdContent(jobContext)
    ? fingerprintJobContext(jobContext)
    : undefined;
  const { primaryKey, legacyKey } = resolveCacheLookup(
    company,
    position,
    round,
    jdFingerprint,
  );
  return { primaryKey, legacyKey, jdFingerprint };
}

export function resolvePlanCacheKeyFromFields(
  company: string,
  position: string,
  round: string,
  jobContext?: PrepJobContext,
): PlanCacheKeyResolution {
  if (jobContext) {
    return resolvePlanCacheKey(jobContext);
  }
  const legacyKey = getCacheKeyForPlan(company, position, round);
  return { primaryKey: legacyKey, legacyKey };
}

export function planHasSessionQuestions(
  questionsData?: QuestionsData | null,
  systemDesignData?: SystemDesignData | null,
): boolean {
  const behavioral = questionsData?.questions?.length ?? 0;
  const systemDesign = systemDesignData?.questions?.length ?? 0;
  return behavioral + systemDesign > 0;
}

export interface PrepSetupValidation {
  valid: boolean;
  message?: string;
}

export function validatePrepSetup(jobContext: PrepJobContext): PrepSetupValidation {
  const company = jobContext.identity.companyName.trim();
  const role = jobContext.identity.jobTitle.trim();
  const round = jobContext.interview.round.trim();

  if (!company) {
    return { valid: false, message: "Company is required." };
  }
  if (!role) {
    return { valid: false, message: "Role is required." };
  }
  if (!round) {
    return { valid: false, message: "Interview round is required." };
  }

  return { valid: true };
}
