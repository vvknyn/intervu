import { JOBS_USP } from "@/lib/jobs/jobs-usp-copy";
import { RELISTED_EXPLAIN } from "@/lib/jobs/relisted-explain";
import { EXCEPTION_KEY_BODY, EXCEPTION_KEY_TITLE } from "@/lib/jobs/row-exception";
import { GHOST_META } from "@/lib/jobs/presentation";

export interface TourStep {
  selector: string;
  title: string;
  description: string;
  placement: "top" | "bottom" | "left" | "right";
  optional?: boolean;
}

export const tourSteps: Record<string, TourStep[]> = {
  jobs: [
    {
      selector: '[data-tour="jobs-search"]',
      title: "Start with a search",
      description: JOBS_USP.searchDescription,
      placement: "bottom",
    },
    {
      selector: '[data-tour="row-exception"]',
      title: EXCEPTION_KEY_TITLE,
      description: EXCEPTION_KEY_BODY,
      placement: "bottom",
      optional: true,
    },
    {
      selector: '[data-tour="jobs-posting-check"]',
      title: JOBS_USP.checkedBeforeApply.title,
      description: JOBS_USP.checkedBeforeApply.body,
      placement: "bottom",
      optional: true,
    },
    {
      selector: '[data-tour="jobs-pay"]',
      title: JOBS_USP.realPay.title,
      description: JOBS_USP.realPay.body,
      placement: "bottom",
      optional: true,
    },
    {
      selector: '[data-tour="nav-connect"]',
      title: JOBS_USP.connect.title,
      description: JOBS_USP.connect.body,
      placement: "top",
      optional: true,
    },
  ],
  "jobs-relist": [
    {
      selector: '[data-tour="row-exception"][data-exception="relisted"]',
      title: "This one was relisted",
      description: RELISTED_EXPLAIN,
      placement: "bottom",
    },
  ],
  "jobs-stale": [
    {
      selector: '[data-tour="row-exception"][data-exception="stale"]',
      title: GHOST_META.likely_ghost!.label,
      description: GHOST_META.likely_ghost!.explain,
      placement: "bottom",
    },
  ],
  "jobs-exception-both": [
    {
      selector: '[data-tour="row-exception"][data-exception="both"]',
      title: "Relisted and possibly stale",
      description: `${RELISTED_EXPLAIN} ${GHOST_META.likely_ghost!.explain}`,
      placement: "bottom",
    },
  ],
  dashboard: [
    {
      selector: '[data-tour="search-input"]',
      title: "Search & Analyze",
      description:
        "Enter a company name and position to generate personalized interview prep. You can also paste a job URL for even more context.",
      placement: "bottom",
    },
    {
      selector: '[data-tour="prep-settings"]',
      title: "Prep Settings",
      description:
        "Fine-tune the number of questions, add a job posting URL, or paste the job description for more targeted prep.",
      placement: "bottom",
      optional: true,
    },
    {
      selector: '[data-tour="analyze-button"]',
      title: "Analyze Button",
      description:
        "Click Analyze to kick off your interview prep. The AI will research the company and generate tailored questions.",
      placement: "bottom",
    },
    {
      selector: '[data-tour="nav-menu"]',
      title: "Navigation Menu",
      description:
        "Access Resume Builder, Applications tracker, Settings, and more from this menu.",
      placement: "bottom",
    },
    {
      selector: '[data-tour="dashboard-sidebar"]',
      title: "Dashboard Sidebar",
      description:
        "Once analysis completes, use this sidebar to jump between Strategy, Questions, Knowledge, and Reverse Questions sections.",
      placement: "right",
      optional: true,
    },
  ],
  applications: [
    {
      selector: '[data-tour="new-app-button"]',
      title: "New Application",
      description:
        "Start tracking a new job application. This takes you to the Resume Builder to analyze the job and create a tailored resume.",
      placement: "bottom",
    },
    {
      selector: '[data-tour="app-search"]',
      title: "Search & Filter",
      description:
        "Search your applications by company or position. Use the status cards above to filter by status.",
      placement: "bottom",
      optional: true,
    },
    {
      selector: '[data-tour="app-status-cards"]',
      title: "Status Overview",
      description:
        "See your application stats at a glance. Click a status card to filter the list below.",
      placement: "bottom",
    },
  ],
  settings: [
    {
      selector: '[data-tour="settings-tabs"]',
      title: "Settings Tabs",
      description:
        "Switch between Stories, Sources, Models, Appearance, and Account settings using these tabs.",
      placement: "bottom",
    },
    {
      selector: '[data-tour="settings-nav"]',
      title: "Navigation",
      description:
        "Use the menu to navigate back to the Dashboard, Resume Builder, or Applications.",
      placement: "bottom",
      optional: true,
    },
  ],
};
