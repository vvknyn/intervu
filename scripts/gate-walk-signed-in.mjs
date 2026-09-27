/**
 * Signed-in Icon + Betalist lean gate walk for loopback QA.
 * Requires wos-session value in /tmp/velai-wos-session.txt or WOS_SESSION env.
 */
import { chromium, devices } from 'playwright';
import { linuxChromiumVisualQaLaunchOptions } from './design/linux-chromium-visual-qa.cjs';
import fs from 'fs';
import path from 'path';

const BASE = 'http://127.0.0.1:3002';
const COOKIE_FILE = '/tmp/velai-wos-session.txt';
const OUT =
  process.env.GATE_OUT ||
  '/Users/vivek/Library/Application Support/Cursor/AgentStores/cursor_agent_stores/bc-c68fc246-2df9-5e47-93dd-53b44f76f96f/files/media/signed-in-gate';

function readWosSession() {
  if (process.env.WOS_SESSION?.trim()) return process.env.WOS_SESSION.trim();
  if (fs.existsSync(COOKIE_FILE)) return fs.readFileSync(COOKIE_FILE, 'utf8').trim();
  return null;
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

async function runIcon(browser, label, viewport, wos) {
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
  const chrome = await dumpChrome(page, label);
  await shot(page, `gate-icon-${label}.png`);
  const pass =
    user &&
    chrome.signedIn &&
    !chrome.signInVisible &&
    !chrome.mcpInHeader &&
    (await page.getByTestId('topbar-logo').isVisible().catch(() => false));
  await ctx.close();
  return { pass, user: user?.email, chrome };
}

async function runBetalist(browser, label, viewport, wos) {
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
  const hub = await dumpChrome(page, `${label}-hub`);
  await shot(page, `gate-betalist-${label}-hub.png`);
  const all = page.getByTestId('hub-pack-card-all');
  if (await all.isVisible({ timeout: 5000 }).catch(() => false)) await all.click();
  else await page.locator('[data-testid^="hub-pack-card"]').first().click();
  await page.waitForTimeout(4000);
  const dl = page.getByTestId('for-you-download-apply');
  if (await dl.isVisible({ timeout: 8000 }).catch(() => false)) {
    await dl.click().catch(() => {});
    await page.waitForTimeout(2500);
  }
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  const deck = await dumpChrome(page, `${label}-deck`);
  await shot(page, `gate-betalist-${label}-deck.png`);
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
    (deck.hasDidYouApply || label.includes('mobile'));
  return { hubPass, deckPass, hub, deck };
}

const wos = readWosSession();
fs.mkdirSync(OUT, { recursive: true });
const verdict = {
  capturedAt: new Date().toISOString(),
  baseUrl: BASE,
  cookieSource: wos ? (process.env.WOS_SESSION ? 'env' : COOKIE_FILE) : null,
  cookieLen: wos?.length ?? 0,
};

if (!wos) {
  verdict.verdict = 'BLOCKED';
  verdict.reason = `No cookie at ${COOKIE_FILE} or WOS_SESSION`;
  fs.writeFileSync(path.join(OUT, 'gate-walk-verdict.json'), JSON.stringify(verdict, null, 2));
  console.log(JSON.stringify(verdict, null, 2));
  process.exit(2);
}

const browser = await chromium.launch(linuxChromiumVisualQaLaunchOptions({ headless: true }));
try {
  const iconDesktop = await runIcon(browser, 'desktop', { width: 1280, height: 800 }, wos);
  const iconMobile = await runIcon(browser, 'mobile', { width: 390, height: 844 }, wos);
  verdict.icon = {
    desktop: iconDesktop,
    mobile: iconMobile,
    pass: iconDesktop.pass && iconMobile.pass,
  };
  if (!verdict.icon.pass) {
    verdict.verdict = 'FAIL';
    verdict.betalist = { blocked: true };
  } else {
    const betDesktop = await runBetalist(browser, 'desktop', { width: 1280, height: 800 }, wos);
    const betMobile = await runBetalist(browser, 'mobile', { width: 390, height: 844 }, wos);
    verdict.betalist = { desktop: betDesktop, mobile: betMobile };
    verdict.verdict =
      betDesktop.hubPass && betDesktop.deckPass && betMobile.hubPass && betMobile.deckPass ? 'PASS' : 'FAIL';
  }
} finally {
  await browser.close();
}

fs.writeFileSync(path.join(OUT, 'gate-walk-verdict.json'), JSON.stringify(verdict, null, 2));
console.log(JSON.stringify(verdict, null, 2));
process.exit(verdict.verdict === 'PASS' ? 0 : 1);
