// form-audit.js
//
// CONTRACT
// Pass this file's contents verbatim as the --fn argument:
//   openclaw browser evaluate --fn "$(cat openclaw/scripts/form-audit.js)" --target-id <form-tab>
// It is a single zero-argument function that runs in the page's own context
// (native `document`, no imports, no ref argument) and returns a JSON
// string. That stdout IS the ground truth for whether a field is filled, a
// box is checked, or a file is attached — nothing in FORM FILL may report a
// control's state from memory. Run it fresh, every time, both before filling
// (PRE-FLIGHT AUDIT) and after (POST-FILL AUDIT).
//
// WHY THIS EXISTS
// `browser snapshot` (both --format ai and --format aria) does not expose
// checked/pressed state on Ashby's controls — an agent reading only the
// snapshot cannot tell whether a checkbox took. `browser evaluate` reads
// real DOM properties, the only place true state lives. Ashby also names
// controls with opaque UUIDs (`name="a1b2c3d4-..."`), so the visible
// question text has to be recovered by walking the DOM, not read off the
// `name` attribute — label recovery is capped at 120 chars (falling back to
// `name`/`id`) so a walk that climbs into a heading or a JSON blob can't
// flood the output. Visually-hidden controls are KEPT (ATS platforms
// commonly drive the real answer through a hidden native input behind
// styled buttons — dropping hidden controls drops real answers); only
// genuine infrastructure fields (captcha/honeypot, identified by naming
// convention) are skipped. A control this script can't explain is still
// reported, labelled by its raw `name`, never silently dropped.
//
// OUTPUT SHAPE
// {
//   "controls": [
//     {
//       "label": "<recovered visible question text, <=120 chars>",
//       "name": "<name or id attribute, verbatim — often an opaque UUID>",
//       "type": "checkbox" | "radio" | "checkbox-role" | "switch" | "toggle"
//              | "text" | "email" | "tel" | ... | "textarea"
//              | "select-one" | "select-multiple" | "file",
//       "required": true | false,
//       "state": <bool for checkbox/radio/checkbox-role/switch/toggle,
//                 string for text-like ("" if untouched),
//                 string|null for file (the real attached filename, or null)>
//     }, ...
//   ],
//   "summary": {
//     "requiredAndEmpty": [ { "label": ..., "name": ..., "type": ... }, ... ],
//     "unansweredQuestions": [ { "label": ..., "name": ..., "type": ... }, ... ]
//   }
// }
//
// A radio group (multiple inputs sharing type=radio and name) is listed as
// one control PER OPTION in `controls` (so you can see which option, if
// any, is selected) but collapsed to ONE entry in the summaries below.
//
// `requiredAndEmpty` = required-and-still-empty/unchecked controls — these
// block submission. `unansweredQuestions` = every question-type control
// (checkbox/radio/switch/toggle/select/textarea) still in its default/empty
// state REGARDLESS of required-ness — Ashby-class forms mark real questions
// ("willing to work on-site 3x/week?") as optional, so required-ness alone
// misses them; report both and let the human decide on the non-required
// ones.

