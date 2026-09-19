# Design — AppOrbit

This is the source design contract for the AppOrbit public ranking website. It
translates the supplied AppOrbit product designs into a dense, factual data
product: clear at first glance and efficient during analysis.

## Product character

- Modern-minimal, open, and data-first, with a cool white canvas and a focused
  cobalt accent.
- Polished product surfaces without losing analytical density.
- UI copy describes what the visitor can see or do. It must not expose
  implementation decisions, collector internals, or design rationale.
- Complete ranking facts, provenance, explicit empty states, and honest data
  limitations take priority over visual symmetry.

## Page families

- `Charts` and `Trending`: **Data Index**. A short editorial introduction leads
  directly into filters, rankings, movement, and supporting metadata.
- App detail: **Stat-Led**. Identity and verified metadata lead into historical
  ranks, market coverage, and factual insights.
- `Data`: **Dataset Explorer**. Direct GitHub file and directory links lead into
  live coverage, catalog composition, and update records.
- `About`: **Long Document**. A narrower reading measure and quiet rules make
  technical material easy to scan.

All routes share an N1b full-width, always-solid, non-sticky navigation and an
Ft2 single-line footer. The footer may soft-wrap on narrow screens.

## Colour

Use the named tokens in `tokens.css`; never introduce page-local colour literals.

- Canvas: cool off-white `--color-paper`.
- Raised surfaces: near-white `--color-paper-raised`.
- Primary ink: deep navy `--color-ink`; supporting copy uses
  `--color-ink-soft` and `--color-muted`.
- Primary brand actions and current navigation use `--color-accent`; high
  emphasis chart calls to action may use deep navy.
- Mint, peach, lavender, sky, and rose support charts, the semantic orbit, and
  compact status surfaces. Cobalt remains the dominant accent.
- Green, red, and ochre are reserved for supported, falling/error, and partial
  states. Direction is also written with an arrow or label so colour is never
  the only signal.

## Typography

- Geometric display: **Manrope 600–800**, used for page titles, section titles,
  and large numeric facts.
- UI and body: **Inter 400–600**.
- Dense data surfaces use a 14 px body baseline with 11–12 px labels and table
  headers. Type becomes larger only when it establishes page or section hierarchy.
- No third font family. IDs and timestamps use Inter with tabular numerals.
- Headlines are sentence case, tightly tracked, and compact. Interface labels
  remain small and direct.
- Long prose stays within 58–68 characters per line.

## Geometry and spacing

- Content width: 1504 px (`--page-max`).
- Responsive page gutter: 16–40 px.
- The outer editorial rhythm is 48 px. Dense filters and tables use the 4 px
  token scale inside their surfaces.
- Cards use a 1 px cool hairline, 14 px radius, and a very soft navy shadow.
  Inputs and rectangular actions use 8 px radius; badges and segmented states
  may use pill geometry.

## Components

### Navigation

The navigation spans the page with a compact wordmark, centred route group,
prominent GitHub action, and responsive menu button. It is not fixed or sticky.
No search, account control, or unavailable route is shown.

### Buttons and controls

- Primary: cobalt or deep navy fill with light text.
- Secondary: raised paper with a cool hairline.
- Desktop control height is 40 px to preserve analytical density; coarse pointers
  receive a 44 px target.
- Every interactive element has a visible focus ring, disabled treatment, and
  pressed feedback. Loading, success, and error states reserve their dimensions.

### Data surfaces

- Tables use a softly tinted header, tabular numbers, strong app identity, and
  hairline row separation.
- Ranking tables expose all useful fields available in the public catalog,
  including categories, price, rating counts, install ranges, release and
  update dates, movement, and store link. The app's developer is shown directly
  beneath its name for quick scanning. Previous rank is represented by Change;
  internal app IDs, market labels, and repeated per-row metadata timestamps are
  not primary table fields. Metadata observation time appears once above the
  table. Visual simplicity must never remove product data; wide tables scroll
  horizontally when necessary.
- At wide breakpoints the primary ranking table and insight rail follow the
  supplied 8/4 composition. The table remains horizontally scrollable and keeps
  every useful real field rather than being reduced to fit the visual reference.
- Rank movement always supports `up`, `down`, `new`, and `neutral` states.
- A requested market with no data remains selected and receives a clear empty
  state; the interface never silently substitutes another market.
- Charts use a cobalt line and a pale sky area. They are generated from data and
  are not stored as image assets.
- Metadata and provenance remain available without dominating the initial scan.

### Cards and stats

Cards are white, softly elevated, and bounded by a cool hairline. Large numbers
use the display face at bold weight. Related metrics share a surface or a
rule-led group where practical.

### Decoration

Split heroes use one semantic CSS data-orbit visual derived from the supplied
designs. It explains stores, markets, or movement and never replaces data.
Filters, rankings, metadata, and GitHub data access remain primary.

