/**
 * Signed-in Icon + Betalist lean gate walk for loopback QA.
 * Requires wos-session value in /tmp/velai-wos-session.txt or WOS_SESSION env.
 *
 * HARD gates: lean chrome checks + WCAG AA color-contrast (axe color-contrast rule)
 * on hub, deck (postcard JD), and Did-you-apply prompt — every run, Chromium + WebKit.
 */
import { createRequire } from 'module';
import { chromium, webkit, devices } from 'playwright';
import { linuxChromiumVisualQaLaunchOptions } from './design/linux-chromium-visual-qa.cjs';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const AXE_PATH = require.resolve('axe-core/axe.min.js');

const BASE = process.env.GATE_BASE_URL || 'http://127.0.0.1:3002';
const COOKIE_FILE = '/tmp/velai-wos-session.txt';
/** Must exceed `APPLY_RETURN_THRESHOLD_MS` (10_000) in src/lib/jobs/apply-return.ts */
const APPLY_AWAY_MS = 11_000;
const OUT =
  process.env.GATE_OUT ||
  '/Users/vivek/Library/Application Support/Cursor/AgentStores/cursor_agent_stores/bc-c68fc246-2df9-5e47-93dd-53b44f76f96f/files/media/signed-in-gate';

const axeReadyPages = new WeakSet();

function readWosSession() {
  if (process.env.WOS_SESSION?.trim()) return process.env.WOS_SESSION.trim();
  if (fs.existsSync(COOKIE_FILE)) return fs.readFileSync(COOKIE_FILE, 'utf8').trim();
  return null;
}

function sanitizeHtml(html) {
  return (html || '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

/**
 * axe-core color-contrast on the full visible document (no excludes, no rule disables).
 * Incomplete nodes are recorded — callers treat any violation as a hard fail.
 */
async function runAxeContrast(page, surfaceLabel, contextSelector) {
  if (!axeReadyPages.has(page)) {
    await page.addScriptTag({ path: AXE_PATH });
    axeReadyPages.add(page);
  }
  const summary = await page.evaluate(
    async ({ label, contextSelector: sel }) => {
    if (!globalThis.axe) {
      return { label, pass: false, error: 'axe-not-loaded', violationCount: 1, violations: [] };
    }
    const context = sel ? document.querySelector(sel) : document;
    if (!context) {
      return {
        label,
        contextSelector: sel,
        pass: false,
        error: 'context-missing',
        violationCount: 1,
        violations: [],
      };
    }
    const result = await globalThis.axe.run(context, {
      runOnly: { type: 'rule', values: ['color-contrast'] },
    });
    const violations = result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n) => ({
        target: n.target?.slice(0, 4),
        failureSummary: (n.failureSummary || '').replace(/\s+/g, ' ').trim(),
        html: (n.html || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      })),
    }));
    const incomplete = (result.incomplete || []).map((inc) => ({
      id: inc.id,
      help: inc.help,
      nodeCount: inc.nodes?.length ?? 0,
    }));
    return {
      label,
      contextSelector: sel,
      pass: violations.length === 0,
      violationCount: violations.length,
      violations,
      passes: result.passes?.length ?? 0,
      incomplete,
      incompleteCount: incomplete.length,
    };
  },
    { label: surfaceLabel, contextSelector },
  );

  fs.writeFileSync(path.join(OUT, `gate-contrast-${surfaceLabel}.json`), JSON.stringify(summary, null, 2));

  if (!summary.pass) {
    console.error(`CONTRAST FAIL [${surfaceLabel}] — ${summary.violationCount} violation(s)`);
    for (const v of summary.violations || []) {
      for (const n of v.nodes || []) {
        console.error(
          `  ${sanitizeHtml(n.failureSummary || v.help)} target=${JSON.stringify(n.target)} html=${sanitizeHtml(n.html)}`,
        );
      }
    }
  }
  if (summary.incompleteCount > 0) {
    console.warn(
      `CONTRAST INCOMPLETE [${surfaceLabel}] — ${summary.incompleteCount} rule(s) could not evaluate every node (see gate-contrast-${surfaceLabel}.json)`,
    );
  }
  return summary;
}

