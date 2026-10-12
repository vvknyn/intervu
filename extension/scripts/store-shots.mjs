#!/usr/bin/env node
/**
 * The Chrome Web Store screenshots (1280×800): a headline and three short
 * points on the left, the real card or panel on the right, taken from the
 * screenshots check-panel.mjs saves. Every point is something the extension
 * does today; keep it that way when either changes. No other company is
 * named (the store treats that as keyword spam).
 *
 *   node extension/build.mjs && node extension/scripts/check-panel.mjs && node extension/scripts/store-shots.mjs [outDir]
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.resolve(here, "../dist/check");
const out = path.resolve(process.argv[2] ?? path.join(here, "../dist/store"));
mkdirSync(out, { recursive: true });

const png = (name) => `data:image/png;base64,${readFileSync(path.join(shots, name)).toString("base64")}`;
const icon = `data:image/png;base64,${readFileSync(path.resolve(here, "../icons/icon128.png")).toString("base64")}`;

/** Margin kept around the card when it is cut out of a 1280×800 job-page shot: its 1px border. */
const CARD_MARGIN = 1;

const SHOTS = [
    {
        file: "screenshot-1-fit-on-job-pages.png",
        headline: "See how every job fits you",
        sub: "A small card shows up on job pages by itself, checked against your Velai résumé.",
        points: ["Strong, Good or Stretch, with the reason", "✓ and ✗ for the role's words on your résumé", "No copying, no extra click"],
        visual: { kind: "card", page: "card-found.png" },
    },
    {
        file: "screenshot-2-posting-checks.png",
        headline: "Know if a posting is current",
        sub: "Before you spend an hour on an application. No account needed.",
        points: ["Whether the job looks actively posted", "When it was posted, the pay, the apply-by date", "Every line says where it comes from"],
        visual: { kind: "card", page: "card-signed-out.png" },
    },
    {
        file: "screenshot-3-why-it-fits.png",
        headline: "See why, not just a label",
        sub: "The same fit velai.app gives, explained line by line.",
        points: ["Relevance, seniority and location", "The role's words your résumé is missing", "Edit your résumé and the job is checked again"],
        visual: { kind: "panel", panel: "found.png", page: "job-page.png" },
    },
    {
        file: "screenshot-4-tailored-resume.png",
        headline: "Your résumé, tailored to this job",
        sub: "Built from your own résumé, inside the extension.",
        points: ["Lines that use the job's words come first", "Rewording uses only words already on your résumé", "Download a one-page PDF or copy the text"],
        visual: { kind: "panel", panel: "found-bottom.png", page: "job-page.png" },
    },
    {
        file: "screenshot-5-fill-and-track.png",
        headline: "Fill the form, track the application",
        sub: "One click fills an application form from your résumé and attaches your résumé for this job.",
        points: ["Name, email, phone and location", "Never sends it: you check it and submit", "In your Velai tracker once the site confirms"],
        visual: { kind: "card", page: "card-filled.png" },
    },
];

const CSS = `
* { box-sizing: border-box; margin: 0; }
body { width: 1280px; height: 800px; overflow: hidden; font-family: Inter, "Source Sans 3", system-ui, sans-serif; color: rgb(245 245 245);
  background: radial-gradient(1100px 700px at 85% 110%, rgb(22 64 42) 0%, rgb(11 13 18) 60%); }
.left { position: absolute; left: 72px; top: 0; bottom: 0; width: 470px; display: flex; flex-direction: column; justify-content: center; }
.brand { display: flex; align-items: center; gap: 10px; font-size: 20px; font-weight: 600; margin-bottom: 36px; }
.brand img { width: 32px; height: 32px; border-radius: 7px; }
h1 { font-size: 50px; line-height: 1.08; font-weight: 700; letter-spacing: -0.02em; }
.sub { margin-top: 18px; font-size: 21px; line-height: 1.45; color: rgb(190 196 205); }
ul { list-style: none; padding: 0; margin-top: 30px; }
li { display: flex; gap: 12px; align-items: flex-start; font-size: 19px; line-height: 1.4; margin-top: 14px; }
li::before { content: ""; flex: none; width: 22px; height: 22px; margin-top: 2px; border-radius: 999px;
  background: rgb(47 191 113) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6 12.5l4 4 8-9' fill='none' stroke='%23080a0c' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/14px no-repeat; }
.right { position: absolute; left: 590px; top: 0; right: 0; bottom: 0; }
.browser { position: absolute; left: 0; top: 96px; width: 640px; height: 520px; border-radius: 14px; overflow: hidden; background: rgb(246 245 240);
  box-shadow: 0 30px 80px rgb(0 0 0 / 0.55); border: 1px solid rgb(255 255 255 / 0.08); }
.bar { height: 34px; background: rgb(32 35 42); display: flex; align-items: center; gap: 7px; padding: 0 12px; }
.bar i { width: 10px; height: 10px; border-radius: 999px; background: rgb(90 94 102); }
.bar span { margin-left: 14px; flex: 1; height: 20px; border-radius: 999px; background: rgb(48 52 60); }
.page { width: 640px; height: 486px; background-repeat: no-repeat; }
.zoom { position: absolute; border-radius: 16px; box-shadow: 0 30px 70px rgb(0 0 0 / 0.6), 0 0 0 1px rgb(255 255 255 / 0.10); background-repeat: no-repeat; }
.panel { position: absolute; right: 52px; top: 48px; width: 360px; height: 704px; border-radius: 16px; overflow: hidden;
  box-shadow: 0 30px 80px rgb(0 0 0 / 0.6), 0 0 0 1px rgb(255 255 255 / 0.10); background-repeat: no-repeat; background-size: 360px 720px; }
.dim { filter: brightness(0.55); }
`;

