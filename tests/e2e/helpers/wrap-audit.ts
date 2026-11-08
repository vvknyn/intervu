/**
 * The phone "wrapping" audit: one function that runs in the page and reports the three ways a line of controls or facts
 * wraps badly, so a journey (or a one-off sweep) can ask any rendered page the same questions.
 *
 * - `action-row`: a row made only of controls that wraps badly. Buttons (28px or taller) must fill every line they
 *   wrap onto, edge to edge (`.action-row`: equal shares, one left alone takes the line). A control left alone at
 *   its natural width under a pair is the ragged row ("Edit template / Replace", "Download .pdf / Download .json",
 *   "Delete") the founder's 2026-11-01 screenshot of /resume showed. Any row of three or more controls, buttons or
 *   text links (`.wrap-row`, the footer), also fails when its last line holds one and the line above holds two or more.
 * - `run`: a wrapping run of three or more plain list items or links (a legend, a list of links: nothing around any item)
 *   whose last line holds one item under a line of two or more ("Full-Time / Contract / Part-Time" then "Internship",
 *   "On-site / Hybrid" then "Fully Remote"). Chips and pills (an item with its own border or fill) are a cloud and
 *   are left to `text-wrap: balance`.
 * - `form-row`: a form whose parts do not each take their own line: a security-check widget (Turnstile is 300x65 and
 *   cannot shrink) on a line with any sibling, or a field on a line with a button while the form holds more than that
 *   one field and that one button ("Email me new jobs" beside the widget, "Not now" alone under them, the field a
 *   narrow box above), or a field alone on its line narrower than the form. An inline form of exactly a field and a
 *   button, and a line of buttons only, are fine (the button sits against its field).
 * - `meta-edge`: a "·", "•" or "|" that ends or starts a rendered line ("Technical Account Manager · 11 yrs exp ·"
 *   then "Richmond Hill, Ontario"). A separator clipped out of view (`.fact-line`) does not count, and neither
 *   does a "|" in code. A dash is prose, not a separator, and is not judged here.
 * - `overflow`: the page scrolls sideways.
 *
 * The function is self-contained (Playwright serialises it into the page), so it takes no imports and no closures.
 */
export type WrapFinding = { kind: "action-row" | "run" | "form-row" | "meta-edge" | "overflow"; where: string; detail: string };

