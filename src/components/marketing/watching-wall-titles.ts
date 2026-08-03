/**
 * Static content for `WatchingWall` — the faint drifting field of job
 * titles behind the landing hero (2026-08-03 one-viewport rebuild). Baked
 * at build time rather than fetched: the wall is decorative background
 * texture, not a data surface, so it deliberately costs zero network calls
 * and can't fail/flash empty.
 *
 * Company-attributed entries use ONLY companies already named in the
 * landing's own marketing thread (`WHATSAPP_THREAD` above — Ramp, Vanta,
 * Deel) so nothing here reads as a fabricated client logo; every other
 * entry is a bare role title with no company, which is how most of the
 * wall reads.
 */
export const WATCHING_WALL_TITLES: readonly string[] = [
  "Senior Product Manager — Ramp",
  "Staff Software Engineer — Vanta",
  "Product Designer — Deel",
  "Backend Engineer — Ramp",
  "Security Engineer — Vanta",
  "International Payroll Analyst — Deel",
  "Senior Software Engineer",
  "Engineering Manager",
  "Product Marketing Manager",
  "Data Scientist",
  "Site Reliability Engineer",
  "Growth Marketing Manager",
  "Technical Program Manager",
  "Frontend Engineer",
  "Machine Learning Engineer",
  "Customer Success Manager",
  "Solutions Engineer",
  "Sales Development Representative",
  "Account Executive",
  "DevOps Engineer",
  "Full Stack Engineer",
  "UX Researcher",
  "Compliance Analyst",
  "Revenue Operations Manager",
  "Support Engineer",
  "Platform Engineer",
  "Staff Product Manager",
  "Business Systems Analyst",
  "Recruiter",
  "People Operations Manager",
  "Finance Manager",
  "Senior Data Engineer",
  "Head of Partnerships",
  "Content Designer",
  "Security Analyst",
  "Infrastructure Engineer",
  "Payments Engineer",
  "Risk Analyst",
  "Software Engineer, Platform",
  "Staff Engineer, Infrastructure",
];
