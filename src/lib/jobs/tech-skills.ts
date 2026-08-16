/**
 * Known standalone programming languages, frameworks, and engineering skill tokens.
 * When a query consists of or targets these skills, searches should prioritize title/tags/description
 * and avoid false-positive matches on non-tech employers named after common words (e.g. "Rust Medical Center").
 */
export const TECH_SKILL_TOKENS = new Set([
  "rust", "golang", "go", "python", "swift", "kotlin", "typescript", "javascript",
  "scala", "c++", "c#", "ruby", "elixir", "haskell", "clojure", "kubernetes", "k8s",
  "react", "angular", "vue", "nextjs", "nodejs", "node", "django", "fastapi", "flask",
  "docker", "terraform", "aws", "gcp", "azure", "graphql", "sql", "postgres", "mongodb",
  "solidity", "pytorch", "tensorflow", "llm", "genai", "prompt engineering",
]);

export function isTechSkillQuery(q: string): boolean {
  const norm = q.trim().toLowerCase();
  if (TECH_SKILL_TOKENS.has(norm)) return true;
  const words = norm.split(/\s+/);
  return words.length > 0 && words.every((w) => TECH_SKILL_TOKENS.has(w));
}