/**
 * The card's box in a job-page shot: the area painted in the card's
 * background colour, rgb(16 18 24). The box stops above the card's last line,
 * the "Don't show on <site>" link, so no other site's name is in the shot.
 */
async function cardBox(page, file) {
    return page.evaluate(async (src) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, c.width, c.height);
        let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
        for (let y = 0; y < c.height; y++)
            for (let x = Math.floor(c.width / 2); x < c.width; x++) {
                const i = (y * c.width + x) * 4;
                if (data[i] === 16 && data[i + 1] === 18 && data[i + 2] === 24) {
                    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
                }
            }
        // Up from the bottom: the padding, the link's line, then the gap above it.
        const blank = (y) => {
            for (let x = x0 + 14; x <= x1 - 14; x++) {
                const i = (y * c.width + x) * 4;
                if (data[i] !== 16 || data[i + 1] !== 18 || data[i + 2] !== 24) return false;
            }
            return true;
        };
        let y = y1;
        while (y > y0 && blank(y)) y--;
        const padding = y1 - y;
        for (let run = 0; y > y0 && run < 4; y--) run = blank(y) ? run + 1 : 0;
        while (y > y0 && blank(y)) y--;
        // `h` ends at the last line kept; the card's own bottom padding is drawn under it.
        return { x: x0, y: y0, w: x1 - x0 + 1, h: y - y0 + 1, pad: padding };
    }, png(file));
}

function visualHtml(v, box) {
    if (v.kind === "card") {
        // The job page behind, scaled into the browser frame; the card itself, larger, in front.
        const scale = 640 / 1280;
        const x = box.x - CARD_MARGIN, y = box.y - CARD_MARGIN, w = box.w + 2 * CARD_MARGIN, h = box.h + CARD_MARGIN;
        const full = h + box.pad + CARD_MARGIN;
        // As large as fits: its right edge 40px inside the shot, its bottom 40px above it.
        const zoom = Math.min(1.3, 600 / w, 704 / full);
        return `<div class="browser"><div class="bar"><i></i><i></i><i></i><span></span></div>
          <div class="page" style="background-image:url(${png(v.page)});background-size:${1280 * scale}px ${800 * scale}px"></div></div>
          <div class="zoom" style="left:${650 - w * zoom}px;top:${Math.max(48, Math.min(760 - full * zoom, 300))}px;width:${w * zoom}px;height:${full * zoom}px;border-radius:${13 * zoom}px;overflow:hidden;background:rgb(16 18 24)">
            <div style="height:${h * zoom}px;background-image:url(${png(v.page)});background-repeat:no-repeat;background-size:${1280 * zoom}px ${800 * zoom}px;background-position:-${x * zoom}px -${y * zoom}px"></div></div>`;
    }
    return `<div class="browser dim" style="left:-20px"><div class="bar"><i></i><i></i><i></i><span></span></div>
        <div class="page" style="background-image:url(${png(v.page)});background-size:${879 * 0.73}px ${800 * 0.73}px"></div></div>
      <div class="panel" style="background-image:url(${png(v.panel)})"></div>`;
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
for (const s of SHOTS) {
    const box = s.visual.kind === "card" ? await cardBox(page, s.visual.page) : null;
    const html = `<!doctype html><meta charset="utf-8"><style>${CSS}</style>
      <div class="left"><div class="brand"><img src="${icon}" alt="">Velai</div><h1>${s.headline}</h1><p class="sub">${s.sub}</p>
      <ul>${s.points.map((p) => `<li>${p}</li>`).join("")}</ul></div>
      <div class="right">${visualHtml(s.visual, box)}</div>`;
    await page.setContent(html);
    await page.screenshot({ path: path.join(out, s.file) });
    console.log(`Saved ${path.join(out, s.file)}`);
}
await browser.close();