function contrastHardPass(...summaries) {
  return summaries.every((s) => s && s.pass === true && (s.violationCount ?? 0) === 0);
}

async function dumpChrome(page, label) {
  const info = await page.evaluate(() => {
    const footer = document.querySelector('[data-testid="site-footer"], footer');
    const footerLinks = [...document.querySelectorAll('[data-testid="site-footer"] a, footer a')]
      .map((a) => (a.textContent || '').trim())
      .filter(Boolean);
    const headerText = (document.querySelector('[data-testid="topbar"]')?.innerText || '').replace(/\s+/g, ' ').trim();
    const connect = document.querySelector('[data-testid="topbar-connect"]');
    const mcpInHeader = !!connect || /\bMCP\b/.test(headerText);
    const tabbar = document.querySelector('[data-testid="mobile-tabbar"]');
    let tabbarBox = null;
    if (tabbar) {
      const r = tabbar.getBoundingClientRect();
      tabbarBox = { visible: r.height > 0, text: (tabbar.innerText || '').replace(/\s+/g, ' ').trim() };
    }
    const body = document.body?.innerText?.slice(0, 4000) || '';
    const pack = document.querySelector('[data-testid="for-you-pack"]');
    let packJdSample = null;
    if (pack) {
      const jd =
        pack.querySelector('[data-testid="for-you-jd-template"]') ||
        pack.querySelector('[data-testid="for-you-jd-full-body"]') ||
        pack.querySelector('[data-testid="for-you-jd-soft-fail"]');
      packJdSample = (jd?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120) || null;
    }
    return {
      signedIn: !!document.querySelector('[data-testid="topbar-avatar"]'),
      signInVisible: !!document.querySelector('[data-testid="topbar-signin"]'),
      mcpInHeader,
      footerLean: footer?.getAttribute('data-lean') === 'true',
      footerLinks,
      footerCount: footerLinks.length,
      tabbar: tabbarBox,
      welcomeVivek: /Welcome back,\s*Vivek/i.test(body),
      hasCanadaCopy: /\bCanada jobs\b|\bCanada\b.*career pages/i.test(body),
      numericFit: /\d+\s*%\s*Match|\bStrong\b.*\d+\s*·\s*\d+\s*Good/i.test(body),
      hasDidYouApply: /Did you apply/i.test(body),
      packCount: document.querySelectorAll('[data-testid^="hub-pack-card"]').length,
      packJdSample,
    };
  });
  fs.writeFileSync(path.join(OUT, `dump-gate-${label}.json`), JSON.stringify(info, null, 2));
  return info;
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

async function verifySession(page) {
  const res = await page.request.get(`${BASE}/api/auth/session`);
  const body = await res.json();
  return body?.user ?? null;
}

async function runIcon(browser, enginePrefix, label, viewport, wos) {
  const tag = `${enginePrefix}-${label}`;
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    ...(viewport.width < 500
      ? { isMobile: true, hasTouch: true, userAgent: devices['iPhone 13'].userAgent }
      : {}),
  });
  await injectSession(ctx, wos);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/jobs`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const user = await verifySession(page);
  const chrome = await dumpChrome(page, tag);
  await shot(page, `gate-icon-${tag}.png`);
  const pass =
    user &&
    chrome.signedIn &&
    !chrome.signInVisible &&
    !chrome.mcpInHeader &&
    (await page.getByTestId('topbar-logo').isVisible().catch(() => false));
  await ctx.close();
  return { pass, user: user?.email, chrome };
}

/** Real apply departure: popup tab + elapsed away time + focus back (see ApplyReturnPrompt). */
async function walkApplyReturnPrompt(page, enginePrefix, label) {
  const dl = page.getByTestId('for-you-download-apply');
  if (!(await dl.isVisible({ timeout: 8000 }).catch(() => false))) {
    return { ok: false, reason: 'download-apply-missing', promptContrast: null };
  }
  const popupPromise = page.waitForEvent('popup', { timeout: 30000 }).catch(() => null);
  await dl.click();
  const popup = await popupPromise;
  await page.waitForTimeout(APPLY_AWAY_MS);
  if (popup) await popup.close().catch(() => {});
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const prompt = page.getByTestId('apply-return-prompt');
  const promptVisible = await prompt.isVisible({ timeout: 8000 }).catch(() => false);
  await shot(page, `gate-betalist-${enginePrefix}-${label}-apply-return.png`);
  if (!promptVisible) {
    return { ok: false, reason: 'prompt-missing', popupOpened: !!popup, promptContrast: null };
  }
  const promptContrast = await runAxeContrast(
    page,
    `${enginePrefix}-${label}-apply-prompt`,
    '[data-testid="apply-return-prompt"]',
  );
  const buttons = {
    yes: await page.getByTestId('apply-return-mark-applied').isVisible().catch(() => false),
    notYet: await page.getByTestId('apply-return-not-yet').isVisible().catch(() => false),
    skip: await page.getByTestId('apply-return-skip').isVisible().catch(() => false),
  };
  if (!buttons.yes || !buttons.notYet || !buttons.skip) {
    return {
      ok: false,
      reason: 'apply-return-buttons-incomplete',
      buttons,
      popupOpened: !!popup,
      promptContrast,
    };
  }
  await page.getByTestId('apply-return-not-yet').click();
  const dismissed = !(await prompt.isVisible({ timeout: 2000 }).catch(() => true));
  await shot(page, `gate-betalist-${enginePrefix}-${label}-apply-return-dismissed.png`);
  return {
    ok: dismissed,
    reason: dismissed ? null : 'dismiss-failed',
    buttons,
    popupOpened: !!popup,
    promptContrast,
  };
}

async function runBetalist(browser, enginePrefix, label, viewport, wos) {
  const tag = `${enginePrefix}-${label}`;
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    ...(viewport.width < 500
      ? { isMobile: true, hasTouch: true, userAgent: devices['iPhone 13'].userAgent }
      : {}),
  });
  await injectSession(ctx, wos);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/jobs`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid^="hub-pack-card"]', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2000);
  for (const id of ['packs-home-intro-got-it', 'packs-home-intro-resume']) {
    const b = page.getByTestId(id);
    if (await b.isVisible({ timeout: 800 }).catch(() => false)) await b.click().catch(() => {});
  }
  const hub = await dumpChrome(page, `${tag}-hub`);
  await shot(page, `gate-betalist-${tag}-hub.png`);
  const hubContrast = await runAxeContrast(page, `${tag}-hub`, '[data-testid="job-packs-hub"]');

  const all = page.getByTestId('hub-pack-card-all');
  if (await all.isVisible({ timeout: 5000 }).catch(() => false)) await all.click();
  else await page.locator('[data-testid^="hub-pack-card"]').first().click();
  await page.getByTestId('for-you-download-apply').waitFor({ state: 'visible', timeout: 60000 }).catch(() => {});
  await page.getByTestId('for-you-pack').waitFor({ state: 'visible', timeout: 60000 }).catch(() => {});
  await Promise.race([
    page.getByTestId('for-you-jd-template').waitFor({ state: 'visible', timeout: 90000 }),
    page.getByTestId('for-you-jd-full-body').waitFor({ state: 'visible', timeout: 90000 }),
    page.getByTestId('for-you-jd-soft-fail').waitFor({ state: 'visible', timeout: 90000 }),
  ]).catch(() => {});
  await page.waitForTimeout(500);
  const deckContrast = await runAxeContrast(
    page,
    `${tag}-deck`,
    '[data-testid="for-you-pack"] [data-pack-scroll]',
  );
  const applyReturn = await walkApplyReturnPrompt(page, enginePrefix, label);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  const deck = await dumpChrome(page, `${tag}-deck`);
  await shot(page, `gate-betalist-${tag}-deck.png`);
  await ctx.close();

  const hubPass =
    hub.signedIn &&
    !hub.mcpInHeader &&
    hub.footerLean &&
    hub.footerCount === 2 &&
    hub.footerLinks.every((l) => /privacy|terms/i.test(l)) &&
    !hub.hasCanadaCopy &&
    hub.packCount >= 8;
  const deckPass =
    deck.footerLean &&
    deck.footerCount <= 2 &&
    !deck.numericFit &&
    applyReturn.ok &&
    !!deck.packJdSample;
  const contrastPass = contrastHardPass(hubContrast, deckContrast, applyReturn.promptContrast);

  return {
    hubPass,
    deckPass,
    contrastPass,
    hub,
    deck,
    applyReturn,
    contrast: {
      hub: hubContrast,
      deck: deckContrast,
      prompt: applyReturn.promptContrast,
    },
  };
}

