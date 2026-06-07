export interface TourStep {
  selector: string;
  title: string;
  description: string;
  placement: "top" | "bottom" | "left" | "right";
  optional?: boolean;
}

export const tourSteps: Record<string, TourStep[]> = {
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
      selector: '[data-tour="model-switcher"]',
      title: "AI Model Switcher",
      description:
        "Switch between Groq, Gemini, and OpenAI models. Each provider has different strengths and speed.",
      placement: "bottom",
      optional: true,
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
  "resume-builder": [
    {
      selector: '[data-tour="resume-editor"]',
      title: "Resume Editor",
      description:
        "Build and edit your resume section by section. Changes save automatically. Use the up and down arrows to reorder sections.",
      placement: "right",
    },
    {
      selector: '[data-tour="resume-import"]',
      title: "Import Resume",
      description:
        "Import an existing resume from PDF, DOCX, or plain text. The AI will parse and populate the editor fields.",
      placement: "bottom",
      optional: true,
    },
    {
      selector: '[data-tour="resume-tailor"]',
      title: "Tailor & Versions",
      description:
        "Tailor your resume to a specific job description. The AI suggests changes, and you can save multiple versions.",
      placement: "bottom",
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