export function auditWrapping(): WrapFinding[] {
    const findings: WrapFinding[] = [];
    const seen = new Set<string>();
    const add = (f: WrapFinding) => {
        const key = `${f.kind}|${f.where}|${f.detail}`;
        if (!seen.has(key)) {
            seen.add(key);
            findings.push(f);
        }
    };

    const shown = (el: Element) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 1 && r.height > 1 && cs.visibility !== "hidden" && cs.display !== "none";
    };
    const describe = (el: Element) => {
        const id = el.getAttribute("data-testid");
        const cls = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 4).join(".");
        const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 48);
        return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ""}${cls ? `.${cls}` : ""} "${text}"`;
    };
    const CONTROL = "button, [role='button'], a[href], input[type='submit'], input[type='button'], summary";

    // --- action rows -------------------------------------------------------------------------------------------------
    const hasOwnText = (el: Element) =>
        Array.from(el.childNodes).some((c) => c.nodeType === Node.TEXT_NODE && (c.textContent ?? "").trim() !== "");
    for (const box of Array.from(document.body.querySelectorAll("*"))) {
        if (!shown(box) || box.closest("[aria-hidden='true'], [hidden]")) continue;
        const kids = Array.from(box.children).filter(shown);
        if (kids.length < 2) continue;
        const controls = kids.filter((k) => k.matches(CONTROL));
        // A row of controls: every child is one. A paragraph with links in it is prose, not a row.
        if (controls.length < 2 || controls.length !== kids.length || hasOwnText(box)) continue;
        const cs = getComputedStyle(box);
        if (cs.overflowX === "auto" || cs.overflowX === "scroll") continue;
        const r = box.getBoundingClientRect();
        const left = r.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
        const right = r.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
        const rows: DOMRect[][] = [];
        for (const k of [...controls].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)) {
            const kr = k.getBoundingClientRect();
            const row = rows.find((cells) => Math.abs(cells[0].top - kr.top) < Math.max(4, kr.height / 2));
            if (row) row.push(kr);
            else rows.push([kr]);
        }
        if (rows.length < 2) continue;
        // A vertical list (block or grid children, one per line, such as the inset rows of a grouped list) is a list of rows, not a row that wrapped.
        const wrapsLines = (cs.display.includes("flex") && cs.flexWrap === "wrap") || box.classList.contains("wrap-row");
        if (!wrapsLines && rows.every((cells) => cells.length === 1)) continue;
        const buttons = controls.every((c) => c.getBoundingClientRect().height >= 28);
        const ragged =
            buttons &&
            !box.classList.contains("wrap-row") &&
            rows.some((cells) => {
                const first = Math.min(...cells.map((c) => c.left));
                const last = Math.max(...cells.map((c) => c.right));
                return first - left > 2 || right - last > 2;
            });
        const lastRow = rows[rows.length - 1];
        const lastFills = lastRow[0].left - left <= 2 && right - lastRow[0].right <= 2;
        const wraps = cs.display.includes("flex") || box.classList.contains("wrap-row");
        const stranded = wraps && controls.length >= 3 && lastRow.length === 1 && rows[rows.length - 2].length >= 2 && !lastFills;
        if (ragged || stranded) {
            add({
                kind: "action-row",
                where: describe(box),
                detail: `${controls.length} controls on ${rows.length} lines (${rows.map((cells) => cells.length).join("/")}), ${stranded ? "the last one alone" : "not filling the row"}`,
            });
        }
    }

    // --- runs of plain items -----------------------------------------------------------------------------------------
    const flagged = new Set<Element>();
    const hasChrome = (el: Element) => {
        const cs = getComputedStyle(el);
        const border = ["Top", "Right", "Bottom", "Left"].some((side) => parseFloat(cs.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 && cs.getPropertyValue(`border-${side.toLowerCase()}-style`) !== "none");
        return border || (cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent") || cs.backgroundImage !== "none";
    };
    const oneLine = (el: Element) => {
        const cs = getComputedStyle(el);
        const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
        return el.getBoundingClientRect().height <= line * 1.6 + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    };
    for (const box of Array.from(document.body.querySelectorAll("*"))) {
        if (!shown(box) || box.closest("[aria-hidden='true'], [hidden]")) continue;
        const cs = getComputedStyle(box);
        const wraps = (cs.display.includes("flex") && cs.flexWrap === "wrap") || box.classList.contains("wrap-row");
        if (!wraps || hasOwnText(box) || cs.overflowX === "auto" || cs.overflowX === "scroll") continue;
        const kids = Array.from(box.children).filter(shown);
        // A run is a list: items (`li`) or links and buttons. A line of facts (`.fact-line`) or a label beside its value wraps like text.
        if (kids.length < 3 || box.classList.contains("fact-line") || !kids.every((k) => k.tagName === "LI" || k.matches(CONTROL))) continue;
        if (kids.some(hasChrome) || !kids.every(oneLine)) continue;
        const r = box.getBoundingClientRect();
        const left = r.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
        const right = r.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
        const rows: DOMRect[][] = [];
        for (const k of [...kids].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)) {
            const kr = k.getBoundingClientRect();
            const row = rows.find((cells) => Math.abs(cells[0].top - kr.top) < Math.max(4, kr.height / 2));
            if (row) row.push(kr);
            else rows.push([kr]);
        }
        if (rows.length < 2) continue;
        const lastRow = rows[rows.length - 1];
        const lastFills = lastRow[0].left - left <= 2 && right - lastRow[0].right <= 2;
        if (lastRow.length === 1 && rows[rows.length - 2].length >= 2 && !lastFills && !flagged.has(box)) {
            flagged.add(box);
            if (!findings.some((f) => f.kind === "action-row" && f.where === describe(box))) {
                add({ kind: "run", where: describe(box), detail: `${kids.length} items on ${rows.length} lines (${rows.map((cells) => cells.length).join("/")}), the last one alone` });
            }
        }
    }

    // --- forms ----------------------------------------------------------------------------------------------------------
    const FIELD = "input:not([type='hidden'], [type='checkbox'], [type='radio'], [type='submit'], [type='button'], [type='file'], [type='range']), textarea, select";
    const isField = (k: Element) => k.matches(FIELD) || !!k.querySelector(FIELD);
    const isWidget = (k: Element) => k.matches("iframe, [data-testid='turnstile-slot']") || !!k.querySelector("iframe, [data-testid='turnstile-slot']");
    Array.from(document.body.querySelectorAll("form")).forEach((form, formIndex) => {
        if (!shown(form) || form.closest("[aria-hidden='true'], [hidden]")) return;
        const parts = Array.from(form.children).filter(shown);
        if (parts.length < 2) return;
        // Parts of different heights share a line when they overlap vertically (a 32px button centred beside a 65px widget does not start where the widget does).
        const lines: Element[][] = [];
        const spans: { top: number; bottom: number }[] = [];
        for (const k of [...parts].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)) {
            const kr = k.getBoundingClientRect();
            const at = spans.findIndex((span) => Math.min(kr.bottom, span.bottom) - Math.max(kr.top, span.top) > Math.min(kr.height, span.bottom - span.top) / 2);
            if (at >= 0) {
                lines[at].push(k);
                spans[at] = { top: Math.min(spans[at].top, kr.top), bottom: Math.max(spans[at].bottom, kr.bottom) };
            } else {
                lines.push([k]);
                spans.push({ top: kr.top, bottom: kr.bottom });
            }
        }
        const inlineForm = parts.length === 2 && parts.some((k) => isField(k)) && parts.some((k) => k.matches(CONTROL));
        const where = `${describe(form)} (form ${formIndex + 1})`;
        for (const line of lines) {
            if (line.length < 2) continue;
            const widget = line.some(isWidget);
            const fieldWithButton = !inlineForm && line.some((k) => isField(k)) && line.some((k) => k.matches(CONTROL));
            if (widget || fieldWithButton) {
                add({
                    kind: "form-row",
                    where,
                    detail: `${widget ? "a security-check widget shares a line with" : "a field shares a line with"} ${line.length - 1} other part${line.length > 2 ? "s" : ""} (${lines.map((cells) => cells.length).join("/")} per line)`,
                });
            }
        }
        // An inline form's button sits against its field, not at the far edge of a wider box.
        if (inlineForm) {
            const field = parts.find((k) => isField(k))!;
            const button = parts.find((k) => k.matches(CONTROL))!;
            const fieldBox = (field.matches(FIELD) ? field : field.querySelector(FIELD)!).getBoundingClientRect();
            const gap = button.getBoundingClientRect().left - fieldBox.right;
            if (Math.abs(button.getBoundingClientRect().top - fieldBox.top) < fieldBox.height && gap > 24) {
                add({ kind: "form-row", where, detail: `the button is ${Math.round(gap)}px from its field, not beside it` });
            }
        }
        // A field alone on its line fills the form: a capped box above a full-width widget and buttons reads as a stray.
        if (!inlineForm && lines.length >= 2) {
            const formWidth = form.getBoundingClientRect().width - parseFloat(getComputedStyle(form).paddingLeft) - parseFloat(getComputedStyle(form).paddingRight);
            for (const line of lines) {
                const field = line.length === 1 ? (line[0].matches(FIELD) ? line[0] : line[0].querySelector(FIELD)) : null;
                if (field && shown(field) && formWidth - field.getBoundingClientRect().width > 2) {
                    add({ kind: "form-row", where, detail: `a field is ${Math.round(field.getBoundingClientRect().width)}px in a ${Math.round(formWidth)}px form, not the form's width` });
                }
            }
        }
    });

    // --- separators at the edge of a line ----------------------------------------------------------------------------
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
        const parent = n.parentElement;
        if (!n.textContent?.trim() || !parent || parent.closest("script, style, noscript, code, pre, kbd, samp")) continue;
        if (parent.getBoundingClientRect().width <= 1 || getComputedStyle(parent).visibility === "hidden") continue;
        nodes.push(n);
    }
    const charRect = (n: Text, i: number) => {
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + 1);
        return Array.from(r.getClientRects()).find((b) => b.width > 0) ?? null;
    };
    const clippedOut = (n: Text, rect: DOMRect) => {
        for (let a: Element | null = n.parentElement; a && a !== document.documentElement; a = a.parentElement) {
            const cs = getComputedStyle(a);
            const clips = cs.overflowX !== "visible" || cs.overflowY !== "visible" || (cs.clipPath && cs.clipPath !== "none");
            if (!clips) continue;
            const b = a.getBoundingClientRect();
            if (rect.right <= b.left + 0.5 || rect.left >= b.right - 0.5 || rect.bottom <= b.top + 0.5 || rect.top >= b.bottom - 0.5) return true;
        }
        return false;
    };
    const sameLine = (a: DOMRect, b: DOMRect) => Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) <= Math.min(a.height, b.height) / 2;
    const neighbour = (idx: number, i: number, dir: -1 | 1): DOMRect | null => {
        const text = nodes[idx].textContent ?? "";
        for (let j = i + dir; j >= 0 && j < text.length; j += dir) {
            if (/\s/.test(text[j])) continue;
            return charRect(nodes[idx], j);
        }
        for (let k = idx + dir; k >= 0 && k < nodes.length; k += dir) {
            const t = nodes[k].textContent ?? "";
            for (let j = dir > 0 ? 0 : t.length - 1; j >= 0 && j < t.length; j += dir) {
                if (/\s/.test(t[j])) continue;
                return charRect(nodes[k], j);
            }
        }
        return null;
    };
    nodes.forEach((n, idx) => {
        const text = n.textContent ?? "";
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (!"·•|".includes(ch)) continue;
            const mark = charRect(n, i);
            if (!mark || clippedOut(n, mark)) continue;
            const prev = neighbour(idx, i, -1);
            const next = neighbour(idx, i, 1);
            const leads = !!prev && !sameLine(prev, mark);
            const trails = !!next && !sameLine(next, mark);
            if (leads || trails) {
                const owner = n.parentElement!.closest("p, li, div, h1, h2, h3, a, button") ?? n.parentElement!;
                const tagged = n.parentElement!.closest("[data-testid]");
                add({
                    kind: "meta-edge",
                    where: `${describe(owner)}${tagged ? ` in [${tagged.getAttribute("data-testid")}]` : ""}`,
                    detail: `"${ch}" ${leads ? "starts" : "ends"} a line`,
                });
            }
        }
    });

    // --- sideways scroll ---------------------------------------------------------------------------------------------
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) {
        add({ kind: "overflow", where: "document", detail: `scrollWidth ${doc.scrollWidth} > ${doc.clientWidth}` });
    }
    return findings;
}
