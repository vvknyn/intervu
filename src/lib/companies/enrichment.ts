import type { PublicJob } from "@/lib/jobs/types";
import { isRemoteWorkTypeValue } from "@/lib/jobs/meilisearch";
import type {
  CompanyFundingInfo,
  CompanyIntelligence,
  CompanyNewsArticle,
  CompanyTechStackInfo,
  CompanyVisaInfo,
  CompanyWorkModesInfo,
} from "./types";

// ============================================================================
// 1. Tech DNA Token Extraction
// ============================================================================

const KNOWN_LANGUAGES = [
  "TypeScript",
  "JavaScript",
  "Python",
  "Rust",
  "Go",
  "Golang",
  "Java",
  "C++",
  "C#",
  "Ruby",
  "Swift",
  "Kotlin",
  "PHP",
  "Scala",
  "Elixir",
  "SQL",
];

const KNOWN_FRAMEWORKS = [
  "React",
  "Next.js",
  "Node.js",
  "Vue",
  "Angular",
  "Django",
  "FastAPI",
  "Spring Boot",
  "GraphQL",
  "Tailwind",
  "Svelte",
  "Express",
];

const KNOWN_INFRASTRUCTURE = [
  "AWS",
  "GCP",
  "Google Cloud",
  "Azure",
  "Kubernetes",
  "Docker",
  "Terraform",
  "PostgreSQL",
  "MySQL",
  "Redis",
  "Snowflake",
  "Databricks",
  "MongoDB",
  "Kafka",
  "Elasticsearch",
];

const KNOWN_AI_ML = [
  "PyTorch",
  "TensorFlow",
  "OpenAI",
  "LLM",
  "LangChain",
  "HuggingFace",
  "CUDA",
  "RAG",
  "NLP",
  "Computer Vision",
  "Anthropic",
];

function extractAndRankTokens(
  jobs: PublicJob[],
  dictionary: string[],
  maxResults = 5,
): string[] {
  const counts = new Map<string, number>();

  for (const job of jobs) {
    const textCorpus = `${job.title} ${(job.tags || []).join(" ")} ${job.description || ""}`.toLowerCase();
    for (const token of dictionary) {
      const lower = token.toLowerCase();
      // Whole word boundary check
      const regex = new RegExp(`\\b${lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (regex.test(textCorpus)) {
        const canonical = token === "Golang" ? "Go" : token === "Google Cloud" ? "GCP" : token;
        counts.set(canonical, (counts.get(canonical) || 0) + 1);
      }
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxResults)
    .map(([token]) => token);
}

export function deriveCompanyTechStack(jobs: PublicJob[]): CompanyTechStackInfo | null {
  if (jobs.length === 0) return null;

  const languages = extractAndRankTokens(jobs, KNOWN_LANGUAGES, 5);
  const frameworks = extractAndRankTokens(jobs, KNOWN_FRAMEWORKS, 4);
  const infrastructure = extractAndRankTokens(jobs, KNOWN_INFRASTRUCTURE, 4);
  const aiMlTools = extractAndRankTokens(jobs, KNOWN_AI_ML, 3);

  if (languages.length === 0 && frameworks.length === 0 && infrastructure.length === 0) {
    return null;
  }

  return {
    languages,
    frameworks,
    infrastructure,
    aiMlTools,
  };
}

// ============================================================================
// 2. Workplace & Work Mode Flexibility
// ============================================================================

/**
 * Remote by the /jobs Remote filter's own rule (`isRemoteWorkTypeValue`,
 * `work_type` only), so the company page's remote count is the count that
 * filter returns. It used to also match "remote" in the location or the
 * title, which counted a "Remote Sensing Engineer" as a remote role.
 */
export function deriveWorkModeDistribution(jobs: PublicJob[]): CompanyWorkModesInfo | null {
  if (jobs.length === 0) return null;

  let remote = 0;
  let hybrid = 0;
  let onsite = 0;

  for (const job of jobs) {
    const wt = job.work_type || "";
    if (isRemoteWorkTypeValue(wt)) {
      remote++;
    } else if (/hybrid/i.test(wt)) {
      hybrid++;
    } else {
      onsite++;
    }
  }

  const total = jobs.length;
  return {
    remotePct: Math.round((remote / total) * 100),
    hybridPct: Math.round((hybrid / total) * 100),
    onsitePct: Math.round((onsite / total) * 100),
    remoteCount: remote,
    total,
  };
}

// ============================================================================
// 3. Capital & Financial Health — honest stage passthrough only.
//
// There is no curated funding source we can stand behind (no URL, no
// verification path). The only fact we actually hold is `company_stage`,
// aggregated from real job postings — so that is the only thing rendered.
// ============================================================================

export function deriveCompanyFunding(stage: string | null): CompanyFundingInfo | null {
  if (stage && stage.trim()) {
    return {
      totalRaisedText: null,
      stage: stage.trim(),
      valuationText: null,
      investors: [],
    };
  }

  return null;
}

// ============================================================================
// 4. Visa & H-1B Immigration Intelligence — derived from real job rows only.
//
// We hold no DOL/LCA filing data, so `h1bFilingsCount`/`approvalRatePct`
// always come back null. `sponsoredRolesRatioPct` is computed from the
// `visa_sponsorship` flag on the company's own listings, which is real.
// ============================================================================

export function deriveVisaIntelligence(jobs: PublicJob[]): CompanyVisaInfo | null {
  const sponsoredRolesCount = jobs.filter((j) => j.visa_sponsorship === true).length;
  if (sponsoredRolesCount === 0) return null;

  const sponsoredRatio = jobs.length > 0 ? Math.round((sponsoredRolesCount / jobs.length) * 100) : null;

  return {
    h1bFilingsCount: null,
    approvalRatePct: null,
    sponsoredRolesRatioPct: sponsoredRatio,
    permSponsored: false,
    topSponsoredRoles: [],
  };
}

// ============================================================================
// 5. Master Intelligence Resolver
//
// Pure: the caller (get-company.ts) owns the async I/O — fetching `news`
// from the Subspace API — and passes the already-resolved array in here.
// ============================================================================

export function resolveCompanyIntelligence(
  jobs: PublicJob[],
  stage: string | null,
  news: CompanyNewsArticle[],
): CompanyIntelligence {
  return {
    funding: deriveCompanyFunding(stage),
    visa: deriveVisaIntelligence(jobs),
    techStack: deriveCompanyTechStack(jobs),
    workModes: deriveWorkModeDistribution(jobs),
    news,
  };
}
