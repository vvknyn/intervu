/**
 * Single source of truth for the field directory below the jobs search hero.
 * Purely FIELD (what work you do) — "how you want to work" (remote, pay,
 * company tier) lives in shortcut controls instead. Exported for
 * `FrontDoorFieldLinks`, the jobs toolbar chip row, and guard tests.
 */
export const indexCategories = [
  {
    title: "Software and tech",
    desc: "Backend, frontend, full-stack, cloud, and platform engineering",
    q: "Software Engineer",
  },
  {
    title: "AI and data",
    desc: "Data science, machine learning, analytics, and AI engineering",
    q: "Data Scientist",
  },
  {
    title: "Product and design",
    desc: "Product management, UX/UI design, and program leadership",
    q: "Product Manager",
  },
  {
    title: "Sales and marketing",
    desc: "Account executives, growth, marketing, and customer success",
    q: "Account Executive",
  },
  {
    title: "Finance and operations",
    desc: "Finance, strategy, business operations, legal, and people ops",
    q: "Financial Analyst",
  },
  {
    title: "Biotech and life sciences",
    desc: "Biotech, pharma R&D, clinical research, and bioinformatics",
    q: "Clinical Research",
  },
] as const;