() => {
  const LABEL_MAX_CHARS = 120;

  const CONTROL_SELECTOR = [
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"])',
    'textarea',
    'select',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[aria-pressed]',
  ].join(', ');

  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const isVisibleText = (s) => clean(s).length > 0;
  const textOf = (el) => clean(el && el.textContent);

  // Visually-hidden is NOT the same as infrastructure. ATS platforms
  // routinely drive a real answer through a visually-hidden native input
  // behind styled buttons (verified live: Ashby's Yes/No toggle is exactly
  // this — a hidden `<input type=checkbox>` with two decorative `<button>`
  // siblings) — filtering those out drops the actual answer. Only skip
  // controls whose PURPOSE is infrastructure (captcha/honeypot), identified
  // by the widget's own naming convention, never by visibility.
  function isInfrastructureControl(el) {
    const key = `${el.name || ''} ${el.id || ''}`.toLowerCase();
    if (/captcha|honeypot/.test(key)) return true;
    return !!el.closest('[class*="captcha" i], [id*="captcha" i]');
  }

  function controlCountIn(node) {
    return Array.from(node.querySelectorAll(CONTROL_SELECTOR)).filter((c) => !isInfrastructureControl(c)).length;
  }

  // Text of `node`'s children that appear BEFORE the branch containing
  // `targetEl` — i.e. a leading question/heading, never a trailing toggle
  // label ("Yes"/"No") that lives in the same container as the control.
  function leadingText(node, targetEl) {
    let text = '';
    for (const child of node.childNodes) {
      if (child === targetEl) break;
      if (child.nodeType === 1 && child.contains(targetEl)) break;
      text += child.textContent || '';
    }
    return clean(text);
  }

  // Climb ancestors for the nearest block whose LEADING text (before the
  // control itself) is non-empty, stopping as soon as a candidate container
  // holds more than one visible control — that's the signal we've climbed
  // past this field into a group/section and would start picking up
  // unrelated content (or, at the extreme, the whole page).
  function climbForLabel(el) {
    let node = el.parentElement;
    for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
      if (controlCountIn(node) > 1) break;
      const text = leadingText(node, el);
      if (isVisibleText(text)) return text;
    }
    return null;
  }

  // Recover the human-visible question text for a control, in order:
  // aria-label -> aria-labelledby -> <label for=id> -> ancestor <label> ->
  // nearest <fieldset><legend> -> nearest ancestor's leading text (Ashby's
  // pattern: a question sibling with no `for` attribute, followed by the
  // control) -> placeholder -> name/id.
  function recoverLabelRaw(el) {
    const ariaLabel = el.getAttribute('aria-label');
    if (isVisibleText(ariaLabel)) return clean(ariaLabel);

    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => textOf(document.getElementById(id)))
        .filter(isVisibleText)
        .join(' ');
      if (isVisibleText(text)) return clean(text);
    }

    // `for` should reference an `id`, but Ashby points it at the control's
    // `name` instead (verified live: a checkbox with no `id` at all, whose
    // `name` is a UUID matching a real <label for="<that uuid>">) — try
    // both rather than assuming spec-correct markup.
    const forTarget = el.id || el.name;
    if (forTarget) {
      const forLabel = document.querySelector(`label[for="${CSS.escape(forTarget)}"]`);
      if (forLabel && isVisibleText(forLabel.textContent)) return textOf(forLabel);
    }

    const wrappingLabel = el.closest('label');
    if (wrappingLabel) {
      const clone = wrappingLabel.cloneNode(true);
      clone.querySelectorAll(CONTROL_SELECTOR).forEach((n) => n.remove());
      if (isVisibleText(clone.textContent)) return textOf(clone);
    }

    const fieldset = el.closest('fieldset');
    if (fieldset) {
      const legend = fieldset.querySelector('legend');
      if (legend && isVisibleText(legend.textContent)) return textOf(legend);
    }

    const climbed = climbForLabel(el);
    if (climbed) return climbed;

    if (isVisibleText(el.getAttribute('placeholder'))) return clean(el.getAttribute('placeholder'));
    return null;
  }

  function recoverLabel(el) {
    const raw = recoverLabelRaw(el);
    if (raw && raw.length <= LABEL_MAX_CHARS) return raw;
    return el.name || el.id || '(unlabeled)';
  }

  // For a radio OPTION, recoverLabel() above correctly returns the option's
  // own text ("Yes"). The group as a whole (used in the summaries) needs
  // the overarching QUESTION text instead — fieldset/legend first, then the
  // nearest ancestor's leading text, skipping the per-option <label>
  // wrapper and tolerating the group's OWN radios (but not other fields) in
  // the control count.
  function recoverGroupLabelRaw(el, groupName) {
    const fieldset = el.closest('fieldset');
    if (fieldset) {
      const legend = fieldset.querySelector('legend');
      if (legend && isVisibleText(legend.textContent)) return textOf(legend);
    }
    let node = el.parentElement;
    for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
      if (node.tagName === 'LABEL') continue;
      const others = Array.from(node.querySelectorAll(CONTROL_SELECTOR))
        .filter((c) => !isInfrastructureControl(c))
        .filter((c) => !(c.type === 'radio' && c.name === groupName));
      if (others.length > 0) break;
      const text = leadingText(node, el);
      if (isVisibleText(text)) return text;
    }
    return null;
  }

  function recoverGroupLabel(el, groupName) {
    const raw = recoverGroupLabelRaw(el, groupName);
    return raw && raw.length <= LABEL_MAX_CHARS ? raw : null;
  }

  function isRequired(el, label) {
    if (el.required || el.getAttribute('aria-required') === 'true') return true;
    return /\*/.test(label);
  }

  function controlType(el) {
    const role = el.getAttribute('role');
    if (role === 'checkbox') return 'checkbox-role';
    if (role === 'switch') return 'switch';
    if (role === 'radio') return 'radio';
    if (el.hasAttribute('aria-pressed')) return 'toggle';
    if (el.tagName === 'TEXTAREA') return 'textarea';
    if (el.tagName === 'SELECT') return el.multiple ? 'select-multiple' : 'select-one';
    return el.type || 'text';
  }

  const BOOL_TYPES = new Set(['checkbox', 'radio', 'checkbox-role', 'switch', 'toggle']);
  const QUESTION_TYPES = new Set(['checkbox', 'checkbox-role', 'switch', 'toggle', 'select-one', 'select-multiple', 'textarea']);

  function trueState(el, type) {
    if (BOOL_TYPES.has(type)) {
      if (type === 'checkbox' || type === 'radio') return !!el.checked;
      if (type === 'toggle') return el.getAttribute('aria-pressed') === 'true';
      return el.getAttribute('aria-checked') === 'true';
    }
    if (type === 'file') return el.files && el.files.length ? el.files[0].name : null;
    if (type === 'select-multiple') {
      return Array.from(el.selectedOptions || []).map((o) => clean(o.textContent)).join(', ');
    }
    if (type === 'select-one') {
      const opt = el.selectedOptions && el.selectedOptions[0];
      return opt ? clean(opt.textContent) : '';
    }
    return el.value != null ? el.value : '';
  }

  const seen = new Set();
  const controls = [];
  const radioGroupLabels = new Map();
  document.querySelectorAll(CONTROL_SELECTOR).forEach((el) => {
    if (seen.has(el) || el.disabled || isInfrastructureControl(el)) return;
    seen.add(el);
    const type = controlType(el);
    const label = recoverLabel(el);
    controls.push({
      label,
      name: el.name || el.id || null,
      type,
      required: isRequired(el, label),
      state: trueState(el, type),
    });
    if (type === 'radio') {
      const key = el.name || label;
      if (!radioGroupLabels.has(key)) {
        const groupLabel = recoverGroupLabel(el, el.name);
        if (groupLabel) radioGroupLabels.set(key, groupLabel);
      }
    }
  });

  // Radio groups are satisfied if ANY option in the (name-keyed) group is
  // checked, even though each option is still listed individually above.
  const radioGroups = new Map();
  for (const c of controls) {
    if (c.type !== 'radio') continue;
    const key = c.name || c.label;
    if (!radioGroups.has(key)) {
      radioGroups.set(key, { label: radioGroupLabels.get(key) || c.label, name: c.name, required: false, satisfied: false });
    }
    const g = radioGroups.get(key);
    g.required = g.required || c.required;
    g.satisfied = g.satisfied || c.state === true;
  }

  const requiredAndEmpty = [];
  const unansweredQuestions = [];
  for (const g of radioGroups.values()) {
    if (!g.satisfied) {
      const entry = { label: g.label, name: g.name, type: 'radio' };
      unansweredQuestions.push(entry);
      if (g.required) requiredAndEmpty.push(entry);
    }
  }
  for (const c of controls) {
    if (c.type === 'radio') continue;
    const empty = BOOL_TYPES.has(c.type) ? c.state !== true : c.type === 'file' ? c.state == null : c.state === '' || c.state == null;
    if (!empty) continue;
    if (c.required) requiredAndEmpty.push({ label: c.label, name: c.name, type: c.type });
    if (QUESTION_TYPES.has(c.type)) unansweredQuestions.push({ label: c.label, name: c.name, type: c.type });
  }

  return JSON.stringify({ controls, summary: { requiredAndEmpty, unansweredQuestions } });
}
