export interface JobIdentity {
  jobId?: string;
  applicationId?: string;
  sourceUrl?: string;
  sourceName?: string;
  companyName: string;
  jobTitle: string;
  location?: string;
  remoteStatus?: string;
  employmentType?: string;
}

export interface JobContent {
  originalJd?: string;
  normalizedJd?: string;
  responsibilities?: string[];
  requiredSkills?: string[];
  preferredSkills?: string[];
  seniority?: string;
  compensation?: string;
  lastRefreshedAt?: string;
}

export interface CandidateContext {
  selectedResumeId?: string;
  resumeVersionId?: string;
  starStoryIds?: string[];
  knowledgeSourceIds?: string[];
  candidateProfileSnapshot?: string;
}

export interface ApplicationArtifacts {
  tailoredResumeVersionId?: string;
  coverLetterId?: string;
  status?: string;
  notes?: string;
  postingOpenedAt?: string;
  appliedAt?: string;
}

export interface InterviewContext {
  round: string;
  roleFamily?: string;
  prepIntensity?: string;
  sessionMode?: "learn" | "practice";
  interviewPlanId?: string;
  practiceSessionId?: string;
  completedQuestionIds?: string[];
  starredQuestionIds?: string[];
}

export interface ArtifactProvenance {
  jdVersion?: string;
  resumeVersion?: string;
  storyIds?: string[];
  sourceIds?: string[];
  generatedAt?: string;
}

export interface PrepJobContext {
  identity: JobIdentity;
  content: JobContent;
  candidate: CandidateContext;
  artifacts: ApplicationArtifacts;
  interview: InterviewContext;
  provenance: ArtifactProvenance;
}

export function emptyPrepJobContext(
  companyName: string,
  jobTitle: string,
  round: string,
): PrepJobContext {
  return {
    identity: { companyName, jobTitle },
    content: {},
    candidate: {},
    artifacts: {},
    interview: { round },
    provenance: {},
  };
}

function stableSerializeValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(stableSerializeValue);
  }

  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = stableSerializeValue(record[key]);
  }
  return sorted;
}

export function stableSerializeJobContext(ctx: PrepJobContext): string {
  return JSON.stringify(stableSerializeValue(ctx));
}

export function fingerprintJobContext(ctx: PrepJobContext): string {
  const serialized = stableSerializeJobContext(ctx);
  let hash = 0;
  for (let i = 0; i < serialized.length; i++) {
    const char = serialized.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

export function buildPrepJobContextFromLegacy(params: {
  company: string;
  position: string;
  round: string;
  jobUrl?: string;
  jobContextText?: string;
  resumeText?: string;
  starStoryIds?: string[];
  knowledgeSourceIds?: string[];
  prepIntensity?: string;
}): PrepJobContext {
  const trimmedJd = params.jobContextText?.trim();

  return {
    identity: {
      companyName: params.company,
      jobTitle: params.position,
      ...(params.jobUrl !== undefined ? { sourceUrl: params.jobUrl } : {}),
    },
    content: {
      ...(trimmedJd !== undefined ? { originalJd: trimmedJd, normalizedJd: trimmedJd } : {}),
    },
    candidate: {
      ...(params.resumeText !== undefined
        ? { candidateProfileSnapshot: params.resumeText }
        : {}),
      ...(params.starStoryIds !== undefined ? { starStoryIds: params.starStoryIds } : {}),
      ...(params.knowledgeSourceIds !== undefined
        ? { knowledgeSourceIds: params.knowledgeSourceIds }
        : {}),
    },
    artifacts: {},
    interview: {
      round: params.round,
      ...(params.prepIntensity !== undefined ? { prepIntensity: params.prepIntensity } : {}),
    },
    provenance: {},
  };
}
