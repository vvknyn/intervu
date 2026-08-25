import { LANDING_PROVENANCE_LINE } from "@/lib/marketing-stats";

const mastheadTitle = "Every job, straight from the employer.";

/** Single source for jobs landing USP copy — consumed by the masthead,
 *  guided tour, and any future surface that states why these listings differ. */
export const JOBS_USP = {
    mastheadTitle,
    searchDescription: LANDING_PROVENANCE_LINE,
    straightFromCompany: {
        title: "Straight from the company",
        body:
            "We read openings from each company's own careers page and hiring system. Nothing here comes from a recruiter, an agency, or a job board reselling someone else's listing.",
    },
    checkedBeforeApply: {
        title: "Checked before you apply",
        body:
            "We look at how old a posting is, how often it has been relisted, and whether the company's system still shows it open — so you can tell an active job from one that has probably already gone.",
    },
    realPay: {
        title: "Real pay, not estimates",
        body:
            "When a company publishes a salary range, that range is what you see. We never guess a number or borrow a crowd-sourced one.",
    },
    connect: {
        title: "MCP and local agents",
        body:
            "Agents is where you configure MCP for your assistant, and the local agent that runs on your machine.",
    },
} as const;
