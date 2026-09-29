/**
 * Signed-out /jobs (board-first since #652 — the Concept A landing is gone):
 * axe color-contrast on the page's one <main> landmark plus computed-AA
 * fallback for axe "incomplete" text nodes (gradients / overlap).
 */
export const LANDING_ROOT_SEL = '#main';

export async function probeLandingRoot(page) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    const text = (root?.innerText || '').replace(/\s+/g, ' ').trim();
    return {
      exists: !!root,
      textLen: text.length,
      hasJobTitles: (root?.querySelectorAll('[data-testid="job-row"] [data-testid="job-title"]').length ?? 0) >= 1,
    };
  }, LANDING_ROOT_SEL);
}

export async function runScopedAxeContrast(page, rootSel) {
  return page.evaluate(async (rootSel) => {
    if (!globalThis.axe) {
      return { error: 'axe-not-loaded', pass: false, violationCount: 1, incompleteCount: 1, scannedNodes: 0 };
    }
    const root = document.querySelector(rootSel);
    if (!root) {
      return { error: 'landing-root-missing', pass: false, violationCount: 1, incompleteCount: 1, scannedNodes: 0 };
    }

    const axeResult = await globalThis.axe.run(root, {
      runOnly: { type: 'rule', values: ['color-contrast'] },
    });

    const countNodes = (arr) => (arr || []).reduce((n, item) => n + (item.nodes?.length || 0), 0);
    const violations = axeResult.violations || [];
    const incomplete = axeResult.incomplete || [];
    const scannedNodes =
      countNodes(violations) + countNodes(incomplete) + countNodes(axeResult.passes) + (axeResult.passes?.length || 0);

    const parseRgb = (raw) => {
      if (!raw || raw === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
      const m = raw.match(/rgba?\(([^)]+)\)/);
      if (!m) return { r: 0, g: 0, b: 0, a: 0 };
      const parts = m[1].split(',').map((p) => p.trim());
      const r = Number(parts[0]);
      const g = Number(parts[1]);
      const b = Number(parts[2]);
      const a = parts.length > 3 ? Number(parts[3]) : 1;
      return { r, g, b, a: Number.isFinite(a) ? a : 1 };
    };

    const composite = (fg, bg) => ({
      r: Math.round(fg.r * fg.a + bg.r * (1 - fg.a)),
      g: Math.round(fg.g * fg.a + bg.g * (1 - fg.a)),
      b: Math.round(fg.b * fg.a + bg.b * (1 - fg.a)),
      a: 1,
    });

    const relLum = ({ r, g, b }) => {
      const chan = (c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
    };

    const contrastRatio = (fg, bg) => {
      const L1 = relLum(fg);
      const L2 = relLum(bg);
      const lighter = Math.max(L1, L2);
      const darker = Math.min(L1, L2);
      return (lighter + 0.05) / (darker + 0.05);
    };

    const requiredRatio = (el) => {
      const cs = getComputedStyle(el);
      const px = parseFloat(cs.fontSize) || 16;
      const w = cs.fontWeight;
      const bold = w === 'bold' || w === 'bolder' || (Number.parseInt(w, 10) || 0) >= 700;
      const large = px >= 24 || (bold && px >= 18.67);
      return large ? 3 : 4.5;
    };

    const opaqueBackgroundAt = (el) => {
      let node = el;
      while (node && root.contains(node)) {
        const cs = getComputedStyle(node);
        const bg = parseRgb(cs.backgroundColor);
        if (bg.a >= 0.95) return bg;
        node = node.parentElement;
      }
      return parseRgb(getComputedStyle(root).backgroundColor);
    };

    const resolveTarget = (target) => {
      if (!target?.length) return null;
      const joined = target.join(' ');
      return root.querySelector(joined) || document.querySelector(joined);
    };

    const textSnippet = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);

    const sampleTextRects = (el) => {
      const range = document.createRange();
      const rects = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        const t = (n.textContent || '').trim();
        if (!t) continue;
        range.selectNodeContents(n);
        for (const rect of range.getClientRects()) {
          if (rect.width > 0 && rect.height > 0) rects.push(rect);
        }
      }
      if (!rects.length && el.getBoundingClientRect().width > 0) {
        rects.push(el.getBoundingClientRect());
      }
      return rects;
    };

    const evaluateNodeContrast = (el) => {
        const fgRaw = parseRgb(getComputedStyle(el).color);
        const threshold = requiredRatio(el);
        const rects = sampleTextRects(el);
        if (!rects.length) {
          return { pass: false, reason: 'no-visible-text-rect', threshold, ratio: null, fg: null, bg: null };
        }
        let worst = { ratio: Infinity, fg: null, bg: null };
        for (const rect of rects) {
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          const bg = opaqueBackgroundAt(el);
          const fg = fgRaw.a >= 0.99 ? fgRaw : composite(fgRaw, bg);
          const ratio = contrastRatio(fg, bg);
        if (ratio < worst.ratio) worst = { ratio, fg, bg };
      }
      const pass = worst.ratio >= threshold;
      return {
        pass,
        threshold,
        ratio: worst.ratio === Infinity ? null : Math.round(worst.ratio * 100) / 100,
        fg: worst.fg ? `rgb(${worst.fg.r},${worst.fg.g},${worst.fg.b})` : null,
        bg: worst.bg ? `rgb(${worst.bg.r},${worst.bg.g},${worst.bg.b})` : null,
      };
    };

    const contrastFallback = [];
    for (const rule of incomplete) {
      for (const node of rule.nodes || []) {
        const el = resolveTarget(node.target);
        const messageKey = node.any?.[0]?.data?.messageKey ?? null;
        const evalResult = el
          ? evaluateNodeContrast(el)
          : { pass: false, reason: 'target-missing', threshold: null, ratio: null, fg: null, bg: null };
        contrastFallback.push({
          selector: node.target,
          html: (node.html || '').replace(/\s+/g, ' ').trim().slice(0, 120),
          textSnippet: el ? textSnippet(el) : '',
          messageKey,
          ...evalResult,
        });
      }
    }

    const violationCount = violations.length;
    const incompleteCount = incomplete.length;
    const fallbackPass =
      incompleteCount === 0 || (contrastFallback.length > 0 && contrastFallback.every((r) => r.pass));
    const pass = violationCount === 0 && fallbackPass && scannedNodes > 0;

    return {
      scope: rootSel,
      violationCount,
      incompleteCount,
      passRuleCount: axeResult.passes?.length ?? 0,
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
      contrastFallback,
      pass,
    };
  }, rootSel);
}

export async function runLandingAxeWithContrastFallback(page) {
  return runScopedAxeContrast(page, LANDING_ROOT_SEL);
}
