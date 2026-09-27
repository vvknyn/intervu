/**
 * Signed-in Icon + Betalist lean gate walk for loopback QA.
 * Requires wos-session in /tmp/velai-wos-session.txt or WOS_SESSION.
 *
 * HARD gates: lean chrome + WCAG AA color-contrast (axe color-contrast) on hub, deck,
 * apply prompt, /privacy, and signed-out /jobs landing; motion + reduced-motion;
 * Chromium + WebKit × 1440×900 + 390×844.
 */
import { createRequire } from 'module';
import { chromium, webkit, devices } from 'playwright';
import { linuxChromiumVisualQaLaunchOptions } from './design/linux-chromium-visual-qa.cjs';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const AXE_CORE_PATH = require.resolve('axe-core/axe.min.js');

const BASE = process.env.GATE_BASE_URL || process.env.GATE_BASE || 'http://127.0.0.1:3002';
const COOKIE_FILE = '/tmp/velai-wos-session.txt';
const OUT =
  process.env.GATE_OUT ||
  '/Users/vivek/Library/Application Support/Cursor/AgentStores/cursor_agent_stores/bc-c68fc246-2df9-5e47-93dd-53b44f76f96f/files/media/signed-in-gate';

const LOCAL_AI_ENABLED_KEY = 'velai.localAi.enabled';
const LOCAL_AI_RESUME_KEY = 'velai.localAi.resume';
const SEEDED_RESUME = {
  data: {
    profile: {
      name: 'Alex Rivera',
      profession: 'Software Engineer',
      yearsOfExperience: 6,
      location: 'Remote',
      email: 'alex.rivera@example.com',
      phone: '555-010-1000',
    },
    experience: [
      {
        id: 'exp-1',
        company: 'Acme Corp',
        role: 'Senior Software Engineer',
        dates: '2021-Present',
        description: 'Built backend services in TypeScript and React.',
      },
    ],
    competencies: [{ category: 'Languages', skills: ['JavaScript', 'TypeScript', 'Python'] }],
    education: [{ id: 'edu-1', degree: 'B.S. Computer Science', institution: 'State University', year: '2018' }],
    generatedSummary: 'Software engineer with 6 years of experience.',
  },
  updatedAt: new Date().toISOString(),
  sourceLabel: 'staging-gate-608',
};

function readWosSession() {
  if (process.env.WOS_SESSION?.trim()) return process.env.WOS_SESSION.trim();
  if (fs.existsSync(COOKIE_FILE)) return fs.readFileSync(COOKIE_FILE, 'utf8').trim();
  return null;
}

async function surfaceProbe(page) {
  return page.evaluate(() => {
    const footer = document.querySelector('[data-testid="site-footer"], footer');
    const footerLinks = [...document.querySelectorAll('[data-testid="site-footer"] a, footer a')]
      .map((a) => (a.textContent || '').trim())
      .filter(Boolean);
    const headerText = (document.querySelector('[data-testid="topbar"]')?.innerText || '').replace(/\s+/g, ' ').trim();
    const connect = document.querySelector('[data-testid="topbar-connect"]');
    const body = document.body?.innerText?.slice(0, 16000) || '';
    const logo = document.querySelector('[data-testid="topbar-logo"]');
    const logoStyle = logo ? getComputedStyle(logo) : null;
    const bandOnlyFit =
      !/\d+\s*%\s*(?:Match|fit)/i.test(body) &&
      !/Fit breakdown|fit-breakdown|data-testid=["']fit-breakdown/i.test(document.body?.innerHTML?.slice(0, 80000) || '');
    return {
      signedIn: !!document.querySelector('[data-testid="topbar-avatar"]'),
      signInVisible: !!document.querySelector('[data-testid="topbar-signin"]'),
      mcpInHeader: !!connect || /\bMCP\b/.test(headerText),
      footerLean: footer?.getAttribute('data-lean') === 'true',
      footerLinks,
      footerCount: footerLinks.length,
      hasCanadaCopy: /\bCanada jobs\b|\bCanada\b.*career pages/i.test(body),
      numericFit: /\d+\s*%\s*(?:Match|fit)|\bMatchChip\b|\b\d{1,3}\s*%\s*match/i.test(body),
      fitBreakdown: /Fit breakdown|fit-breakdown|data-testid=["']fit-breakdown/i.test(
        document.body?.innerHTML?.slice(0, 80000) || '',
      ),
      bandOnlyFit,
      hasDidYouApply: /Did you apply/i.test(body),
      packCount: document.querySelectorAll('[data-testid^="hub-pack-card"]').length,
      logoVisible: !!logo,
      logoColor: logoStyle?.color || null,
      logoFilter: logoStyle?.filter || null,
    };
  });
}

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, animations: 'disabled' });
  return file;
}

