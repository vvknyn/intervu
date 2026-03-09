# Contributing to Intervu

Thanks for your interest in contributing! Intervu is an open-source interview prep platform and we welcome contributions of all kinds.

## Ways to Contribute

- **Bug reports** -- Found something broken? [Open an issue](https://github.com/vvknyn/interview-os/issues/new).
- **Feature requests** -- Have an idea? Start a discussion in Issues.
- **Code** -- Fix a bug, add a feature, or improve performance.
- **Documentation** -- Improve the README, add inline docs, or write guides.
- **Copy** -- Add quirky messages to the banner rotation (300+ and counting!).

## Development Setup

1. Fork the repo and clone your fork
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env.local` and fill in your Supabase credentials
4. Start the dev server: `npm run dev`
5. Run tests: `npm test`

See the [README](README.md#getting-started) for full setup instructions.

## Pull Request Process

1. Create your branch from `main`:
   ```bash
   git checkout -b feature/your-feature main
   ```
2. Make your changes. Follow existing code patterns and conventions.
3. Add or update tests if your change affects behavior.
4. Make sure everything passes:
   ```bash
   npm run lint
   npm test
   ```
5. Write a clear commit message describing what and why.
6. Open a pull request against `main`.

## Code Conventions

- **TypeScript** -- All code is TypeScript with strict mode enabled.
- **Components** -- React functional components with hooks. Named exports.
- **Styling** -- Tailwind CSS utility classes. Use `cn()` for conditional classes.
- **Icons** -- Phosphor Icons (`@phosphor-icons/react`). Use `weight="fill"` for active states.
- **Server actions** -- Data mutations go in `src/actions/`. Keep components thin.
- **File structure** -- Components live next to their route in `src/components/{feature}/`.

## Centralized Copy (`src/lib/copy.ts`)

All user-facing personality-driven text lives in a single file: `src/lib/copy.ts`. This includes:

- **BANNER_QUOTES** -- 300+ quirky messages shown in the rotating motivational banner across every page.
- **LOADING_MESSAGES** / **LOADING_TIPS** -- Shown during analysis and loading states.
- **LOGIN_REQUIRED** -- Random headings and subtexts for login-gated screens.
- **EMPTY_DASHBOARD** / **EMPTY_APPLICATIONS** -- Empty state messages.
- **SETUP_NUDGES** -- Escalating messages when users skip the setup wizard.
- **SETTINGS_MESSAGES**, **AUTH_MESSAGES**, **RESUME_MESSAGES** -- Context-specific UI copy.

### Adding new messages

1. Open `src/lib/copy.ts`
2. Add your message to the appropriate array
3. Use `pickRandom()` from the same file to select a random entry at runtime
4. Avoid hydration mismatches: for SSR components, pick the random value inside `useEffect`, not in the initial render

### Automated stats

A GitHub Actions workflow (`.github/workflows/update-readme-stats.yml`) automatically updates the README with current quote counts whenever `src/lib/copy.ts` is modified on `main` or `staging`. No manual README edits needed for stats.

## Test Suites

We use Playwright for E2E tests. New test suites have corresponding npm scripts:

```bash
npm run test:banner    # Motivational banner (display, dismiss, TTL, settings toggle)
npm run test:wizard    # Setup wizard (API key gating, re-open prevention)
npm run test:copy      # Quirky copy across pages (login screens, empty states)
```

When adding a new feature, add a matching test file in `tests/e2e/` and a script in `package.json`.

## Bug Reports

A good bug report includes:

- What you expected to happen
- What actually happened
- Steps to reproduce
- Browser and OS (if relevant)
- Screenshots or error messages

## License

By contributing, you agree that your code will be licensed under the [MIT License](LICENSE).
