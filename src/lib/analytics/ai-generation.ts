import { postServerCapture } from "@/lib/analytics/server-capture";
import { POSTHOG_PRODUCT } from "@/lib/posthog-options";

const TRACE_ID_PATTERN = /^[A-Za-z0-9_.:@()!',|-]{1,128}$/;
const ERROR_CODE_PATTERN = /^[A-Z0-9_]{1,40}$/;

export function sanitizeLlmFeature(raw: string | undefined): string {
  if (!raw || raw.length === 0 || raw.length > 64 || /[\r\n]/.test(raw)) {
    return "unspecified";
  }
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug.length === 0 ? "unspecified" : slug;
}

function sanitizeTraceId(id: string): string {
  if (TRACE_ID_PATTERN.test(id)) return id;
  return crypto.randomUUID();
}

function sanitizeProvider(provider: string): string {
  const lower = provider.toLowerCase();
  if (/^[a-z0-9_-]+$/.test(lower)) return lower;
  return "unknown";
}

function roundLatency(seconds: number): number {
  const nonNegative = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return Math.round(nonNegative * 1000) / 1000;
}

function isValidBaseUrl(url: string): boolean {
  if (!url.startsWith("http://") && !url.startsWith("https://")) return false;
  if (/api_key|key=|Bearer|sk-/i.test(url)) return false;
  return true;
}

export interface AiGenerationCapture {
  model: string;
  provider: string;
  feature: string;
  traceId: string;
  spanId: string;
  latencySeconds: number;
  isError: boolean;
  /** Stable code only: LLMErrorCode value or "EMPTY_RESPONSE". Never a provider message. */
  errorCode?: string;
  httpStatus?: number;
  inputTokens?: number;
  outputTokens?: number;
  /** Provider-reported USD total, only if the API returned one. Do not estimate. */
  totalCostUsd?: number;
  maxTokens?: number;
  baseUrl?: string;
  isFallback?: boolean;
  attempt?: number;
}

export function buildAiGenerationProperties(
  input: AiGenerationCapture,
): Record<string, string | number | boolean> {
  const feature = sanitizeLlmFeature(input.feature);
  const props: Record<string, string | number | boolean> = {
    $ai_trace_id: sanitizeTraceId(input.traceId),
    $ai_span_id: sanitizeTraceId(input.spanId),
    $ai_span_name: feature,
    $ai_model: input.model,
    $ai_provider: sanitizeProvider(input.provider),
    $ai_latency: roundLatency(input.latencySeconds),
    $ai_is_error: input.isError,
    $ai_stream: false,
    llm_feature: feature,
    product: POSTHOG_PRODUCT,
  };

  if (Number.isInteger(input.inputTokens) && input.inputTokens! >= 0) {
    props.$ai_input_tokens = input.inputTokens!;
  }
  if (Number.isInteger(input.outputTokens) && input.outputTokens! >= 0) {
    props.$ai_output_tokens = input.outputTokens!;
  }
  if (Number.isFinite(input.totalCostUsd) && input.totalCostUsd! >= 0) {
    props.$ai_total_cost_usd = input.totalCostUsd!;
  }
  if (input.isError && input.errorCode && ERROR_CODE_PATTERN.test(input.errorCode)) {
    props.$ai_error = input.errorCode;
  }
  if (Number.isInteger(input.httpStatus) && input.httpStatus! >= 100 && input.httpStatus! <= 599) {
    props.$ai_http_status = input.httpStatus!;
  }
  if (Number.isInteger(input.maxTokens) && input.maxTokens! > 0) {
    props.$ai_max_tokens = input.maxTokens!;
  }
  if (input.baseUrl && isValidBaseUrl(input.baseUrl)) {
    props.$ai_base_url = input.baseUrl;
  }
  if (typeof input.isFallback === "boolean") {
    props.llm_is_fallback = input.isFallback;
  }
  if (Number.isInteger(input.attempt) && input.attempt! >= 0) {
    props.llm_attempt = input.attempt!;
  }

  return props;
}

export function captureAiGeneration(input: AiGenerationCapture): void {
  try {
    postServerCapture("$ai_generation", buildAiGenerationProperties(input));
  } catch {
    // Analytics must never throw.
  }
}
