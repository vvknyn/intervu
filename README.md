<p align="center">
  <img src="public/intervu-logo.png" alt="Intervu" width="80" />
</p>

<h1 align="center">Intervu</h1>

<p align="center">
  Your open-source, AI-powered job application workspace.<br/>
  Bring your own API key. No subscriptions. No data harvesting.
</p>

<p align="center">
  <a href="#getting-started">Get Started</a> &middot;
  <a href="#features">Features</a> &middot;
  <a href="CONTRIBUTING.md">Contribute</a> &middot;
  <a href="LICENSE">MIT License</a>
</p>

![Intervu Homepage](public/demo-screenshot.png)

---

## Why Intervu?

Most interview prep tools charge $20-50/month to wrap the same LLM APIs you can call yourself. Intervu takes a different approach:

- **BYOK (Bring Your Own Key)** -- Plug in a free Groq or Gemini key and you're set. Or use OpenAI if you prefer. You pay the provider directly for what you use.
- **Privacy-first** -- API keys are encrypted at rest with AES and never leave your account. No analytics, no tracking, no data sold.
- **Open source** -- MIT licensed. Self-host it, fork it, extend it.

---

## Features

### Interview Prep Engine

Type a company, role, and round in natural language (e.g. *"Google PM final round"*) and Intervu generates a full prep package:

| Section | What it does |
|---|---|
| **Company Recon** | Culture, recent news, interview style, and "vibe" analysis |
| **Match Strategy** | Maps your resume to the role and builds a positioning narrative |
| **Question Bank** | Behavioral, situational, and role-specific questions with strategies |
| **Reverse Interview** | Smart questions to ask your interviewer |
| **Technical Concepts** | Key topics to review for technical roles |
| **Coding Workspace** | Practice problems with a Monaco-based code editor |
| **System Design** | Architecture questions tailored to the role's level |

### Resume Builder & Tailoring

- Build a structured resume from scratch or import from PDF/DOCX/text
- Paste a job posting URL and get AI-powered tailoring recommendations
- Save multiple resume versions -- one per application
- Export to PDF or DOCX

### Application Tracker

- Track applications across statuses: Applied, Interviewing, Offer, Rejected, Withdrawn
- Link tailored resume versions to each application
- Generate cover letters with one click
- Jump straight from a tracked application into interview prep

### STAR Story Bank

- Store behavioral interview stories in the STAR format (Situation, Task, Action, Result)
- Stories are automatically referenced during question prep

### Knowledge Sources

- Add articles, research notes, or URLs as knowledge sources
- Referenced by the AI during prep generation for more personalized output

### Guided Workflows

The home screen shows contextual recipe cards based on your setup state:

- **Set Up Intervu** -- Connect an AI provider, import your resume, add your first story. Includes sign-in for returning users.
- **Prepare for an Interview** -- Quick search to generate a full prep package
- **Tailor Resume for a Job** -- Optimize your resume for a specific posting
- **Track an Application** -- Log a new application with resume + cover letter
- **Add Sources & Knowledge** -- Build your knowledge base
- **Build Your Story Bank** -- Add STAR stories for behavioral rounds

### Motivational Banner

A subtle, rotating quote banner appears across every page with 301+ quirky interview-themed messages. Rotates automatically every 3 minutes with a smooth fade transition. Dismiss it for 24 hours with a single click, or disable it permanently from Settings.

### Personality-Driven Copy

All messaging across the app -- loading states, empty states, login prompts, error messages, success toasts -- uses centralized, quirky copy from a single source of truth (`src/lib/copy.ts`). Every visit shows randomized messages so the experience feels fresh.

### Interactive Tour

A contextual tour system guides new users through the interface. The tour trigger only appears on pages with relevant content and adapts to the current page's features.

---

## Supported AI Providers

| Provider | Models | Cost |
|---|---|---|
| **Groq** | Llama 3.3 70B, Llama 3 8B, Mixtral 8x7B, Gemma 2 9B | Free |
| **Google Gemini** | Gemini 2.0 Flash, 1.5 Flash, 1.5 Pro | Free |
| **OpenAI** | GPT-4o, GPT-4o Mini, GPT-3.5 Turbo | Paid |

