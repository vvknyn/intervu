"use client";

import { useState, useEffect, useCallback } from "react";
import {
    Sparkle,
    Brain,
    Globe,
    CalendarCheck,
    CurrencyDollar,
    FileText,
    Crown,
    Heart,
    X,
    Shuffle,
    CaretLeft,
    CaretRight,
    BookmarkSimple,
    Check,
    Buildings,
    MapPin,
    Clock,
    Briefcase,
    Cards,
    List,
    Sliders,
    User,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { jobsBrowseSearchHref, jobsForYouHubHref } from "@/lib/jobs/prefetch-jobs-route";
import { cn } from "@/lib/utils";
import { matchBandLabel } from "@/lib/match/score";
import { WaitState } from "@/components/ui/wait-state";
import { readPacksProofLoading } from "@/lib/jobs/for-you/packs-proof-loading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SolidBadge } from "@/components/ui/badge";
import { TabItem, TabNav } from "@/components/ui/tabs";
import {
    Dialog,
    DialogBody,
    DialogContent,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "@/lib/toast";
import type { ResumeData } from "@/types/resume";
import { readLocalAiResume, writeLocalAiResume } from "@/lib/local-ai/resume-storage";
import { hubGreeting } from "@/lib/jobs/front-door-state";

export interface RoleDetailListing {
    id: string;
    title: string;
    company: string;
    companyDomain?: string;
    location: string;
    workType: "Remote" | "Hybrid" | "On-site";
    salary: string;
    postedAgo: string;
    fitBand: "strong" | "good" | "stretch";
    department: string;
    seniority: string;
    tags: string[];
    overview: string;
    responsibilities: string[];
    requirements: string[];
    fitReasons: string[];
    benefits: string[];
}

export interface CategoryHubItem {
    id: string;
    label: string;
    /** Live or honest fallback — empty omits the count pill (never invent numbers). */
    countLabel?: string;
    icon: React.ElementType;
    badgeLabel: string;
    subtitle: string;
    jobs: RoleDetailListing[];
}

export const CATEGORY_JOBS_CATALOG: Record<string, RoleDetailListing[]> = {
    ai: [
        {
            id: "ai-1",
            title: "Senior AI Product Manager — Frontier Interfaces",
            company: "Anthropic",
            companyDomain: "anthropic.com",
            location: "San Francisco, CA",
            workType: "Hybrid",
            salary: "$185,000 – $240,000 / yr",
            postedAgo: "3d ago",
            fitBand: "strong",
            department: "Applied AI Products",
            seniority: "Senior",
            tags: ["Claude", "Prompt Workflows", "Developer APIs", "Model Safety"],
            overview:
                "Anthropic builds reliable, beneficial, and steerable AI systems. In this role, you will lead the core product roadmap for Claude's conversational surfaces, interactive reasoning canvases, and developer SDKs.",
            responsibilities: [
                "Guide discovery and product execution across Claude web, desktop, and developer tools.",
                "Partner directly with alignment researchers to turn safety and steerability advances into intuitive customer features.",
                "Establish performance standards for latency, context utilization, and developer productivity.",
                "Work hand-in-hand with engineering leaders to optimize inference cost and streaming responsiveness.",
            ],
            requirements: [
                "5+ years of product management experience, with at least 2+ years leading developer-facing or AI-native tools.",
                "Deep intuition for prompt engineering, context windows, and structured tool invocation.",
                "Demonstrated history of launching customer-loved tools from zero to scale.",
                "Care and empathy for alignment research and responsible AI deployment.",
            ],
            fitReasons: [
                "Proven background shipping developer-first web workflows and user onboarding.",
                "Extensive track record measuring product engagement and reducing latency friction.",
                "Location matches your preferred San Francisco / Bay Area hybrid hub.",
            ],
            benefits: [
                "Comprehensive medical, dental, and vision with 100% premium coverage.",
                "$5,000 annual continuous education and conference travel stipend.",
                "401(k) matching up to 4% with immediate vesting.",
                "Flexible PTO policy and ergonomic home office equipment budget.",
            ],
        },
        {
            id: "ai-2",
            title: "Founding Machine Learning Systems Engineer",
            company: "Cerebras Systems",
            companyDomain: "cerebras.net",
            location: "Sunnyvale, CA",
            workType: "On-site",
            salary: "$200,000 – $260,000 / yr",
            postedAgo: "1d ago",
            fitBand: "strong",
            department: "Core Systems",
            seniority: "Staff",
            tags: ["Wafer Scale", "PyTorch", "C++", "CUDA Kernels"],
            overview:
                "Cerebras has built the largest computer chip in history to radically accelerate deep learning. You will write high-performance distributed kernels and scale foundation model training across massive wafer clusters.",
            responsibilities: [
                "Architect and write low-latency distributed communication kernels for foundation models.",
                "Benchmark and optimize memory bandwidth, tensor parallelism, and FLOPS utilization.",
                "Collaborate with frontier research teams to run massive generative training runs without bottlenecks.",
                "Diagnose performance anomalies across custom compiler and silicon layers.",
            ],
            requirements: [
                "Strong fluency in C++, PyTorch internals, and distributed GPU/accelerator communication.",
                "Practical experience optimizing transformer attention kernels and memory layout.",
                "Solid grasp of numerical stability in FP16, BF16, and FP8 precision training.",
                "Bachelors or advanced degree in Computer Science, Electrical Engineering, or equivalent experience.",
            ],
            fitReasons: [
                "Deep experience with low-level systems engineering and runtime optimization.",
                "Track record with high-throughput distributed architectures.",
            ],
            benefits: [
                "Top-tier equity package in a high-growth scale-up.",
                "Daily gourmet catered lunch and dinner on campus.",
                "Full health insurance, life insurance, and commuter benefits.",
            ],
        },
        {
            id: "ai-3",
            title: "Generative AI Solutions Architect",
            company: "Canva",
            companyDomain: "canva.com",
            location: "Remote (US)",
            workType: "Remote",
            salary: "$140,000 – $175,000 / yr",
            postedAgo: "5d ago",
            fitBand: "strong",
            department: "Creative Intelligence",
            seniority: "Senior",
            tags: ["Diffusion Models", "Next.js", "Media Generation", "Python"],
            overview:
                "Empower over 170 million monthly active users to create anything effortlessly. You will bridge our research models with real-time browser canvas tools, ensuring generative features render in milliseconds.",
            responsibilities: [
                "Integrate multimodal generation pipelines into Canva's real-time collaborative editor.",
                "Design client-side caching and streaming protocols for instant visual feedback.",
                "Conduct quality evaluations and human-in-the-loop safety benchmarks.",
                "Guide partner integrations across image, audio, and vector generation APIs.",
            ],
            requirements: [
                "Demonstrated experience integrating generative vision or multimodal models into web applications.",
                "Strong proficiency in TypeScript, React, and Python microservices.",
                "Passion for user experience and visual design tools.",
            ],
            fitReasons: [
                "Strong frontend systems background and responsive UI craftsmanship.",
                "Demonstrated remote collaboration excellence across timezones.",
            ],
            benefits: [
                "100% remote flexibility with home workspace setup allowance.",
                "Annual 'Vibe' wellness stipend and continuous growth budget.",
                "Generous parental leave and flexible schedule options.",
            ],
        },
        {
            id: "ai-4",
            title: "Senior Research Scientist — Reasoning & Code",
            company: "Cohere",
            companyDomain: "cohere.com",
            location: "Seattle, WA",
            workType: "Hybrid",
            salary: "$190,000 – $250,000 / yr",
            postedAgo: "4d ago",
            fitBand: "strong",
            department: "Frontier Research",
            seniority: "Senior",
            tags: ["RAG", "Embeddings", "Chain-of-Thought", "Evaluation"],
            overview:
                "Cohere creates frontier language models built specifically for enterprise applications. You will conduct empirical research on multistep reasoning, retrieval-augmented generation (RAG), and programmatic verification.",
            responsibilities: [
                "Design novel pre-training and fine-tuning techniques to boost reasoning accuracy on complex tasks.",
                "Publish empirical findings and contribute breakthroughs directly into production foundation models.",
                "Develop rigorous evaluation benchmarks for enterprise hallucination prevention.",
                "Partner with solutions teams to test models against enterprise customer workloads.",
            ],
            requirements: [
                "PhD or equivalent research experience in Natural Language Processing or Machine Learning.",
                "First-author publications at top-tier venues (NeurIPS, ICML, ICLR, ACL).",
                "Proven ability to translate mathematical insights into reproducible PyTorch code.",
            ],
            fitReasons: [
                "Strong background in experimental rigor, evaluation frameworks, and benchmarking.",
                "Shared focus on high-efficiency, practical AI models.",
            ],
            benefits: [
                "Competitive base salary plus significant equity grant.",
                "Hybrid downtown office with top-tier research compute access.",
                "Health, wellness, and mental health support plans.",
            ],
        },
    ],
    all: [
        {
            id: "all-1",
            title: "Senior Digital Product Manager",
            company: "Litmus",
            companyDomain: "litmus.com",
            location: "Seattle, WA",
            workType: "Remote",
            salary: "$102,000 – $124,000 / yr",
            postedAgo: "9d ago",
            fitBand: "strong",
            department: "Core Experience",
            seniority: "Senior",
            tags: ["Product Strategy", "B2B SaaS", "User Journeys", "Email Tech"],
            overview:
                "Litmus is the email marketing platform relied on by over 700,000 professionals worldwide. You will lead the core creation, previewing, and analytics workflows that help teams deliver high-impact email campaigns.",
            responsibilities: [
                "Own the product roadmap for Litmus Builder and automated pre-send testing.",
                "Conduct customer discovery interviews and translate findings into clear engineering specs.",
                "Monitor funnel metrics, trial conversion, and feature retention to guide iterative releases.",
                "Coordinate cross-functional launches with product marketing, customer success, and sales.",
            ],
            requirements: [
                "4+ years in product management at a B2B SaaS company.",
                "Demonstrated skill balancing technical debt, customer feedback, and strategic business goals.",
                "Familiarity with web standards, rendering engines, and developer workflows.",
            ],
            fitReasons: [
                "Strong fit for your background in product lifecycle management and user-centered design.",
                "Experience working directly with engineering and design to streamline onboarding.",
            ],
            benefits: [
                "Full health and dental coverage starting on day one.",
                "Quarterly company-wide recharge days.",
                "Annual home office and wellness stipends.",
            ],
        },
        {
            id: "all-2",
            title: "Staff Frontend Engineer — Web Platform",
            company: "Stripe",
            companyDomain: "stripe.com",
            location: "San Francisco, CA",
            workType: "Hybrid",
            salary: "$190,000 – $240,000 / yr",
            postedAgo: "2d ago",
            fitBand: "strong",
            department: "Web Infrastructure",
            seniority: "Staff",
            tags: ["React", "TypeScript", "Performance", "Design Systems"],
            overview:
                "Stripe builds economic infrastructure for the internet. As a Staff Frontend Engineer on Web Platform, you will shape the architecture, design tokens, and build pipelines that power millions of checkout flows daily.",
            responsibilities: [
                "Drive web architecture decisions that improve bundle size, Core Web Vitals, and accessibility.",
                "Author reusable component primitives consumed by hundreds of product engineers.",
                "Mentor senior engineers and conduct architecture design reviews across teams.",
                "Safeguard reliability across high-volume checkout surfaces that process billions of dollars.",
            ],
            requirements: [
                "7+ years building large-scale TypeScript/React web applications.",
                "Deep mastery of browser rendering, DOM performance, and accessibility standards.",
                "Track record leading architectural initiatives across multiple organizational boundaries.",
            ],
            fitReasons: [
                "Deep experience with component systems and performance profiling.",
                "Strong adherence to high code quality and type safety standards.",
            ],
            benefits: [
                "Comprehensive health, vision, and mental healthcare plans.",
                "Generous 401(k) program and fertility support.",
                "Commuter benefits and annual learning allowance.",
            ],
        },
        {
            id: "all-3",
            title: "Lead Product Systems Designer",
            company: "Linear",
            companyDomain: "linear.app",
            location: "Remote",
            workType: "Remote",
            salary: "$165,000 – $195,000 / yr",
            postedAgo: "4d ago",
            fitBand: "strong",
            department: "Product Design",
            seniority: "Lead",
            tags: ["Design Systems", "Figma", "Keyboard Shortcuts", "Precision"],
            overview:
                "Linear is known for its uncompromising craftsmanship, speed, and keyboard-first workflows. You will lead the evolution of Linear's design system, crafting atomic components and interaction standards.",
            responsibilities: [
                "Define and evolve design primitives across desktop, web, and mobile surfaces.",
                "Design keyboard shortcuts, micro-interactions, and high-density data visualizations.",
                "Work directly in code alongside frontend engineers to refine animations and typography.",
                "Champion aesthetic consistency and speed across all product squads.",
            ],
            requirements: [
                "5+ years designing craft-forward software products.",
                "Exceptional portfolio showing precision typography, layout systems, and motion.",
                "Hands-on ability to prototype interactions using code or high-fidelity tools.",
            ],
            fitReasons: [
                "Obsession with clean Swiss Modernist design and zero-jargon user interfaces.",
                "Proven ability to produce high-density, legible layouts.",
            ],
            benefits: [
                "Competitive salary with equity in an iconic, profitable company.",
                "Work from anywhere in the world with total asynchronous schedule autonomy.",
                "Top-of-the-line hardware and workspace budget.",
            ],
        },
    ],
    remote: [
        {
            id: "remote-1",
            title: "Staff Frontend Engineer — Edge Frameworks",
            company: "Vercel",
            companyDomain: "vercel.com",
            location: "Remote (Global)",
            workType: "Remote",
            salary: "$175,000 – $225,000 / yr",
            postedAgo: "2d ago",
            fitBand: "strong",
            department: "Frameworks & Runtime",
            seniority: "Staff",
            tags: ["Next.js", "Edge Middleware", "React Server Components", "Turbopack"],
            overview:
                "Vercel enables developers to build and deploy the web faster. You will lead features within Next.js and Vercel Edge Network, optimizing React Server Components streaming and edge caching worldwide.",
            responsibilities: [
                "Design low-latency primitives for React Server Components and Edge Middleware.",
                "Profile and debug real-world web performance bottlenecks at global scale.",
                "Collaborate openly with the open-source community to resolve framework RFCs.",
                "Author clear documentation and reproducible test suites.",
            ],
            requirements: [
                "6+ years of modern JavaScript/TypeScript experience.",
                "Deep understanding of HTTP caching, edge computing, and server-side rendering.",
                "Clear communication skills in an async, remote-first environment.",
            ],
            fitReasons: [
                "Demonstrated track record with Next.js web application architecture.",
                "Proven remote work discipline and technical writing clarity.",
            ],
            benefits: [
                "Work from anywhere with full remote stipends.",
                "Unlimited PTO policy with recommended minimums.",
                "Full health insurance and equity options.",
            ],
        },
        {
            id: "remote-2",
            title: "Senior Product Designer — Developer Ops",
            company: "GitLab",
            companyDomain: "gitlab.com",
            location: "Remote (Americas)",
            workType: "Remote",
            salary: "$150,000 – $180,000 / yr",
            postedAgo: "4d ago",
            fitBand: "strong",
            department: "CI/CD & Verify",
            seniority: "Senior",
            tags: ["Async Culture", "GitLab CI", "Figma", "Open Source"],
            overview:
                "GitLab is an all-remote pioneer building the complete DevSecOps platform. You will design intuitive pipeline configuration, automated testing dashboards, and deployment observability tools.",
            responsibilities: [
                "Conduct user research with DevOps engineers and software architects.",
                "Translate complex pipeline dependencies into clear, visual workflows.",
                "Collaborate openly in public GitLab issues and merge requests.",
                "Contribute to Pajamas, GitLab's open-source design system.",
            ],
            requirements: [
                "4+ years of product design experience on technical or developer-focused software.",
                "Comfort working in a fully public, asynchronous, handbook-first company culture.",
            ],
            fitReasons: [
                "Strong experience simplifying complex workflows into plain, actionable views.",
            ],
            benefits: [
                "True remote flexibility across timezones.",
                "Growth and conference travel budget.",
                "Parental leave and wellness support.",
            ],
        },
    ],
    fresh: [
        {
            id: "fresh-1",
            title: "Full Stack Engineer — Database Platform",
            company: "Supabase",
            companyDomain: "supabase.com",
            location: "Remote",
            workType: "Remote",
            salary: "$145,000 – $185,000 / yr",
            postedAgo: "1d ago",
            fitBand: "strong",
            department: "Database Tooling",
            seniority: "Senior",
            tags: ["Postgres", "Elixir", "TypeScript", "Realtime"],
            overview:
                "Supabase is the open-source Firebase alternative built on Postgres. You will build realtime replication features, database branching tools, and client-side SDKs used by hundreds of thousands of developers.",
            responsibilities: [
                "Build full-stack dashboard tools for Postgres schema management and migrations.",
                "Write secure, high-concurrency APIs for instant database provisioning.",
                "Contribute to open-source client libraries and documentation.",
            ],
            requirements: [
                "Strong proficiency with PostgreSQL, TypeScript, and modern web frameworks.",
                "Passion for open source and developer ergonomics.",
            ],
            fitReasons: [
                "Demonstrated background with database-backed web architectures.",
            ],
            benefits: [
                "Global remote setup with co-working allowances.",
                "Generous equity and flexible vacation.",
            ],
        },
        {
            id: "fresh-2",
            title: "Engineering Manager — Canvas Collaboration",
            company: "Figma",
            companyDomain: "figma.com",
            location: "San Francisco, CA",
            workType: "Hybrid",
            salary: "$220,000 – $280,000 / yr",
            postedAgo: "Today",
            fitBand: "strong",
            department: "Core Editor",
            seniority: "Manager",
            tags: ["WebAssembly", "C++", "Multiplayer", "Mentorship"],
            overview:
                "Lead the team responsible for Figma's ultra-reliable multiplayer canvas engine. You will mentor engineers, guide technical strategy, and maintain performance as millions collaborate in real time.",
            responsibilities: [
                "Manage and grow a team of 7 high-performing systems and web engineers.",
                "Partner with product and design leaders to define quarterly technical milestones.",
                "Foster an inclusive, supportive engineering culture of high craftsmanship.",
            ],
            requirements: [
                "2+ years of engineering management experience.",
                "Prior technical background in high-performance graphics, WebAssembly, or multiplayer systems.",
            ],
            fitReasons: [
                "Proven leadership and cross-functional team coordination skills.",
            ],
            benefits: [
                "Top-tier compensation and equity grant.",
                "Full medical, dental, and vision insurance with dependent coverage.",
            ],
        },
    ],
    salary: [
        {
            id: "salary-1",
            title: "Principal Distributed Telemetry Engineer",
            company: "Datadog",
            companyDomain: "datadoghq.com",
            location: "New York, NY",
            workType: "Hybrid",
            salary: "$250,000 – $320,000 / yr",
            postedAgo: "4d ago",
            fitBand: "strong",
            department: "Observability Pipeline",
            seniority: "Principal",
            tags: ["Kafka", "High Throughput", "Go", "Storage"],
            overview:
                "Datadog's observability platform processes trillions of events daily. You will architect telemetry ingestion pipelines with extreme availability, strict zero-data-loss guarantees, and low compute cost.",
            responsibilities: [
                "Design petabyte-scale distributed ingestion engines using Go and Kafka.",
                "Lead cross-team incident reviews and drive proactive resilience engineering.",
                "Set multi-year architectural direction for data storage and indexing.",
            ],
            requirements: [
                "8+ years architecting high-throughput distributed backends.",
                "Extensive hands-on experience with Go, Linux internals, and high-volume data streams.",
            ],
            fitReasons: [
                "Matches your seniority criteria and transparent salary bracket ($250k+).",
            ],
            benefits: [
                "Industry-leading 401(k) match and executive health coverage.",
                "Substantial RSU equity package with quarterly vesting.",
            ],
        },
        {
            id: "salary-2",
            title: "Staff Product Manager — Enterprise Data Sharing",
            company: "Snowflake",
            companyDomain: "snowflake.com",
            location: "San Mateo, CA",
            workType: "Hybrid",
            salary: "$210,000 – $270,000 / yr",
            postedAgo: "6d ago",
            fitBand: "strong",
            department: "Data Cloud",
            seniority: "Staff",
            tags: ["Data Cloud", "SQL", "Compliance", "Enterprise"],
            overview:
                "Snowflake enables organizations to mobilize data at global scale. You will own cross-cloud data sharing and governance features across AWS, Azure, and Google Cloud.",
            responsibilities: [
                "Define user requirements for zero-copy data sharing between global enterprises.",
                "Coordinate with security and compliance teams to ensure strict privacy boundaries.",
                "Engage Fortune 500 CIOs to uncover enterprise collaboration needs.",
            ],
            requirements: [
                "6+ years in enterprise product management.",
                "Deep familiarity with SQL, cloud infrastructure, and data governance.",
            ],
            fitReasons: [
                "Matches executive compensation and enterprise scale profile.",
            ],
            benefits: [
                "Transparent base salary plus performance bonus and equity.",
                "Comprehensive family benefits package.",
            ],
        },
    ],
    apply: [
        {
            id: "apply-1",
            title: "Senior React UI Developer",
            company: "Retool",
            companyDomain: "retool.com",
            location: "San Francisco, CA",
            workType: "Hybrid",
            salary: "$160,000 – $195,000 / yr",
            postedAgo: "3d ago",
            fitBand: "strong",
            department: "UI Framework",
            seniority: "Senior",
            tags: ["Component Primitives", "TypeScript", "Drag & Drop", "DOM"],
            overview:
                "Retool is the fast way to build internal tools. You will build high-performance UI primitives and drag-and-drop canvas components that empower non-technical users to build custom business software.",
            responsibilities: [
                "Build reliable, accessible React component libraries used inside Retool's canvas.",
                "Optimize real-time state updates when thousands of components render together.",
                "Collaborate with product designers to ship intuitive layout and spacing controls.",
            ],
            requirements: [
                "4+ years building sophisticated React/TypeScript user interfaces.",
                "Solid understanding of the DOM, browser layout algorithms, and keyboard navigation.",
            ],
            fitReasons: [
                "Strong fit for your background in React and design systems.",
            ],
            benefits: [
                "Fast-track interview process with verified hiring manager response.",
                "Competitive salary, equity, and health coverage.",
            ],
        },
    ],
    lead: [
        {
            id: "lead-1",
            title: "VP of Engineering",
            company: "Loom (Atlassian)",
            companyDomain: "loom.com",
            location: "Remote",
            workType: "Remote",
            salary: "$240,000 – $310,000 / yr",
            postedAgo: "5d ago",
            fitBand: "strong",
            department: "Engineering Leadership",
            seniority: "VP",
            tags: ["Video Infrastructure", "Org Strategy", "AI Summaries", "Scale"],
            overview:
                "Lead 60+ distributed engineers building high-efficiency asynchronous video recording, transcoder pipelines, and AI-powered meeting summaries.",
            responsibilities: [
                "Set technical vision and organizational strategy across recording, web, and AI squads.",
                "Manage directors and senior engineering managers with a focus on psychological safety and speed.",
                "Partner with executive peers to align engineering investments with company growth.",
            ],
            requirements: [
                "Proven leadership experience managing managers in high-growth SaaS environments.",
                "Strong background in distributed systems and user-facing video software.",
            ],
            fitReasons: [
                "Matches leadership trajectory and distributed team management experience.",
            ],
            benefits: [
                "Executive compensation package with extensive equity.",
                "Comprehensive family healthcare and flexible work lifestyle.",
            ],
        },
    ],
    good: [
        {
            id: "good-1",
            title: "Lead Sensor Hardware & Software Engineer",
            company: "Charity: Water",
            companyDomain: "charitywater.org",
            location: "Remote (US)",
            workType: "Remote",
            salary: "$140,000 – $170,000 / yr",
            postedAgo: "6d ago",
            fitBand: "strong",
            department: "Water Programs & IoT",
            seniority: "Lead",
            tags: ["IoT Sensors", "Clean Water", "React", "Global Impact"],
            overview:
                "Charity: Water is on a mission to bring clean water to every person on the planet. You will build connected sensor telemetry platforms that provide real-time flow monitoring for thousands of remote rural wells.",
            responsibilities: [
                "Develop firmware and web dashboards tracking daily water flow from rural community wells.",
                "Optimize cellular satellite uplinks for low-power remote IoT hardware.",
                "Create public impact transparency dashboards showing donors real-time water flow.",
            ],
            requirements: [
                "5+ years building connected IoT hardware/software or telemetry systems.",
                "Mission-driven desire to apply technical skills to solve global water poverty.",
            ],
            fitReasons: [
                "Mission alignment and telemetry platform engineering background.",
            ],
            benefits: [
                "Purpose-driven culture with direct visible humanitarian impact.",
                "Full health insurance, 401(k), and flexible time off.",
            ],
        },
    ],
};

export const DEFAULT_CATEGORY_HUBS: CategoryHubItem[] = [
    {
        id: "all",
        label: "All your matches",
        countLabel: "",
        icon: Sparkle,
        badgeLabel: "Matches",
        subtitle: "Roles matched against your résumé",
        jobs: CATEGORY_JOBS_CATALOG.all,
    },
    {
        id: "ai",
        label: "Artificial intelligence",
        countLabel: "",
        icon: Brain,
        badgeLabel: "AI & ML",
        subtitle: "Frontier models & GenAI",
        jobs: CATEGORY_JOBS_CATALOG.ai,
    },
    {
        id: "remote",
        label: "Fully remote",
        countLabel: "",
        icon: Globe,
        badgeLabel: "Remote",
        subtitle: "Work from anywhere",
        jobs: CATEGORY_JOBS_CATALOG.remote,
    },
    {
        id: "fresh",
        label: "Added this week",
        countLabel: "",
        icon: CalendarCheck,
        badgeLabel: "Fresh",
        subtitle: "Posted within last 7 days",
        jobs: CATEGORY_JOBS_CATALOG.fresh,
    },
    {
        id: "salary",
        label: "Jobs with salaries",
        countLabel: "",
        icon: CurrencyDollar,
        badgeLabel: "$120k+",
        subtitle: "Roles with compensation listed",
        jobs: CATEGORY_JOBS_CATALOG.salary,
    },
    {
        id: "apply",
        label: "1-Click tailored apply",
        countLabel: "",
        icon: FileText,
        badgeLabel: "Fast Apply",
        subtitle: "Pre-calibrated for tailored résumé generation",
        jobs: CATEGORY_JOBS_CATALOG.apply,
    },
    {
        id: "lead",
        label: "Lead & principal",
        countLabel: "",
        icon: Crown,
        badgeLabel: "Leadership",
        subtitle: "Executive, staff, and principal tracks",
        jobs: CATEGORY_JOBS_CATALOG.lead,
    },
    {
        id: "good",
        label: "Tech for good",
        countLabel: "",
        icon: Heart,
        badgeLabel: "Mission",
        subtitle: "Mission-driven & sustainability",
        jobs: CATEGORY_JOBS_CATALOG.good,
    },
];

export interface CategoryHubGridProps {
    userName?: string | null;
    isAuthenticated?: boolean;
    hasResume?: boolean;
    resume?: ResumeData | null;
    onUpdateResume?: (resume: ResumeData) => void;
    onAdjustParameters?: () => void;
    activeCategoryId?: string;
    onSelectCategory?: (category: CategoryHubItem) => void;
    onTailorApply?: (job: RoleDetailListing) => void;
    onOpenAdvancedSearch?: () => void;
    /** Live count labels keyed by hub id — overrides DEFAULT_CATEGORY_HUBS.countLabel. */
    hubCountLabels?: Partial<Record<string, string>>;
    /** Quiet daily apply tip near Browse all / greeting. */
    dailyApplyTip?: string | null;
    /** True while the progressive fit probe is still climbing pack counts. */
    hubMatching?: boolean;
    /** Quiet corpus line under Welcome, e.g. "~508 matches ranked Strong first". */
    hubCorpusLine?: string | null;
    /** Honest removal cue when prior known pack counts shrink. */
    hubRemovalsLine?: string | null;
    className?: string;
}

export function CategoryHubGrid({
    userName,
    isAuthenticated = false,
    hasResume = false,
    resume,
    onUpdateResume,
    onAdjustParameters,
    activeCategoryId,
    onSelectCategory,
    onTailorApply,
    onOpenAdvancedSearch,
    hubCountLabels,
    dailyApplyTip,
    hubMatching = false,
    hubCorpusLine = null,
    hubRemovalsLine = null,
    className,
}: CategoryHubGridProps) {
    const router = useRouter();
    const [modalCategory, setModalCategory] = useState<CategoryHubItem | null>(null);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [viewMode, setViewMode] = useState<"shuffle" | "list">("shuffle");
    const [savedRoleIds, setSavedRoleIds] = useState<Set<string>>(new Set());

    // Profile Parameter editing state
    const [profileModalOpen, setProfileModalOpen] = useState(false);
    const [proofLoading, setProofLoading] = useState(false);
    useEffect(() => {
        setProofLoading(readPacksProofLoading());
    }, []);

    useEffect(() => {
        try {
            router.prefetch(jobsForYouHubHref());
            router.prefetch(jobsBrowseSearchHref(""));
        } catch {
            /* prefetch is best-effort */
        }
    }, [router]);
    const [profileName, setProfileName] = useState("");
    const [profileRole, setProfileRole] = useState("");
    const [profileYears, setProfileYears] = useState(0);
    const [profileLocation, setProfileLocation] = useState("");
    const [profileSkills, setProfileSkills] = useState("");

    // Sync profile state from resume prop or local AI cache
    useEffect(() => {
        let activeData: ResumeData | null = resume || null;
        if (!activeData && typeof window !== "undefined") {
            const local = readLocalAiResume();
            if (local?.data) activeData = local.data;
        }

        if (activeData) {
            setProfileName(activeData.profile?.name || userName || "");
            setProfileRole(activeData.profile?.profession || "");
            setProfileYears(activeData.profile?.yearsOfExperience || 0);
            setProfileLocation(activeData.profile?.location || "");
            const allSkills = (activeData.competencies || []).flatMap((c) => c.skills);
            setProfileSkills(allSkills.join(", "));
        } else if (userName) {
            setProfileName(userName);
        }
    }, [resume, userName]);

    const handleSaveProfileParameters = () => {
        const skillsArray = profileSkills
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);

        let baseData: ResumeData = resume || {
            profile: {
                name: profileName,
                profession: profileRole,
                yearsOfExperience: profileYears,
                location: profileLocation,
                email: "",
                phone: "",
            },
            generatedSummary: "",
            competencies: [],
            experience: [],
            education: [],
        };

        if (typeof window !== "undefined" && !resume) {
            const local = readLocalAiResume();
            if (local?.data) baseData = local.data;
        }

        const updatedResume: ResumeData = {
            ...baseData,
            profile: {
                ...baseData.profile,
                name: profileName,
                profession: profileRole,
                yearsOfExperience: profileYears,
                location: profileLocation,
            },
            competencies:
                baseData.competencies && baseData.competencies.length > 0
                    ? [
                          {
                              ...baseData.competencies[0],
                              skills: skillsArray,
                          },
                          ...baseData.competencies.slice(1),
                      ]
                    : skillsArray.length > 0
                      ? [{ category: "Core Competencies", skills: skillsArray }]
                      : [],
        };

        writeLocalAiResume(updatedResume, new Date().toISOString(), "Adjusted parameters");
        onUpdateResume?.(updatedResume);
        toast.success("Profile parameters saved");
        setProfileModalOpen(false);
    };

    const handleCategoryClick = (category: CategoryHubItem) => {
        // Parent (jobs page) mounts ForYouHome postcard when onSelectCategory
        // is provided. Keep the hub-internal modal only as a standalone fallback.
        if (onSelectCategory) {
            onSelectCategory(category);
            return;
        }
        setModalCategory(category);
        setCurrentIndex(0);
    };

    const currentJobs = modalCategory?.jobs ?? [];
    const activeRole: RoleDetailListing | undefined = currentJobs[currentIndex];

    const handleNext = useCallback(() => {
        if (currentJobs.length === 0) return;
        setCurrentIndex((prev) => (prev + 1) % currentJobs.length);
    }, [currentJobs.length]);

    const handlePrev = useCallback(() => {
        if (currentJobs.length === 0) return;
        setCurrentIndex((prev) => (prev - 1 + currentJobs.length) % currentJobs.length);
    }, [currentJobs.length]);

    const handleShuffle = useCallback(() => {
        if (currentJobs.length <= 1) return;
        let nextIndex = currentIndex;
        while (nextIndex === currentIndex) {
            nextIndex = Math.floor(Math.random() * currentJobs.length);
        }
        setCurrentIndex(nextIndex);
        toast.info("Shuffled to another role in this category");
    }, [currentIndex, currentJobs.length]);

    const toggleSaveRole = (roleId: string) => {
        setSavedRoleIds((prev) => {
            const next = new Set(prev);
            if (next.has(roleId)) {
                next.delete(roleId);
                toast.info("Removed role from saved items");
            } else {
                next.add(roleId);
                toast.info("Role saved to your private list");
            }
            return next;
        });
    };

    const handleTailorApply = (job: RoleDetailListing) => {
        if (onTailorApply) {
            onTailorApply(job);
        } else {
            toast.info(`Preparing tailored application for ${job.title} at ${job.company}…`);
        }
    };

    // Keyboard navigation in modal: Left arrow, Right arrow, S for shuffle
    useEffect(() => {
        if (!modalCategory) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
                return;
            }
            if (e.key === "ArrowRight") {
                e.preventDefault();
                handleNext();
            } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                handlePrev();
            } else if (e.key === "s" || e.key === "S") {
                e.preventDefault();
                handleShuffle();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [modalCategory, handleNext, handlePrev, handleShuffle]);

    const { title: greetingTitle, subtitle: greetingSubtitle } = hubGreeting({
        signedIn: isAuthenticated,
        userName,
        hasResume,
    });

    const resolveCountLabel = (category: CategoryHubItem): string => {
        const live = hubCountLabels?.[category.id];
        if (live != null && live !== "") return live;
        return category.countLabel?.trim() ?? "";
    };


    return (
        <section
            aria-label="Job categories"
            data-testid="job-packs-hub"
            className={cn(
                "space-y-4 px-0 pb-[max(0.5rem,env(safe-area-inset-bottom))] touch-manipulation",
                className,
            )}
        >
            {/* Welcome banner — Concept A calm Velai panel */}
            <div className="rounded-panel border border-border bg-surface shadow-[var(--shadow-bevel-highlight)] p-4 sm:p-7">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <div className="space-y-1">
                        {hasResume && (
                            <div className="inline-flex items-center gap-1.5 rounded-pill bg-muted px-2.5 py-0.5 text-xs font-semibold text-live">
                                <span className="h-1.5 w-1.5 rounded-pill bg-live" />
                                Private matching active on this device
                            </div>
                        )}
                        <h2 className="text-xl font-semibold text-foreground">
                            {greetingTitle}
                        </h2>
                        <p className="text-xs text-muted-foreground">
                            {greetingSubtitle}
                        </p>
                        {dailyApplyTip ? (
                            <p
                                className="pt-1 text-xs text-muted-foreground"
                                data-testid="hub-daily-apply-tip"
                            >
                                {dailyApplyTip}
                            </p>
                        ) : null}
                        {hubCorpusLine ? (
                            <p
                                className="pt-1 text-xs text-muted-foreground tabular-nums"
                                data-testid="hub-corpus-line"
                            >
                                {hubCorpusLine}
                            </p>
                        ) : null}
                        {hubRemovalsLine ? (
                            <p
                                className="pt-0.5 text-xs text-muted-foreground"
                                data-testid="hub-removals-line"
                            >
                                Recently cleared · {hubRemovalsLine}
                            </p>
                        ) : null}
                        {proofLoading || (hubMatching && !hubCorpusLine) ? (
                            <WaitState
                                label="Counting matches across your packs"
                                className="pt-1 text-xs font-semibold"
                            />
                        ) : null}
                    </div>

                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                        {/* Adjust parameters tucked for Betalist lean loop —
                            packs → deck → Download & apply. Quiet Search stays. */}
                        <Button
                            type="button"
                            data-testid="hub-browse-all-matches"
                            onClick={() => {
                                const allItem = DEFAULT_CATEGORY_HUBS.find((c) => c.id === "all");
                                if (allItem) handleCategoryClick(allItem);
                            }}
                            className="w-full justify-center sm:w-auto"
                        >
                            Browse all matches
                        </Button>
                    </div>
                </div>
            </div>

            {/* 8-Card Category Grid — interactive cards, Velai navy */}
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 sm:gap-3.5">
                {DEFAULT_CATEGORY_HUBS.map((category, hubIndex) => {
                    const Icon = category.icon;
                    const isSelected = (modalCategory?.id ?? activeCategoryId) === category.id;
                    const countLabel = resolveCountLabel(category);
                    const prefetchAdjacentHub = () => {
                        const next = DEFAULT_CATEGORY_HUBS[hubIndex + 1] ?? DEFAULT_CATEGORY_HUBS[0];
                        try {
                            router.prefetch(jobsForYouHubHref());
                            if (next?.id === "all") {
                                router.prefetch(jobsBrowseSearchHref(""));
                            }
                        } catch {
                            /* prefetch is best-effort */
                        }
                    };

                    return (
                        <button
                            type="button"
                            key={category.id}
                            data-testid={`hub-pack-card-${category.id}`}
                            onClick={() => handleCategoryClick(category)}
                            onMouseEnter={prefetchAdjacentHub}
                            onFocus={prefetchAdjacentHub}
                            // control-scale-allow: pack card — a content tile, its padding/min-height is layout, not a bar control
                            className={cn(
                                "flex flex-col rounded-panel border bg-surface shadow-[var(--shadow-bevel-highlight)] min-h-[5.75rem] cursor-pointer gap-0 py-3 text-left active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-live sm:py-4 md:min-h-0 md:active:scale-100",
                                isSelected
                                    ? "border-live ring-1 ring-live"
                                    : "border-border",
                            )}
                        >
                            <div className="flex shrink-0 items-center justify-between gap-2 px-4 mb-2 sm:mb-3">
                                <div className="flex h-8 w-8 items-center justify-center rounded-ctl bg-muted text-foreground">
                                    <Icon size={16} />
                                </div>
                                {countLabel ? (
                                    <span
                                        className={cn(
                                            "shrink-0 font-semibold tabular-nums text-xs text-foreground",
                                            hubMatching && "opacity-80",
                                        )}
                                        data-testid={`hub-pack-count-${category.id}`}
                                        data-matching={hubMatching ? "true" : undefined}
                                    >
                                        {countLabel}
                                    </span>
                                ) : null}
                            </div>
                            <h3
                                data-testid={`hub-pack-title-${category.id}`}
                                className="min-h-[2.75rem] flex-1 px-3 text-sm font-semibold leading-snug text-foreground whitespace-normal break-words sm:min-h-[2.5rem] sm:px-4 sm:text-xs"
                            >
                                {category.label}
                            </h3>
                        </button>
                    );
                })}
            </div>

            {/* Comprehensive Category Job Listings Modal — standalone fallback only.
                When parent provides onSelectCategory (packs home), pack taps open
                ForYouHome postcard deck; keep mock catalog + Tailor&Apply hidden. */}
            {!onSelectCategory ? (
            <Dialog open={modalCategory !== null} onOpenChange={(open) => !open && setModalCategory(null)}>
                <DialogContent
                    showCloseButton={false}
                    className="w-[95vw] max-w-7xl h-[var(--overlay-max-h)] p-0 gap-0 overflow-hidden bg-background rounded-panel border border-border"
                >
                    {modalCategory && (
                        <>
                            {/* Modal Header & Navigation Bar */}
                            <div className="border-b border-border bg-surface px-4 sm:px-6 py-3 sm:py-3.5 flex items-center justify-between shrink-0">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-ctl bg-muted text-foreground">
                                        <modalCategory.icon size={16} />
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <DialogTitle className="text-base font-semibold text-foreground">
                                                {modalCategory.label}
                                            </DialogTitle>
                                            {resolveCountLabel(modalCategory) ? (
                                                <SolidBadge tone="muted">{resolveCountLabel(modalCategory)}</SolidBadge>
                                            ) : null}
                                        </div>
                                        <DialogDescription className="text-xs text-muted-foreground">
                                            {modalCategory.subtitle}
                                        </DialogDescription>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2">
                                    {/* View Mode Toggle: Shuffle Card vs All List */}
                                    <TabNav aria-label="Shuffle deck or list view" className="hidden sm:flex">
                                        <TabItem current={viewMode === "shuffle"} onClick={() => setViewMode("shuffle")}>
                                            <Cards size={16} />
                                            Shuffle Deck
                                        </TabItem>
                                        <TabItem current={viewMode === "list"} onClick={() => setViewMode("list")}>
                                            <List size={16} />
                                            List view
                                        </TabItem>
                                    </TabNav>

                                    <button
                                        type="button"
                                        onClick={() => setModalCategory(null)}
                                        aria-label="Close dialog"
                                        className="ctl-md ctl-button ctl-square inline-flex items-center justify-center hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        <X size={16} />
                                    </button>
                                </div>
                            </div>

                            {/* VIEW MODE A: SHUFFLEABLE CARD VIEW (SHOWS ALL DETAILS OF CURRENT ROLE) */}
                            {viewMode === "shuffle" && activeRole && (
                                <div className="flex-1 overflow-y-auto flex flex-col bg-background">
                                    {/* Card Deck Controller Header */}
                                    <div className="border-b border-border bg-surface px-4 sm:px-6 py-2 sm:py-2.5 flex items-center justify-between shrink-0">
                                        <div className="flex items-center gap-2 text-xs">
                                            <span className="font-semibold text-foreground">
                                                Role {currentIndex + 1} of {currentJobs.length}
                                            </span>
                                            <span className="text-muted-foreground hidden sm:inline">·</span>
                                            <span className="text-muted-foreground hidden sm:inline">
                                                Press <code className="px-1 py-0.5 rounded-ctl bg-muted text-xs">←</code> / <code className="px-1 py-0.5 rounded-ctl bg-muted text-xs">→</code> or <code className="px-1 py-0.5 rounded-ctl bg-muted text-xs">S</code> to shuffle
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-1.5">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={handleShuffle}
                                                className="gap-1.5"
                                            >
                                                <Shuffle size={16} />
                                                Shuffle
                                            </Button>

                                            <div className="flex items-center border border-border rounded-ctl overflow-hidden">
                                                <button
                                                    type="button"
                                                    onClick={handlePrev}
                                                    title="Previous role"
                                                    // control-type-allow: joined half of a prev/next segment; the bordered group carries the corner, an icon carries no type
                                                    className="ctl-md ctl-square flex items-center justify-center bg-surface hover:bg-muted text-foreground border-r border-border transition-colors"
                                                >
                                                    <CaretLeft size={16} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={handleNext}
                                                    title="Next role"
                                                    // control-type-allow: joined half of a prev/next segment; the bordered group carries the corner, an icon carries no type
                                                    className="ctl-md ctl-square flex items-center justify-center bg-surface hover:bg-muted text-foreground transition-colors"
                                                >
                                                    <CaretRight size={16} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* The Active Role Card — 2-Column Split */}
                                    <div className="p-3 sm:p-6">
                                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-start">
                                            {/* LEFT COLUMN: Job Description & Role Mission (Col 8) */}
                                            <div className="lg:col-span-8 rounded-panel border border-border bg-surface shadow-[var(--shadow-bevel-highlight)] p-4 sm:p-6 space-y-4 sm:space-y-6">
                                                {/* Role Title Header */}
                                                <div className="space-y-2 pb-5 border-b border-border">
                                                    <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                                                        <span className="font-semibold text-foreground">
                                                            {activeRole.company}
                                                        </span>
                                                        <span>·</span>
                                                        <span>{activeRole.location} ({activeRole.workType})</span>
                                                        <span>·</span>
                                                        <span>Posted {activeRole.postedAgo}</span>
                                                    </div>

                                                    <h3 className="text-xl font-semibold text-foreground leading-tight">
                                                        {activeRole.title}
                                                    </h3>

                                                    {/* Role Tags */}
                                                    <div className="flex items-center gap-1.5 flex-wrap pt-1">
                                                        {activeRole.tags.map((tag) => (
                                                            <span
                                                                key={tag}
                                                                className="rounded-pill bg-muted px-2.5 py-0.5 text-xs font-normal text-muted-foreground"
                                                            >
                                                                {tag}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>

                                                {/* Overview */}
                                                <div className="space-y-2">
                                                    <h4 className="text-xs font-semibold text-muted-foreground">
                                                        About the role
                                                    </h4>
                                                    <p className="text-xs sm:text-sm text-foreground leading-relaxed">
                                                        {activeRole.overview}
                                                    </p>
                                                </div>

                                                {/* Detailed Responsibilities */}
                                                <div className="space-y-2">
                                                    <h4 className="text-xs font-semibold text-muted-foreground">
                                                        Key Responsibilities
                                                    </h4>
                                                    <ul className="space-y-2 text-xs sm:text-sm text-foreground">
                                                        {activeRole.responsibilities.map((resp, i) => (
                                                            <li key={i} className="flex items-start gap-2.5">
                                                                <span className="text-live shrink-0">→</span>
                                                                <span className="leading-relaxed">{resp}</span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>

                                                {/* Detailed Requirements */}
                                                <div className="space-y-2">
                                                    <h4 className="text-xs font-semibold text-muted-foreground">
                                                        What we are looking for
                                                    </h4>
                                                    <ul className="space-y-2 text-xs sm:text-sm text-foreground">
                                                        {activeRole.requirements.map((req, i) => (
                                                            <li key={i} className="flex items-start gap-2.5">
                                                                <span className="text-muted-foreground shrink-0">•</span>
                                                                <span className="leading-relaxed">{req}</span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>

                                                {/* Private Matching Analysis (Why you match) */}
                                                <div className="space-y-2 p-4 rounded-ctl border border-border bg-surface shadow-[var(--shadow-bevel-highlight)]">
                                                    <div className="flex items-center gap-2">
                                                        <span className="h-2 w-2 rounded-pill bg-live" />
                                                        <h4 className="text-xs font-semibold text-foreground">
                                                            Why this role fits your background
                                                        </h4>
                                                    </div>
                                                    <ul className="space-y-1.5 text-xs text-muted-foreground">
                                                        {activeRole.fitReasons.map((reason, i) => (
                                                            <li key={i} className="flex items-start gap-2">
                                                                <span className="text-live shrink-0">✓</span>
                                                                <span className="leading-relaxed">{reason}</span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            </div>

                                            {/* RIGHT COLUMN: Company Hiring & General Info (Col 4) */}
                                            <div className="lg:col-span-4 space-y-4">
                                                {/* Hiring & Company Info Card */}
                                                <div className="rounded-panel border border-border bg-surface shadow-[var(--shadow-bevel-highlight)] p-5 space-y-4">
                                                    <div className="flex items-start justify-between gap-3 pb-3 border-b border-border">
                                                        <div>
                                                            <p className="text-xs text-muted-foreground">Employer</p>
                                                            <h4 className="text-base font-semibold text-foreground">
                                                                {activeRole.company}
                                                            </h4>
                                                            <div className="flex items-center gap-1.5 mt-1 text-xs text-live">
                                                                <span className="h-1.5 w-1.5 rounded-pill bg-live" />
                                                                <span>Actively interviewing</span>
                                                            </div>
                                                        </div>

                                                        <span className="rounded-pill bg-muted px-2.5 py-1 text-xs font-semibold text-live shrink-0">
                                                            {matchBandLabel(activeRole.fitBand)}
                                                        </span>
                                                    </div>

                                                    {/* Key Facts List */}
                                                    <div className="space-y-2.5 text-xs">
                                                        <div className="flex items-center justify-between py-1 border-b border-border">
                                                            <span className="text-muted-foreground">Compensation</span>
                                                            <span className="font-semibold text-foreground mono-data">{activeRole.salary}</span>
                                                        </div>
                                                        <div className="flex items-center justify-between py-1 border-b border-border">
                                                            <span className="text-muted-foreground">Department</span>
                                                            <span className="font-semibold text-foreground">{activeRole.department}</span>
                                                        </div>
                                                        <div className="flex items-center justify-between py-1 border-b border-border">
                                                            <span className="text-muted-foreground">Seniority</span>
                                                            <span className="font-semibold text-foreground">{activeRole.seniority}</span>
                                                        </div>
                                                        <div className="flex items-center justify-between py-1 border-b border-border">
                                                            <span className="text-muted-foreground">Workplace</span>
                                                            <span className="font-semibold text-foreground">{activeRole.workType}</span>
                                                        </div>
                                                        <div className="flex items-center justify-between py-1">
                                                            <span className="text-muted-foreground">Location</span>
                                                            <span className="font-semibold text-foreground">{activeRole.location}</span>
                                                        </div>
                                                    </div>

                                                    {/* Action Buttons */}
                                                    <div className="pt-2 space-y-2">
                                                        <Button
                                                            size="sm"
                                                            onClick={() => handleTailorApply(activeRole)}
                                                            className="w-full gap-1.5"
                                                        >
                                                            <Sparkle size={16} />
                                                            Tailor & Apply
                                                        </Button>

                                                        <button
                                                            type="button"
                                                            onClick={() => toggleSaveRole(activeRole.id)}
                                                            className={cn(
                                                                "w-full ctl-md ctl-button px-2.5 border inline-flex items-center justify-center gap-1.5 transition-colors",
                                                                savedRoleIds.has(activeRole.id)
                                                                    ? "border-live bg-surface text-live"
                                                                    : "border-border bg-surface text-muted-foreground hover:text-foreground",
                                                            )}
                                                        >
                                                            <BookmarkSimple size={16} />
                                                            {savedRoleIds.has(activeRole.id) ? "Saved to your list" : "Save role"}
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Benefits & Perks Card */}
                                                <div className="rounded-panel border border-border bg-surface shadow-[var(--shadow-bevel-highlight)] p-5 space-y-3">
                                                    <h4 className="text-xs font-semibold text-muted-foreground">
                                                        Benefits & Perks
                                                    </h4>
                                                    <ul className="space-y-2 text-xs text-foreground">
                                                        {activeRole.benefits.map((benefit, i) => (
                                                            <li key={i} className="flex items-start gap-2">
                                                                <span className="text-live shrink-0">✦</span>
                                                                <span className="leading-relaxed">{benefit}</span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>

                                                {/* Trust & Verification Card */}
                                                <div className="p-3.5 rounded-ctl border border-border bg-surface shadow-[var(--shadow-bevel-highlight)] text-xs space-y-1">
                                                    <p className="font-semibold text-foreground flex items-center gap-1.5">
                                                        <span className="h-1.5 w-1.5 rounded-pill bg-live" />
                                                        Verified Direct Listing
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">
                                                        Pulled directly from {activeRole.company}&apos;s verified career board. No recruiters or ghost postings.
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* VIEW MODE B: ALL CARDS LIST FEED */}
                            {viewMode === "list" && (
                                <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3 bg-background">
                                    {currentJobs.map((job, idx) => (
                                        <div
                                            key={job.id}
                                            className="rounded-panel border border-border bg-surface shadow-[var(--shadow-bevel-highlight)] p-5 hover:border-foreground transition-colors flex flex-col gap-3.5"
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="space-y-0.5">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xs font-semibold text-foreground">{job.company}</span>
                                                        <span className="text-xs text-muted-foreground">· {job.location} ({job.workType})</span>
                                                    </div>
                                                    <h4 className="text-sm sm:text-base font-semibold text-foreground leading-snug">
                                                        {job.title}
                                                    </h4>
                                                </div>
                                                <span className="mono-data text-xs text-muted-foreground shrink-0">
                                                    {job.postedAgo}
                                                </span>
                                            </div>

                                            <p className="text-xs text-muted-foreground leading-relaxed">
                                                {job.overview}
                                            </p>

                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                {job.tags.map((tag) => (
                                                    <span
                                                        key={tag}
                                                        className="rounded-pill bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground"
                                                    >
                                                        {tag}
                                                    </span>
                                                ))}
                                            </div>

                                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-border text-xs">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="inline-flex items-center gap-1 text-live font-normal">
                                                        <span className="h-1.5 w-1.5 rounded-pill bg-live" />
                                                        Actively hiring
                                                    </span>
                                                    <span className="text-muted-foreground">·</span>
                                                    <span className="mono-data font-semibold text-foreground">
                                                        {job.salary}
                                                    </span>
                                                    <span className="rounded-pill bg-muted px-2 py-0.5 text-xs font-semibold text-live">
                                                        {matchBandLabel(job.fitBand)}
                                                    </span>
                                                </div>

                                                <div className="flex items-center gap-2 self-end sm:self-auto">
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => {
                                                            setCurrentIndex(idx);
                                                            setViewMode("shuffle");
                                                        }}
                                                    >
                                                        View all details
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        onClick={() => handleTailorApply(job)}
                                                        className="gap-1.5"
                                                    >
                                                        <Sparkle size={16} />
                                                        Tailor & Apply
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Modal Footer Controls */}
                            <div className="border-t border-border px-4 sm:px-6 py-3 sm:py-3.5 bg-surface flex flex-col sm:flex-row items-center justify-between gap-2.5 sm:gap-3 shrink-0 text-xs">
                                <div className="hidden sm:flex items-center gap-3">
                                    <span className="text-muted-foreground flex items-center gap-1.5">
                                        <span className="h-1.5 w-1.5 rounded-pill bg-live" />
                                        All roles actively hiring and verified
                                    </span>
                                </div>

                                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                                    {viewMode === "shuffle" && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={handleShuffle}
                                            className="gap-1.5 flex-1 sm:flex-initial"
                                        >
                                            <Shuffle size={16} />
                                            Shuffle next
                                        </Button>
                                    )}

                                    {activeRole && (
                                        <Button
                                            size="sm"
                                            onClick={() => handleTailorApply(activeRole)}
                                            className="gap-1.5 flex-1 sm:flex-initial"
                                        >
                                            <Sparkle size={16} />
                                            Tailor & Apply
                                        </Button>
                                    )}

                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setModalCategory(null)}
                                        className="flex-none sm:flex-initial"
                                    >
                                        Done
                                    </Button>
                                </div>
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog>
            ) : null}

            {onOpenAdvancedSearch && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-panel border border-border bg-surface shadow-[var(--shadow-bevel-highlight)]">
                    <div className="space-y-0.5">
                        <p className="text-xs font-semibold text-foreground">
                            Looking for specific job titles, companies, or salary filters?
                        </p>
                        <p className="text-xs text-muted-foreground">
                            Search across all active roles with our full filter engine.
                        </p>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onOpenAdvancedSearch}
                        className="shrink-0"
                    >
                        Advanced search →
                    </Button>
                </div>
            )}

            {/* User Profile Parameters Modal */}
            <Dialog open={profileModalOpen} onOpenChange={setProfileModalOpen}>
                <DialogContent
                    showCloseButton={true}
                    className="w-[95vw] max-w-lg p-5 gap-4 bg-background rounded-panel border border-border"
                >
                    <div className="space-y-1 pb-2 border-b border-border">
                        <div className="flex items-center gap-2 text-foreground">
                            <User size={16} className="text-live shrink-0" />
                            <DialogTitle className="text-base font-semibold">
                                User Profile Parameters
                            </DialogTitle>
                        </div>
                        <DialogDescription className="text-xs text-muted-foreground">
                            Velai uses these parameters to tailor role rankings and compensation benchmarks on your device.
                        </DialogDescription>
                    </div>

                    <DialogBody className="space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            <div className="space-y-1">
                                <Label className="text-xs text-foreground">Full Name</Label>
                                <Input
                                    value={profileName}
                                    onChange={(e) => setProfileName(e.target.value)}
                                    placeholder="Your Name"
                                    className="ctl-md text-xs rounded-ctl"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs text-foreground">Target Role / Title</Label>
                                <Input
                                    value={profileRole}
                                    onChange={(e) => setProfileRole(e.target.value)}
                                    placeholder="e.g. Senior Software Engineer"
                                    className="ctl-md text-xs rounded-ctl"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs text-foreground">Years of Experience</Label>
                                <Input
                                    type="number"
                                    min={0}
                                    max={50}
                                    value={profileYears}
                                    onChange={(e) => setProfileYears(parseInt(e.target.value, 10) || 0)}
                                    className="ctl-md text-xs rounded-ctl"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs text-foreground">Preferred Location</Label>
                                <Input
                                    value={profileLocation}
                                    onChange={(e) => setProfileLocation(e.target.value)}
                                    placeholder="e.g. San Francisco, CA or Remote"
                                    className="ctl-md text-xs rounded-ctl"
                                />
                            </div>
                            <div className="space-y-1 sm:col-span-2">
                                <Label className="text-xs text-foreground">Core Skills (comma separated)</Label>
                                <Input
                                    value={profileSkills}
                                    onChange={(e) => setProfileSkills(e.target.value)}
                                    placeholder="e.g. TypeScript, React, Next.js, Python, SQL"
                                    className="ctl-md text-xs rounded-ctl"
                                />
                            </div>
                        </div>

                        <div className="rounded-ctl border border-border bg-muted p-2.5 text-xs text-muted-foreground flex items-center justify-between">
                            <span>Need to update full work experience or education?</span>
                            <Link
                                href="/settings?tab=resume"
                                className="font-semibold text-live hover:underline inline-flex items-center gap-1"
                                onClick={() => setProfileModalOpen(false)}
                            >
                                Open in Settings →
                            </Link>
                        </div>
                    </DialogBody>

                    <div className="flex shrink-0 items-center justify-end gap-2 pt-2 border-t border-border">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setProfileModalOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            onClick={handleSaveProfileParameters}
                            className="gap-1.5"
                        >
                            <Check size={16} />
                            Save parameters
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </section>
    );
}
