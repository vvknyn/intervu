# Attention & Emphasis — the house system

Attention is allocated, never decorated. Five channels, each with one job:

1. **Ink weight/size (typography)** — what to READ first. Titles over meta. Never used for actions.
2. **Contrast inversion (solid ink block)** — THE primary action of a view (Search, Apply, Follow). Exactly one inverted block per view. Secondary actions = 1px outline. Tertiary = underlined text.
3. **Klein Blue accent** — interactive identity: links, active tab, focus ring. Never decoration, never status.
4. **Semantic color (green/amber/red)** — status only, and exceptions only: the default state is unmarked. Never used for actions.
5. **Position + isolation** — the primary action sits with the object it acts on, surrounded by space. Whitespace is the cheapest highlighter.

Elevation (shadows) is not an attention channel. A shadow means "this floats above the page," so it is reserved exclusively for overlays — dialogs, sheets, tooltips, selects, dropdown menus, popovers, the search dropdown — which cast exactly one standard shadow (the `--shadow-overlay` token). Every in-flow surface, including job rows, is flat: separation is a 1px border plus whitespace, and the hover affordance is border-darkening, never a lift.