Groq and Gemini both offer free API keys -- you can use Intervu without spending anything.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js 16](https://nextjs.org/) (App Router, Turbopack, Server Actions) |
| Database | [Supabase](https://supabase.com/) (PostgreSQL + Auth + RLS) |
| Styling | [Tailwind CSS 4](https://tailwindcss.com/) + [Shadcn UI](https://ui.shadcn.com/) |
| Icons | [Phosphor Icons](https://phosphoricons.com/) |
| AI | OpenAI SDK, Google Generative AI, Groq SDK |
| Code Editor | [Monaco Editor](https://microsoft.github.io/monaco-editor/) |
| PDF/DOCX | unpdf, mammoth, jspdf, docx |
| Testing | [Playwright](https://playwright.dev/) (E2E + unit) |
| Encryption | CryptoJS (AES) |

---

## Getting Started

### Prerequisites

- **Node.js 18+**
- A **Supabase** account ([free tier](https://supabase.com/pricing) works)
- An API key from at least one provider: [Groq](https://console.groq.com/) (free), [Google AI Studio](https://aistudio.google.com/apikey) (free), or [OpenAI](https://platform.openai.com/api-keys) (paid)

### 1. Clone & install

```bash
git clone https://github.com/vvknyn/interview-os.git
cd interview-os
npm install
```

### 2. Set up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Run the SQL migrations in order:
   ```bash
   # Using the Supabase CLI
   supabase db push
   ```
   Or run each file in `supabase/migrations/` manually via the Supabase SQL Editor.
3. Copy your project URL and anon key from **Settings > API**.

### 3. Configure environment

```bash
cp .env.example .env.local
```

Fill in the required values:

```env
# Required -- from Supabase Settings > API
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Required -- encrypts user API keys at rest
# Generate with: openssl rand -hex 32
ENCRYPTION_KEY=your-32-byte-hex-key

# Optional -- server-side fallback keys for demo/trial mode
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=...
OPENAI_API_KEY=sk-...
```

### 4. Start developing

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The setup wizard will guide you through connecting an AI provider and importing your resume.

---

## Deployment

### Vercel (recommended)

1. Push to GitHub
2. Import the repo in [Vercel](https://vercel.com)
3. Add your `.env.local` variables to **Settings > Environment Variables**
4. Deploy

### Self-hosting

Any platform that runs Node.js 18+ works. Build and start:

```bash
npm run build
npm start
```

Set the same environment variables from `.env.example` in your hosting provider.

---

## Project Structure

```
interview-os/
├── .github/
│   └── workflows/
│       └── update-readme-stats.yml  # Auto-updates README stats on push
│
├── src/
│   ├── app/                    # Next.js routes
│   │   ├── page.tsx            # Home / dashboard
│   │   ├── applications/       # Application tracker
│   │   ├── resume-builder/     # Resume creation
│   │   ├── resume-tailor/      # Resume optimization
│   │   ├── library/            # Stories & sources
│   │   └── settings/           # Account & AI config
│   │
│   ├── actions/                # Server actions (data + AI)
│   │   └── fetch-quotes.ts     # Quote fetcher for banner
│   │
│   ├── components/             # UI components
│   │   ├── dashboard/          # Prep engine sections
│   │   ├── recipes/            # Guided workflow system
│   │   ├── applications/       # Tracker components
│   │   ├── resume-builder/     # Resume editor
│   │   ├── layout/             # Shell, header, nav
│   │   ├── tour/               # Interactive tour system
│   │   ├── auth/               # Auth popover, login form
│   │   └── ui/                 # Shadcn base + motivational banner
│   │
│   ├── lib/                    # Utilities
│   │   ├── llm/                # Model configs & caching
│   │   ├── supabase/           # DB client setup
│   │   ├── copy.ts             # Centralized quirky copy (301+ messages)
│   │   └── encryption.ts       # AES encrypt/decrypt
│   │
│   └── types/                  # TypeScript definitions
│
├── scripts/                    # Dev & deployment scripts
├── supabase/migrations/        # Database schema (SQL)
├── tests/                      # Playwright E2E + unit tests
└── public/                     # Static assets
```

---

## Scripts

```bash
npm run dev          # Development server
npm run build        # Production build
npm start            # Production server
npm run lint         # ESLint
npm test             # All Playwright tests
npm run test:ui      # Tests with Playwright UI
npm run test:headed  # Tests with visible browser
npm run promote      # Merge staging → main and push
```

Individual test suites:

```bash
npm run test:nav       # Navigation
npm run test:auth      # Authentication
npm run test:dash      # Dashboard / prep engine
npm run test:resume    # Resume builder
npm run test:tailor    # Resume tailoring
npm run test:apps      # Application tracker
npm run test:settings  # Settings
npm run test:mobile    # Mobile responsiveness
npm run test:privacy   # Privacy & account
npm run test:unit      # Unit tests
npm run test:banner    # Motivational banner
npm run test:wizard    # Setup wizard
npm run test:copy      # Quirky copy / messages
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. In short:

1. Fork the repo
2. Create a feature branch from `main`
3. Make your changes and add tests
4. Ensure `npm run lint` and `npm test` pass
5. Open a pull request

### Centralized Copy

All user-facing text lives in `src/lib/copy.ts`. If you're adding new messages, put them there. If you're changing existing messages, check there first. This keeps tone consistent and makes i18n possible down the road.

Bug reports and feature requests are welcome in [Issues](https://github.com/vvknyn/interview-os/issues).

---

## License

MIT -- see [LICENSE](LICENSE) for details.