async function runEngineGate(engineName, launch) {
  const enginePrefix = engineName;
  let browser;
  try {
    browser = await launch();
  } catch (err) {
    return {
      engine: engineName,
      available: false,
      error: String(err?.message || err),
    };
  }
  try {
    const iconDesktop = await runIcon(browser, enginePrefix, 'desktop', { width: 1280, height: 800 }, wos);
    const iconMobile = await runIcon(browser, enginePrefix, 'mobile', { width: 390, height: 844 }, wos);
    const icon = {
      desktop: iconDesktop,
      mobile: iconMobile,
      pass: iconDesktop.pass && iconMobile.pass,
    };
    if (!icon.pass) {
      return { engine: engineName, available: true, icon, betalist: { blocked: true }, pass: false };
    }
    const betDesktop = await runBetalist(browser, enginePrefix, 'desktop', { width: 1280, height: 800 }, wos);
    const betMobile = await runBetalist(browser, enginePrefix, 'mobile', { width: 390, height: 844 }, wos);
    const betalist = { desktop: betDesktop, mobile: betMobile };
    const pass =
      betDesktop.hubPass &&
      betDesktop.deckPass &&
      betDesktop.contrastPass &&
      betMobile.hubPass &&
      betMobile.deckPass &&
      betMobile.contrastPass;
    return { engine: engineName, available: true, icon, betalist, pass };
  } finally {
    await browser.close();
  }
}

