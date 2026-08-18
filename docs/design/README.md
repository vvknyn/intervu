# docs/design — what in here is canon

**Visual canon: [`DESIGN-LANGUAGE.md`](./DESIGN-LANGUAGE.md).** It supersedes every other
design spec in this directory and carries the supersession table. Read it before
implementing any UI change.

Everything else here is archived context, with one carve-out:

- **`PORTAL-REDESIGN-SPEC.md`** — visually superseded, but still the only written record of
  the data-honesty decisions (honest empty-state copy, cut features). Its look is dead; its
  product rules are not.
- **`EDITORIAL-PASS-SPEC.md`** — fully superseded. Archive only.
- **`soft-signal-*/`, `elite-company-signal/`, `intervu-portal.dc.html`** — mockup sets drawn
  against retired passes, each with its own `_system.css`. None is a current rule source.

## Before citing a file here as authority

Check its header. A retired spec carries a `SUPERSEDED` banner naming what replaced it and,
where the file died unevenly, which parts are still live. If you are adding a spec that
retires an existing one, put that banner on the old file in the same PR — recording the
supersession only in the new document leaves the old one reading as canon to anyone who
greps this directory and opens it directly.

That failure is not hypothetical: an agent cited a retired rule from `EDITORIAL-PASS-SPEC.md`
to justify a `/jobs` change in 2026-08-15 and shipped a rendering bug (#205).