### Footer

The footer is a quiet single-line rule with the product name, public GitHub
repository, and a deliberately low-emphasis UTC/client-local time switch.

## Motion

- Motion-cut by default. State changes use 120–220 ms colour, opacity, or 1 px
  pressed translations.
- No page-reveal sequences, looping decoration, parallax, or gratuitous chart
  drawing animation.
- Reduced-motion removes spatial transitions while preserving state feedback.

## Responsive behaviour

- The hierarchy is preserved as the layout collapses; content is not merely
  squeezed.
- Split heroes and two-column data areas become one column.
- Tables become labelled records on small screens so facts stay readable.
- Navigation, controls, and rank states retain touch-safe targets and visible
  labels.

## Shared requirements

Every page must retain:

- AppOrbit wordmark and orbit mark.
- English interface copy.
- Consistent navigation, filters, tables, empty states, and provenance details.
- UTC as the source time, with a discreet footer control for client-local time.
- A link to `https://github.com/ivershuo/apporbit`.
- No invented metrics, inferred rankings presented as facts, or silent date or
  market substitution.

## Exports

The complete browser-ready token source is [`tokens.css`](./tokens.css). These
translations are provided for a future framework migration; the current site
does not load Tailwind or shadcn.

### Tailwind v4 `@theme`

```css
@theme {
  --color-paper: oklch(98.2% 0.009 250);
  --color-paper-raised: oklch(99.7% 0.003 250);
  --color-paper-muted: oklch(96.3% 0.014 250);
  --color-ink: oklch(19% 0.06 258);
  --color-ink-soft: oklch(31% 0.05 258);
  --color-muted: oklch(49% 0.042 258);
  --color-border: oklch(89.5% 0.02 250);
  --color-accent: oklch(57% 0.22 258);
  --color-focus: oklch(57% 0.22 258);
  --color-mint: oklch(88% 0.075 165);
  --color-sky: oklch(86% 0.09 245);
  --color-lavender: oklch(89% 0.065 292);
  --font-display: "Manrope", "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-body: "Inter", ui-sans-serif, system-ui, sans-serif;
  --spacing-md: 1rem;
  --spacing-lg: 1.5rem;
  --spacing-section: 3rem;
  --text-label: 0.6875rem;
  --text-body: 0.875rem;
  --radius-control: 0.5rem;
  --radius-card: 0.875rem;
  --radius-pill: 999px;
}
```

### DTCG `tokens.json`

```json
{
  "$schema": "https://design-tokens.github.io/community-group/format/",
  "color": {
    "paper": { "$value": "oklch(98.2% 0.009 250)", "$type": "color" },
    "paperRaised": { "$value": "oklch(99.7% 0.003 250)", "$type": "color" },
    "ink": { "$value": "oklch(19% 0.06 258)", "$type": "color" },
    "inkSoft": { "$value": "oklch(31% 0.05 258)", "$type": "color" },
    "muted": { "$value": "oklch(49% 0.042 258)", "$type": "color" },
    "border": { "$value": "oklch(89.5% 0.02 250)", "$type": "color" },
    "accent": { "$value": "oklch(57% 0.22 258)", "$type": "color" },
    "focus": { "$value": "oklch(57% 0.22 258)", "$type": "color" },
    "success": { "$value": "oklch(52% 0.17 151)", "$type": "color" },
    "error": { "$value": "oklch(58% 0.21 28)", "$type": "color" }
  },
  "font": {
    "display": { "$value": "Manrope, Inter, ui-sans-serif, system-ui, sans-serif", "$type": "fontFamily" },
    "body": { "$value": "Inter, ui-sans-serif, system-ui, sans-serif", "$type": "fontFamily" }
  },
  "space": {
    "md": { "$value": "1rem", "$type": "dimension" },
    "lg": { "$value": "1.5rem", "$type": "dimension" },
    "section": { "$value": "3rem", "$type": "dimension" }
  },
  "radius": {
    "control": { "$value": "0.5rem", "$type": "dimension" },
    "card": { "$value": "0.875rem", "$type": "dimension" }
  }
}
```

### shadcn/ui CSS variables

```css
:root {
  --background: 98.2% 0.009 250;
  --foreground: 19% 0.06 258;
  --card: 99.7% 0.003 250;
  --card-foreground: 19% 0.06 258;
  --primary: 57% 0.22 258;
  --primary-foreground: 99.4% 0.003 250;
  --secondary: 96.3% 0.014 250;
  --secondary-foreground: 31% 0.05 258;
  --muted: 96.3% 0.014 250;
  --muted-foreground: 49% 0.042 258;
  --border: 89.5% 0.02 250;
  --input: 80.5% 0.035 250;
  --ring: 57% 0.22 258;
  --radius: 0.875rem;
}
```