const wos = readWosSession();
fs.mkdirSync(OUT, { recursive: true });
const verdict = {
  capturedAt: new Date().toISOString(),
  gitHead: process.env.GIT_HEAD || null,
  baseUrl: BASE,
  cookieSource: wos ? (process.env.WOS_SESSION ? 'env' : COOKIE_FILE) : null,
  cookieLen: wos?.length ?? 0,
  contrastRule:
    'axe-core color-contrast (WCAG AA) on job-packs-hub, for-you-pack JD scroller (data-pack-scroll), apply-return-prompt',
};

if (!wos) {
  verdict.verdict = 'BLOCKED';
  verdict.reason = `No cookie at ${COOKIE_FILE} or WOS_SESSION`;
  fs.writeFileSync(path.join(OUT, 'gate-walk-verdict.json'), JSON.stringify(verdict, null, 2));
  console.log(JSON.stringify(verdict, null, 2));
  process.exit(2);
}

verdict.chromium = await runEngineGate('chromium', () =>
  chromium.launch(linuxChromiumVisualQaLaunchOptions({ headless: true })),
);
verdict.webkit = await runEngineGate('webkit', () => webkit.launch({ headless: true }));

const enginesOk =
  verdict.chromium?.available &&
  verdict.chromium?.pass &&
  verdict.webkit?.available &&
  verdict.webkit?.pass;

verdict.verdict = enginesOk ? 'PASS' : 'FAIL';
if (!verdict.webkit?.available) {
  verdict.reason = verdict.reason || 'webkit engine unavailable';
}
if (verdict.chromium?.available && !verdict.chromium?.pass) {
  verdict.reason = verdict.reason || 'chromium gate failed (chrome, betalist, and/or contrast)';
}
if (verdict.webkit?.available && !verdict.webkit?.pass) {
  verdict.reason = verdict.reason || 'webkit gate failed (chrome, betalist, and/or contrast)';
}

fs.writeFileSync(path.join(OUT, 'gate-walk-verdict.json'), JSON.stringify(verdict, null, 2));
console.log(JSON.stringify(verdict, null, 2));
process.exit(verdict.verdict === 'PASS' ? 0 : 1);
