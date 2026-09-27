/**
 * One-off axe color-contrast diagnostics for gate failures (no secrets).
 */
import { createRequire } from 'module';
import { chromium, webkit, devices } from 'playwright';
import fs from 'fs';

const require = createRequire(import.meta.url);
const AXE = require.resolve('axe-core/axe.min.js');
const BASE = process.env.GATE_BASE_URL || 'http://127.0.0.1:3018';
const COOKIE_FILE = '/tmp/velai-wos-session.txt';
const OUT = process.env.DIAG_OUT || '/tmp/axe-gate-diagnose.json';

function readWos() {
  if (process.env.WOS_SESSION?.trim()) return process.env.WOS_SESSION.trim();
  if (fs.existsSync(COOKIE_FILE)) return fs.readFileSync(COOKIE_FILE, 'utf8').trim();
  return null;
}

function sanitize(s) {
  return (s || '').replace(/\s+/g, ' ').trim().slice(0, 220);
}

async function injectSession(ctx, value) {
  await ctx.addCookies([
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

async function runAxeDetailed(page, scopeSel) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async (sel) => {
    const root = sel === 'document' ? document : document.querySelector(sel);
    if (!root) return { error: 'scope-missing', scope: sel };
    const result = await globalThis.axe.run(root, {
      runOnly: { type: 'rule', values: ['color-contrast'] },
    });
    const mapNode = (n) => ({
      target: n.target,
      failureSummary: (n.failureSummary || '').replace(/\s+/g, ' ').trim(),
      html: (n.html || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      any: (n.any || []).map((a) => ({
        id: a.id,
        message: a.message,
        data: a.data,
      })),
    });
    return {
      scope: sel,
      violations: (result.violations || []).map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: (v.nodes || []).map(mapNode),
      })),
      incomplete: (result.incomplete || []).map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: (v.nodes || []).map(mapNode),
      })),
      passRuleCount: result.passes?.length ?? 0,
    };
  }, scopeSel);
}

async function seedCtx(ctx) {
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
    {
      enabledKey: 'velai.localAi.enabled',
      resumeKey: 'velai.localAi.resume',
      resume: {
        data: { profile: { name: 'Alex Rivera', profession: 'Software Engineer' } },
        updatedAt: new Date().toISOString(),
        sourceLabel: 'axe-diagnose',
      },
    },
  );
}

async function gotoDeck(page) {
  await page.goto(`${BASE}/jobs`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('[data-testid^="hub-pack-card"]', { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(2000);
  for (const id of ['packs-home-intro-got-it', 'for-you-nav-intro-got-it']) {
    const b = page.getByTestId(id);
    if (await b.isVisible({ timeout: 800 }).catch(() => false)) await b.click({ force: true }).catch(() => {});
  }
  for (const id of ['hub-pack-card-apply', 'hub-pack-card-good', 'hub-pack-card-all']) {
    const card = page.getByTestId(id);
    if (await card.isVisible({ timeout: 2000 }).catch(() => false)) {
      await card.click({ force: true });
      break;
    }
  }
  await page.getByTestId('for-you-download-apply').waitFor({ state: 'visible', timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.getByTestId('for-you-deck').waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
}

async function landingCtx(browser, engine, vp, signedOutInit) {
  const ctx = await browser.newContext({
    viewport: vp,
    deviceScaleFactor: 2,
    ...(vp.width < 500
      ? { isMobile: true, hasTouch: true, userAgent: devices['iPhone 13'].userAgent }
      : {}),
  });
  if (signedOutInit) {
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('intervu-mode', 'dark');
        document.documentElement.classList.add('dark');
      } catch {
        /* ignore */
      }
    });
  }
  const page = await ctx.newPage();
  await page.goto(`${BASE}/jobs`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(2500);
  return { ctx, page };
}

const wos = readWos();
const report = { baseUrl: BASE, capturedAt: new Date().toISOString(), runs: [] };

const desktop = { width: 1440, height: 900 };
const mobile = { width: 390, height: 844 };

for (const [engineName, launch] of [
  ['chromium', () => chromium.launch({ headless: true })],
  ['webkit', () => webkit.launch({ headless: true })],
]) {
  const browser = await launch();
  try {
    if (wos && engineName === 'webkit') {
      const ctx = await browser.newContext({ viewport: desktop, deviceScaleFactor: 2 });
      await seedCtx(ctx);
      await injectSession(ctx, wos);
      const page = await ctx.newPage();
      await gotoDeck(page);
      const deck = await runAxeDetailed(page, '[data-testid="for-you-deck"]');
      report.runs.push({ case: 'webkit-desktop-deck', engine: engineName, axe: deck });
      await ctx.close();
    }
    for (const [label, vp] of [
      ['desktop', desktop],
      ['mobile', mobile],
    ]) {
      const { ctx, page } = await landingCtx(browser, engineName, vp, true);
      const landing = await runAxeDetailed(page, 'document');
      report.runs.push({ case: `landing-${engineName}-${label}`, engine: engineName, viewport: label, axe: landing });
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}

fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
for (const run of report.runs) {
  const vNodes = run.axe.violations?.flatMap((v) => v.nodes) ?? [];
  const iNodes = run.axe.incomplete?.flatMap((v) => v.nodes) ?? [];
  console.log(`\n=== ${run.case} violations=${vNodes.length} incomplete=${iNodes.length} ===`);
  for (const n of vNodes.slice(0, 8)) {
    console.log('V', sanitize(n.failureSummary));
    console.log('  html:', sanitize(n.html));
    console.log('  target:', JSON.stringify(n.target?.slice(0, 3)));
    console.log('  any:', JSON.stringify(n.any?.slice(0, 2)));
  }
  for (const n of iNodes.slice(0, 12)) {
    console.log('I', sanitize(n.failureSummary));
    console.log('  html:', sanitize(n.html));
    console.log('  any:', JSON.stringify(n.any?.slice(0, 2)));
  }
}