async function injectSession(context, value) {
  await context.addCookies([
    {
      name: 'wos-session',
      value,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

async function newCtx(browser, viewport, reducedMotion = false) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
    ...(viewport.width < 500
      ? { isMobile: true, hasTouch: true, userAgent: devices['iPhone 13'].userAgent }
      : {}),
  });
  await ctx.addInitScript(
    ({ enabledKey, resumeKey, resume }) => {
      try {
        localStorage.setItem('intervu-mode', 'dark');
        document.documentElement.classList.add('dark');
        localStorage.setItem(enabledKey, '1');
        localStorage.setItem(resumeKey, JSON.stringify(resume));
        localStorage.setItem('velai-packs-home-intro-v1', '1');
      } catch {
        /* ignore */
      }
    },
    { enabledKey: LOCAL_AI_ENABLED_KEY, resumeKey: LOCAL_AI_RESUME_KEY, resume: SEEDED_RESUME },
  );
  return ctx;
}

async function dismissIntros(page) {
  for (const id of ['packs-home-intro-got-it', 'for-you-nav-intro-got-it']) {
    const b = page.getByTestId(id);
    if (await b.isVisible({ timeout: 1500 }).catch(() => false)) await b.click({ force: true }).catch(() => {});
  }
  await dismissBlockingDialogs(page);
}

async function dismissBlockingDialogs(page) {
  for (let i = 0; i < 3; i++) {
    const open = page.locator('[role="dialog"][data-state="open"]');
    if (!(await open.count())) break;
    const close = page.getByRole('button', { name: /close|cancel|got it|not now|skip/i }).first();
    if (await close.isVisible({ timeout: 800 }).catch(() => false)) {
      await close.click({ force: true }).catch(() => {});
    } else {
      await page.keyboard.press('Escape').catch(() => {});
    }
    await page.waitForTimeout(400);
  }
}

async function loadAxe(page) {
  if (!fs.existsSync(AXE_CORE_PATH)) throw new Error(`missing axe at ${AXE_CORE_PATH}`);
  await page.addScriptTag({ path: AXE_CORE_PATH });
}

async function runAxeContrast(page, scope = 'document') {
  return page.evaluate(async (scopeSel) => {
    if (!globalThis.axe) return { error: 'axe-not-loaded', violationCount: 1, incompleteCount: 1, scannedNodes: 0 };
    const root = scopeSel === 'document' ? document : document.querySelector(scopeSel);
    if (!root) return { error: 'scope-missing', violationCount: 1, incompleteCount: 1, scannedNodes: 0 };
    const result = await globalThis.axe.run(root, {
      runOnly: { type: 'rule', values: ['color-contrast'] },
    });
    const countNodes = (arr) => (arr || []).reduce((n, item) => n + (item.nodes?.length || 0), 0);
    const violations = result.violations || [];
    const incomplete = result.incomplete || [];
    const scannedNodes =
      countNodes(violations) + countNodes(incomplete) + countNodes(result.passes) + (result.passes?.length || 0);
    return {
      violationCount: violations.length,
      incompleteCount: incomplete.length,
      passRuleCount: result.passes?.length ?? 0,
      scannedNodes,
      violations: violations.map((v) => ({
        id: v.id,
        nodes: v.nodes?.length ?? 0,
        help: v.help,
      })),
      incomplete: incomplete.map((v) => ({
        id: v.id,
        nodes: v.nodes?.length ?? 0,
        help: v.help,
      })),
    };
  }, scope === 'document' ? 'document' : scope);
}

async function navigateHubToPrompt(page) {
  await page.goto(`${BASE}/jobs`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('[data-testid^="hub-pack-card"]', { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await dismissIntros(page);
  const preferred = ['hub-pack-card-apply', 'hub-pack-card-good', 'hub-pack-card-all'];
  for (const id of preferred) {
    const card = page.getByTestId(id);
    if (await card.isVisible({ timeout: 2000 }).catch(() => false)) {
      await card.click();
      break;
    }
  }
  await page.getByTestId('for-you-download-apply').waitFor({ state: 'visible', timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const dl = page.getByTestId('for-you-download-apply');
  const dlVisible = await dl.isVisible({ timeout: 60000 }).catch(() => false);
  let promptVisible = false;
  if (dlVisible) {
    const popupPromise = page.waitForEvent('popup', { timeout: 30000 }).catch(() => null);
    await dl.click().catch(() => {});
    const popup = await popupPromise;
    await page.waitForTimeout(11_000);
    if (popup) await popup.close().catch(() => {});
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    promptVisible = await page.getByTestId('apply-return-prompt').isVisible({ timeout: 8000 }).catch(() => false);
  }
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(800);
  return { dlVisible, promptVisible };
}

function durationZeroed(value) {
  if (!value || value === '0s' || value === '0ms') return true;
  const n = parseFloat(String(value).replace(/[a-z]+$/i, ''));
  return Number.isFinite(n) && n <= 0.001;
}

async function motionProbe(el) {
  return el.evaluate((node) => {
    const cs = getComputedStyle(node);
    return {
      transform: cs.transform,
      transitionDuration: cs.transitionDuration,
      transitionProperty: cs.transitionProperty,
      opacity: cs.opacity,
      className: node.className,
    };
  });
}

async function runMotionChecks(page, engine, label, viewport) {
  const results = { pass: true, targets: [] };
  const dl = page.getByTestId('for-you-download-apply');
  if (!(await dl.isVisible().catch(() => false))) {
    return { pass: false, error: 'download-missing', targets: [] };
  }
  const targets = [
    { name: 'for-you-download-apply', locator: dl, testId: 'for-you-download-apply' },
    {
      name: 'hub-pack-card-first',
      locator: page.locator('[data-testid^="hub-pack-card"]').first(),
      testId: null,
    },
  ];
  for (const t of targets) {
    if (!(await t.locator.isVisible().catch(() => false))) continue;
    await t.locator.scrollIntoViewIfNeeded().catch(() => {});
    const beforeBox = await t.locator.boundingBox();
    await shot(page, `motion-${engine}-${label}-${t.name}-before.png`);
    const beforeStyles = await motionProbe(t.locator);
    if (viewport.width >= 500) {
      await t.locator.hover({ force: true }).catch(() => {});
      await page.waitForTimeout(250);
    }
    const hoverStyles = await motionProbe(t.locator);
    await shot(page, `motion-${engine}-${label}-${t.name}-hover.png`);
    const hoverBox = await t.locator.boundingBox();
    await t.locator.dispatchEvent('mousedown').catch(() => {});
    await page.waitForTimeout(120);
    const pressedStyles = await motionProbe(t.locator);
    await shot(page, `motion-${engine}-${label}-${t.name}-pressed.png`);
    await t.locator.dispatchEvent('mouseup').catch(() => {});
    const pressedBox = await t.locator.boundingBox();
    const layoutDelta =
      beforeBox && hoverBox
        ? Math.max(Math.abs((hoverBox.y ?? 0) - (beforeBox.y ?? 0)), Math.abs((hoverBox.x ?? 0) - (beforeBox.x ?? 0)))
        : 0;
    const pressDelta =
      beforeBox && pressedBox
        ? Math.max(Math.abs((pressedBox.y ?? 0) - (beforeBox.y ?? 0)), Math.abs((pressedBox.x ?? 0) - (beforeBox.x ?? 0)))
        : 0;
    const visibleChange =
      beforeStyles.transform !== hoverStyles.transform ||
      beforeStyles.opacity !== hoverStyles.opacity ||
      beforeStyles.transform !== pressedStyles.transform;
    const layoutOk = layoutDelta <= 2 && pressDelta <= 4;
    const entry = {
      name: t.name,
      beforeStyles,
      hoverStyles,
      pressedStyles,
      layoutDelta,
      pressDelta,
      visibleChange,
      layoutOk,
    };
    if (!layoutOk) results.pass = false;
    results.targets.push(entry);
  }
  const prompt = page.getByTestId('apply-return-prompt');
  if (await prompt.isVisible().catch(() => false)) {
    for (const [testId, state] of [
      ['apply-return-mark-applied', 'yes'],
      ['apply-return-not-yet', 'not-yet'],
    ]) {
      const btn = page.getByTestId(testId);
      if (!(await btn.isVisible().catch(() => false))) continue;
      await shot(page, `motion-${engine}-${label}-prompt-${state}-before.png`);
      if (viewport.width >= 500) await btn.hover({ force: true }).catch(() => {});
      await page.waitForTimeout(200);
      await shot(page, `motion-${engine}-${label}-prompt-${state}-hover.png`);
      await btn.dispatchEvent('mousedown').catch(() => {});
      await page.waitForTimeout(100);
      await shot(page, `motion-${engine}-${label}-prompt-${state}-pressed.png`);
      await btn.dispatchEvent('mouseup').catch(() => {});
    }
  }
  return results;
}

async function runReducedMotion(browser, engine, label, viewport, wos) {
  const ctx = await newCtx(browser, viewport, true);
  await injectSession(ctx, wos);
  const page = await ctx.newPage();
  await navigateHubToPrompt(page);
  await loadAxe(page);
  const rootStyles = await page.evaluate(() => {
    const html = document.documentElement;
    const cs = getComputedStyle(html);
    const btn = document.querySelector('[data-testid="for-you-download-apply"]');
    const btnCs = btn ? getComputedStyle(btn) : null;
    return {
      mediaMatches: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      htmlTransitionDuration: cs.transitionDuration,
      buttonTransitionDuration: btnCs?.transitionDuration ?? null,
      buttonTransform: btnCs?.transform ?? null,
    };
  });
  await page.getByTestId('for-you-deck').waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
  const deckAxe = await runAxeContrast(page, '[data-testid="for-you-deck"]');
  await shot(page, `reduced-${engine}-${label}-deck.png`);
  const functional =
    (await page.getByTestId('for-you-download-apply').isVisible().catch(() => false)) ||
    (await page.getByTestId('apply-return-prompt').isVisible().catch(() => false));
  const transitionsZeroed =
    rootStyles.mediaMatches && durationZeroed(rootStyles.buttonTransitionDuration);
  const pass =
    functional &&
    rootStyles.mediaMatches &&
    deckAxe.violationCount === 0 &&
    deckAxe.incompleteCount === 0 &&
    deckAxe.scannedNodes > 0 &&
    transitionsZeroed;
  await ctx.close();
  return { pass, rootStyles, deckAxe, functional, transitionsZeroed };
}

async function runIcon(browser, engine, label, viewport, wos) {
  const ctx = await newCtx(browser, viewport);
  await injectSession(ctx, wos);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/jobs`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(3000);
  const res = await page.request.get(`${BASE}/api/auth/session`);
  const user = (await res.json())?.user ?? null;
  const probe = await surfaceProbe(page);
  await shot(page, `icon-${engine}-${label}.png`);
  await ctx.close();
  const pass =
    user && probe.signedIn && !probe.signInVisible && !probe.mcpInHeader && probe.logoVisible;
  return { pass, user: user?.email, probe };
}

async function runBetalistCell(browser, engine, label, viewport, wos) {
  const ctx = await newCtx(browser, viewport);
  await injectSession(ctx, wos);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/jobs`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('[data-testid^="hub-pack-card"]', { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await dismissIntros(page);
  const hubProbe = await surfaceProbe(page);
  await shot(page, `betalist-${engine}-${label}-hub.png`);
  await loadAxe(page);
  const hubAxe = await runAxeContrast(page, 'main');
  const preferred = ['hub-pack-card-apply', 'hub-pack-card-good', 'hub-pack-card-all'];
  for (const id of preferred) {
    const card = page.getByTestId(id);
    if (await card.isVisible({ timeout: 2000 }).catch(() => false)) {
      await dismissBlockingDialogs(page);
      await card.click({ force: true });
      break;
    }
  }
  await page.getByTestId('for-you-download-apply').waitFor({ state: 'visible', timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(800);
  await page.getByTestId('for-you-deck').waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
  const deckAxe = await runAxeContrast(page, '[data-testid="for-you-deck"]');
  await shot(page, `betalist-${engine}-${label}-deck-pre-apply.png`);
  const dl = page.getByTestId('for-you-download-apply');
  const dlVisible = await dl.isVisible({ timeout: 60000 }).catch(() => false);
  let promptVisible = false;
  if (dlVisible) {
    const popupPromise = page.waitForEvent('popup', { timeout: 30000 }).catch(() => null);
    await dl.click().catch(() => {});
    const popup = await popupPromise;
    await page.waitForTimeout(11_000);
    if (popup) await popup.close().catch(() => {});
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    promptVisible = await page.getByTestId('apply-return-prompt').isVisible({ timeout: 8000 }).catch(() => false);
  }
  const nav = { dlVisible, promptVisible };
  const deckProbe = await surfaceProbe(page);
  await shot(page, `betalist-${engine}-${label}-deck.png`);
  let promptAxe = { violationCount: 0, incompleteCount: 0, scannedNodes: 0, skipped: true };
  const prompt = page.getByTestId('apply-return-prompt');
  if (await prompt.isVisible().catch(() => false)) {
    await shot(page, `betalist-${engine}-${label}-apply-prompt.png`);
    promptAxe = await runAxeContrast(page, '[data-testid="apply-return-prompt"]');
    promptAxe.skipped = false;
  }
  const motion = await runMotionChecks(page, engine, label, viewport);
  const reduced = await runReducedMotion(browser, engine, label, viewport, wos);
  await ctx.close();

  const hubPass =
    hubProbe.signedIn &&
    !hubProbe.mcpInHeader &&
    hubProbe.footerLean &&
    hubProbe.footerCount === 2 &&
    hubProbe.footerLinks.every((l) => /privacy|terms/i.test(l)) &&
    !hubProbe.hasCanadaCopy &&
    !hubProbe.numericFit &&
    !hubProbe.fitBreakdown &&
    hubProbe.bandOnlyFit &&
    hubProbe.packCount >= 8;

  const deckPass =
    nav.dlVisible &&
    deckProbe.footerLean &&
    deckProbe.footerCount <= 2 &&
    !deckProbe.numericFit &&
    !deckProbe.fitBreakdown &&
    !deckProbe.hasCanadaCopy &&
    nav.promptVisible &&
    deckProbe.hasDidYouApply;

  const axePass = (axe) =>
    axe.violationCount === 0 && axe.incompleteCount === 0 && axe.scannedNodes > 0 && !axe.error;

  const axeOk = axePass(hubAxe) && axePass(deckAxe) && (promptAxe.skipped || axePass(promptAxe));

  return {
    pass: hubPass && deckPass && axeOk && motion.pass && reduced.pass,
    hubPass,
    deckPass,
    nav,
    hubProbe,
    deckProbe,
    hubAxe,
    deckAxe,
    promptAxe,
    motion,
    reduced,
  };
}

async function runPrivacy(browser, engine, label, viewport, wos) {
  const ctx = await newCtx(browser, viewport);
  await injectSession(ctx, wos);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/privacy`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);
  const body = await page.evaluate(() => document.body?.innerText || '');
  const replay = /session replay|Session replay/i.test(body);
  const telemetry = /telemetry|analytics|PostHog/i.test(body);
  await loadAxe(page);
  const privacyAxe = await runAxeContrast(page, 'main');
  await shot(page, `privacy-${engine}-${label}.png`);
  await ctx.close();
  const axePass =
    privacyAxe.violationCount === 0 && privacyAxe.incompleteCount === 0 && privacyAxe.scannedNodes > 0;
  return { pass: replay && telemetry && axePass, replay, telemetry, privacyAxe, axePass };
}

/** Signed-out landing in a fresh context (no auth cookie) so /jobs does not redirect. */
async function runLandingSignedOut(browser, engine, label, viewport) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    ...(viewport.width < 500
      ? { isMobile: true, hasTouch: true, userAgent: devices['iPhone 13'].userAgent }
      : {}),
  });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('intervu-mode', 'dark');
      document.documentElement.classList.add('dark');
    } catch {
      /* ignore */
    }
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/jobs`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(2500);
  const probe = await page.evaluate(() => {
    const body = document.body?.innerText?.slice(0, 8000) || '';
    return {
      signedIn: !!document.querySelector('[data-testid="topbar-avatar"]'),
      signInVisible: !!document.querySelector('[data-testid="topbar-signin"]'),
      conceptA: !!document.querySelector('[data-testid="concept-a-landing"]'),
      mcpInHeader: !!document.querySelector('[data-testid="topbar-connect"]'),
      numericFit: /\d+\s*%\s*(?:Match|fit)/i.test(body),
      canadaCopy: /\bCanada jobs\b|\bCanada\b.*career pages/i.test(body),
    };
  });
  await loadAxe(page);
  const landingAxe = await runAxeContrast(page, 'main');
  await shot(page, `landing-signed-out-${engine}-${label}.png`);
  await ctx.close();
  const axePass =
    landingAxe.violationCount === 0 && landingAxe.incompleteCount === 0 && landingAxe.scannedNodes > 0;
  const chromePass =
    !probe.signedIn &&
    probe.signInVisible &&
    probe.conceptA &&
    !probe.mcpInHeader &&
    !probe.numericFit &&
    !probe.canadaCopy;
  return { pass: chromePass && axePass, probe, landingAxe, axePass, chromePass };
}

const wos = readWosSession();
fs.mkdirSync(OUT, { recursive: true });
const verdict = {
  capturedAt: new Date().toISOString(),
  gitHead: process.env.GIT_HEAD || null,
  baseUrl: BASE,
  cookieLen: wos?.length ?? 0,
  matrix: {},
  axeSummary: {},
  motionSummary: {},
  reducedSummary: {},
  landingSummary: {},
  privacySummary: {},
};

if (!wos) {
  verdict.verdict = 'BLOCKED';
  verdict.reason = 'missing wos-session';
  fs.writeFileSync(path.join(OUT, 'gate-walk-verdict.json'), JSON.stringify(verdict, null, 2));
  process.exit(2);
}

const desktop = { width: 1440, height: 900 };
const mobile = { width: 390, height: 844 };
const engines = [
  ['chromium', () => chromium.launch(linuxChromiumVisualQaLaunchOptions({ headless: true }))],
  ['webkit', () => webkit.launch({ headless: true })],
];

let allPass = true;

for (const [engineName, launch] of engines) {
  const browser = await launch();
  try {
    for (const [vpLabel, vp] of [
      ['desktop-1440x900', desktop],
      ['mobile-390x844', mobile],
    ]) {
      const key = `${engineName}-${vpLabel}`;
      const landing = await runLandingSignedOut(browser, engineName, vpLabel, vp);
      const icon = await runIcon(browser, engineName, vpLabel, vp, wos);
      const betalist = icon.pass
        ? await runBetalistCell(browser, engineName, vpLabel, vp, wos)
        : { pass: false, blocked: true };
      const privacy = icon.pass
        ? await runPrivacy(browser, engineName, vpLabel, vp, wos)
        : { pass: false, blocked: true };
      const cellPass = landing.pass && icon.pass && betalist.pass && privacy.pass;
      verdict.matrix[key] = {
        landing: landing.pass,
        icon: icon.pass,
        betalist: betalist.pass,
        privacy: privacy.pass,
        hardPass: cellPass,
        axe: betalist.blocked
          ? null
          : {
              hub: betalist.hubAxe,
              deck: betalist.deckAxe,
              prompt: betalist.promptAxe,
            },
        landingAxe: landing.landingAxe,
        privacyAxe: privacy.privacyAxe,
        motion: betalist.blocked ? null : betalist.motion,
        reduced: betalist.blocked ? null : betalist.reduced,
        betalistDetail: betalist.blocked
          ? { blocked: true }
          : {
              dlVisible: betalist.nav?.dlVisible,
              promptVisible: betalist.nav?.promptVisible,
              hubPass: betalist.hubPass,
              deckPass: betalist.deckPass,
            },
      };
      verdict.landingSummary[key] = {
        pass: landing.pass,
        violations: landing.landingAxe?.violationCount ?? null,
        incomplete: landing.landingAxe?.incompleteCount ?? null,
        scannedNodes: landing.landingAxe?.scannedNodes ?? null,
      };
      verdict.privacySummary[key] = {
        pass: privacy.pass,
        replay: privacy.replay,
        telemetry: privacy.telemetry,
        violations: privacy.privacyAxe?.violationCount ?? null,
        incomplete: privacy.privacyAxe?.incompleteCount ?? null,
        scannedNodes: privacy.privacyAxe?.scannedNodes ?? null,
      };
      if (!betalist.blocked) {
        verdict.axeSummary[key] = {
          hubViolations: betalist.hubAxe.violationCount,
          hubIncomplete: betalist.hubAxe.incompleteCount,
          deckViolations: betalist.deckAxe.violationCount,
          deckIncomplete: betalist.deckAxe.incompleteCount,
          promptViolations: betalist.promptAxe.violationCount,
          promptIncomplete: betalist.promptAxe.incompleteCount,
        };
        verdict.motionSummary[key] = { pass: betalist.motion.pass, targets: betalist.motion.targets?.length ?? 0 };
        verdict.reducedSummary[key] = {
          pass: betalist.reduced.pass,
          mediaMatches: betalist.reduced.rootStyles?.mediaMatches,
          transitionsZeroed: betalist.reduced.transitionsZeroed,
        };
      }
      if (!cellPass) allPass = false;
    }
  } finally {
    await browser.close();
  }
}

verdict.verdict = allPass ? 'HARD_PASS' : 'FAIL';
fs.writeFileSync(path.join(OUT, 'gate-walk-verdict.json'), JSON.stringify(verdict, null, 2));
console.log(JSON.stringify({ verdict: verdict.verdict, axeSummary: verdict.axeSummary, landingSummary: verdict.landingSummary, privacySummary: verdict.privacySummary }, null, 2));
process.exit(allPass ? 0 : 1);
