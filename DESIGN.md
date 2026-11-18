---
name: Teardown Lab
description: A dark graphite studio where the exploded 3D model is the workspace and every number is data.
colors:
  stage: "oklch(15.5% 0.012 256)"
  sunk: "oklch(16.5% 0.012 256)"
  paper: "oklch(18% 0.012 256)"
  panel: "oklch(20.5% 0.013 256)"
  tray: "oklch(22.5% 0.014 256)"
  raised: "oklch(24.5% 0.014 256)"
  hover: "oklch(27.5% 0.015 256)"
  rule: "oklch(28.5% 0.012 256)"
  rule-2: "oklch(36% 0.013 256)"
  ink: "oklch(94% 0.006 85)"
  ink-2: "oklch(79% 0.008 85)"
  ink-3: "oklch(66% 0.01 85)"
  on-light: "oklch(19% 0.012 256)"
  select: "oklch(80% 0.155 78)"
  select-soft: "oklch(31% 0.06 78)"
  warn: "oklch(76% 0.12 35)"
  warn-soft: "oklch(28% 0.05 35)"
  warn-rule: "oklch(46% 0.09 35)"
  danger: "oklch(72% 0.16 28)"
  danger-soft: "oklch(27% 0.07 28)"
  danger-rule: "oklch(42% 0.11 28)"
  ok: "oklch(77% 0.13 158)"
  power-flow: "#e0603a"
  wire-power: "#c4421c"
  wire-ground: "#8b929b"
  wire-signal: "#2a5fb0"
  wire-rf: "#12827a"
  wire-mechanical: "#8f8a7f"
typography:
  display:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 1.2rem + 1.6vw, 2.5rem)"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    letterSpacing: "-0.01em"
  title-small:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
  body:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "'ss01'"
  body-small:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
  label:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: "0.005em"
  data:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    fontFeature: "'tnum'"
  data-label:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  label: "4px"
  control: "6px"
  tray: "8px"
  pill: "999px"
spacing:
  xs: "0.25rem"
  sm: "0.4rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
components:
  button:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 0.75rem"
    height: "2rem"
  button-hover:
    backgroundColor: "{colors.hover}"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-light}"
    rounded: "{rounded.control}"
    padding: "0 0.75rem"
    height: "2rem"
  button-primary-hover:
    backgroundColor: "oklch(99% 0.004 85)"
  icon-button:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.control}"
    size: "2rem"
  icon-button-hover:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.ink}"
  chip:
    textColor: "{colors.ink-3}"
    rounded: "{rounded.pill}"
    padding: "0 0.65rem"
    height: "1.75rem"
    typography: "{typography.body-small}"
  chip-pressed:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
  rail-button:
    textColor: "{colors.ink-3}"
    rounded: "{rounded.tray}"
    typography: "{typography.label}"
    padding: "0.5rem 0 0.42rem"
  rail-button-active:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.ink}"
  side-tab:
    textColor: "{colors.ink-3}"
    rounded: "{rounded.control}"
    height: "1.9rem"
  side-tab-active:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.ink}"
  input:
    backgroundColor: "{colors.sunk}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.55rem 0.7rem"
  number-field:
    backgroundColor: "{colors.sunk}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    typography: "{typography.data}"
    height: "2rem"
  floating-tray:
    backgroundColor: "{colors.tray}"
    rounded: "{rounded.tray}"
    padding: "0.4rem 0.5rem 0.45rem"
  card:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.tray}"
    padding: "0.85rem 1rem"
  card-selected:
    backgroundColor: "{colors.select-soft}"
  part-row-selected:
    backgroundColor: "{colors.select-soft}"
  part-label:
    backgroundColor: "{colors.select}"
    textColor: "{colors.on-light}"
    rounded: "{rounded.label}"
    padding: "0.15rem 0.5rem"
  hover-label:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-light}"
    rounded: "{rounded.label}"
    padding: "0.15rem 0.5rem"
  wire-label:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.label}"
    typography: "{typography.data-label}"
    padding: "0.05rem 0.4rem"
  tag-check:
    backgroundColor: "{colors.warn-soft}"
    textColor: "{colors.warn}"
    rounded: "{rounded.pill}"
    padding: "0.05rem 0.45rem"
  tag-fail:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
    rounded: "{rounded.pill}"
    padding: "0.05rem 0.45rem"
  stage-step-current:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-light}"
    rounded: "{rounded.pill}"
    height: "1.9rem"
---

# Design System: Teardown Lab

## Overview

**Creative North Star: "The Graphite Studio"**

Teardown Lab is a dark professional tool in the family of Flux and Figma. The exploded 3D model is the workspace: the stage runs edge to edge between a narrow icon rail on the left and a slim panel on the right, and every piece of chrome is a lifted shade of the same cool blue-black graphite. The interface recedes so the product, its parts and its wiring carry the colour.

The system is dense and quiet. Text is warm off-white on graphite, panels are separated by hairlines rather than boxes, and the only controls that sit on top of the model live in one floating tray docked bottom-centre. Hue is rationed: amber says "selected", the wire-kind colours say what a connection carries, and coral, red and green report check results. Everything else is graphite and ink.

Motion is short and answers a change of state: a view rises 4 px as it arrives, trays slide in from their own edge, presses give way to 97%. The one long motion is the model exploding when a teardown opens; under reduced motion it jumps straight to the end. Under reduced motion the interface transitions, the flowing wire dots, auto-rotate and the live-build grow-in all drop to their end state.

**Key Characteristics:**
- A graphite ladder of seven surfaces, the 3D stage the deepest and floating trays and hovers the most raised.
- The 3D model fills the space between the rail and the right panel; no boxed preview.
- One floating tool tray per 3D view, the signature move.
- Geist Sans for the interface, Geist Mono with tabular figures for every measured value.
- Amber is selection only; in the chrome the wire-kind and check-state colours are the only other hues.
- One soft shadow, for things that float.

## Colors

A cool blue-black graphite ladder (hue 256), warm off-white ink (hue 85), and a handful of meaning-bearing hues.

### Primary
- **Selection Amber** (`select`): the selected part in 3D (emissive and edge highlight, hard-coded in the viewer as `0xf0a400`), its floating name plate, the selected node in the power tree, architecture frame and bare-board part, and the border of a selected card. It means "selected" and nothing else.
- **Selected Wash** (`select-soft`): a dark amber-brown fill under selected rows, cards and power-tree nodes, and the text-selection highlight.

### Secondary
- **Wire kinds** (`wire-power`, `wire-ground`, `wire-signal`, `wire-rf`, `wire-mechanical`): one colour per connection kind, shared by the 3D wires, the travelling flow dots (the wire colour lifted 55% toward white), the kind dots on the toggle chips, the Details links, architecture edges and bare-board nets. Defined once in the viewer's `KIND_COLOR` map and imported everywhere else. Ground is a light slate (`#8b929b`) so it reads on graphite, the same grey in the 3D wires and the wire-label dots.
- **Power Flow Orange** (`power-flow`): the power-tree edges and the load bars. A brighter cousin of `wire-power`, used where power is drawn as a diagram rather than a wire.
- **Model data hues** (not tokens): parts keep their realistic colours from the teardown data; the Fit view paints parts by fit class, the bare board draws copper and pads in gold, and each live-build agent cursor has its own colour. These live on the model, never in the chrome, and each has a legend or a name tag.

### Tertiary
- **Check Coral** (`warn`, `warn-soft`, `warn-rule`): "Check" tags, tight-fit tags and safety notes. Always text on its soft fill inside its rule.
- **Fault Red** (`danger`, `danger-soft`, `danger-rule`): failures, errors, over-limit figures and chart limit lines.
- **Pass Green** (`ok`): pass tags, "fits" tags, a lamp that is on, a successful firmware run.

### Neutral
- **Stage Black** (`stage`): behind every 3D canvas, code blocks, meters and the page body. The deepest step.
- **Sunk Graphite** (`sunk`): inside text fields, number fields and firmware output; one step under the stage around it.
- **Paper Graphite** (`paper`): the work area behind non-3D views (tables, power tree, firmware), and the halo behind diagram labels.
- **Panel Graphite** (`panel`): top bar, view rail, parts tray, right panel, cards.
- **Tray Graphite** (`tray`): floating trays, the view cube and menus.
- **Raised Graphite** (`raised`): default buttons, row and rail hover, pressed chips, callouts, inline code.
- **Hover Graphite** (`hover`): button hover, the active rail view, the active side tab, the user's own chat bubble.
- **Hairline** (`rule`) and **Control Edge** (`rule-2`): `rule` divides regions and rows; `rule-2` outlines controls, chips, trays and inputs.
- **Ink** (`ink`), **Ink 2** (`ink-2`), **Ink 3** (`ink-3`): primary, secondary and tertiary text. Ink also fills the primary button, the current stage pill, the hover name plate and the focus ring.
- **On Light** (`on-light`): text on the ink and amber fills.

### Named Rules
**The Amber Means Selected Rule.** Amber marks the selected part, its label, its row, its node and its card, and nothing else. Focus rings are ink, warnings are coral, never amber.

**The Wire Kind Rule.** A connection's colour is its kind. Every view that draws a connection takes its colour from the one `KIND_COLOR` map, and every colour is repeated in words beside it (chip label, legend, table cell).

**The Graphite Ladder Rule.** Depth is a lightness step on the same hue, never a new colour: stage, sunk, paper, panel, tray, raised, hover, from deepest to most raised.

## Typography

**Display Font:** Geist Sans (with system-ui, sans-serif)
**Body Font:** Geist Sans (with system-ui, sans-serif)
**Label/Mono Font:** Geist Mono (with ui-monospace, monospace)

Both are self-hosted through `@fontsource`: Geist Sans at 400, 500 and 600, Geist Mono at 400 and 500. The body sets `font-feature-settings: 'ss01'`.

**Character:** A neutral engineering grotesque for the words and its own monospace for the numbers, so labels and measurements read as one family with two jobs.

### Hierarchy
- **Display** (600, `clamp(1.75rem, 1.2rem + 1.6vw, 2.5rem)`, 1.08, -0.025em): the start screen heading only.
- **Headline** (600, 1.125rem, 1.25, -0.01em): the selected part's name at the top of Details.
- **Title** (600, 1.0625rem, -0.01em): view headings (power tree loads, firmware, work tabs, the design panel).
- **Title Small** (600, 0.9375rem): the parts list heading, card and block titles, guide steps.
- **Body** (400, 0.875rem, 1.45): all interface text, chat, descriptions. Long text caps at 62 to 72ch.
- **Body Small** (400, 0.8125rem): secondary text, hints, table headers, chips, group headings in the parts list (600, `ink-2`).
- **Label** (500, 0.6875rem, 1.1, 0.005em): the short view names under rail icons.
- **Data** (Geist Mono 400, 0.8125rem, tabular figures): reference designators, voltages, currents, power, sizes, quantities, file extensions, percentages. The 3D wire labels set data at 0.6875rem.

### Named Rules
**The Numbers Are Data Rule.** Every measured or counted value (V, A, W, mm, U7, x2, 85%) is set in Geist Mono with tabular figures. Words around it stay in Geist Sans.

**The One Display Rule.** There is one display size and it lives on the start screen. Inside the workspace the largest text is the part name in Details.

## Layout

The app is a full-height grid: a 44 px top bar (`2.75rem`), then the bench. The top bar carries the mark and wordmark, the product name behind a hairline, the three-stage stepper (Brainstorm, Design, Make), the save state, Export and New project.

The bench is a column grid: a 64 px view rail (`4rem`), an optional 272 px parts tray (`17rem`) toggled from the rail's first button, the work area (`minmax(0, 1fr)`), and a 352 px right panel (`22rem`). While a project is still being planned there is no rail and the right panel widens to `24rem`.

- **The rail** lists views as an icon over a short name, grouped by job with hairline breaks: Model, Design, Operate; Blocks, Board, Fit; Power, Params, BOM, Code; Make, Guide. A Plan or Your file view is added on top when the project has a brief or an imported board.
- **The right panel** has Agent and Details tabs. On the Design and Simulator views a third tab, Edit or Operate, comes first and holds that view's controls.
- **The stage** fills the work area. On 3D views the view cube floats top-right (`0.75rem` in) and the floating tray docks bottom-centre (`0.75rem` up).
- **Views load lazily.** Switching is a React transition: the rail answers at once (the pending icon pulses), the old view stays until the new one is ready, and a first load shows a shimmering skeleton, not a spinner.

Spacing runs on a small rem set: `0.25rem`, `0.4rem` (the common gap inside trays and button groups), `0.75rem` (panel insets, stage offsets), `1rem` (panel padding) and `1.5rem` (view padding).

**Responsive.**
- At 1320 px and below the right panel narrows to `19.5rem`, the parts tray to `15rem`, and the floating tray stacks explode, toggles and wire kinds into one centred column.
- At 860 px and below the right panel moves under the work area (rows 1.45 : 1), the parts tray floats over the stage with the shadow, the product name hides and top-bar buttons collapse to icons.
- At 720 px and below the page scrolls: the rail becomes a sticky horizontal strip that fades at its right edge, the work area takes `72dvh`, the right panel stacks below, the floating tray spans the width with a sideways-scrolling wire-kind strip, and only the current stage stays in the stepper.

## Elevation & Depth

Depth is tonal first. Regions are flat graphite steps divided by 1 px hairlines; nothing at rest casts a shadow. One shadow exists, and it belongs to things that float over other content.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 16px 36px -14px oklch(0% 0 0 / 0.7), 0 2px 8px -2px oklch(0% 0 0 / 0.45)`): the floating tool tray, the design bar, the live-build note, the view cube, the export menu, and the parts tray when it floats over the stage below 860 px.

The agent cursors in the live build carry their own small drop shadow (`0 2px 4px oklch(0% 0 0 / 0.45)`) so they read over any part.

### Named Rules
**The Only Floaters Cast Rule.** A surface gets the Float shadow only when it sits on top of the model or another region. Panels, cards and rows separate with hairlines and graphite steps.

## Shapes

Gently rounded and consistent. Controls (buttons, inputs, side tabs, callouts) use a 6 px radius; trays, cards, menus, the view cube, rail buttons and embedded 3D frames use 8 px; 3D name plates, wire labels and inline chips use 4 px; toggle chips, tags and the stage stepper are full pills. The user's chat bubble is the one asymmetric shape (12 px with a 3 px corner toward the panel edge). Kind dots and confidence marks are circles. Borders are always 1 px.

## Components

### Buttons
Quiet graphite slabs; the primary is the only solid light shape in the chrome.
- **Shape:** gently rounded (6px), 32 px high (`2rem`), 1 px `rule-2` edge, weight 500.
- **Default:** `raised` fill, `ink` text. Hover lifts to `hover` with an `ink-3` edge; press returns to `panel`.
- **Primary:** solid `ink` with `on-light` text; hover brightens toward white, press drops to `ink-2`.
- **Icon button:** 32 px square, transparent, `ink-2` icon; hover fills `hover`.
- **Press:** every button, chip, rail button and view-cube button scales to 0.97 on press; colour transitions run 120 ms on the ease-out curve.
- **Disabled:** `ink-3` text on `panel` with a `rule` edge.

### Chips
- **Style:** full pill, 28 px high, transparent with a `rule-2` edge and `ink-3` text at 0.8125rem.
- **State:** `aria-pressed` toggles. Pressed fills `raised`, text goes to `ink` at 500 and the edge lifts. Unpressed wire chips dim their kind dot to 35%.
- **Use:** wire kinds, the values and see-through toggles, board layers, plan answers and example prompts.

### Cards / Containers
- **Corner Style:** 8px.
- **Background:** `panel` on the `paper` work area; selected cards take `select-soft` with an amber edge.
- **Shadow Strategy:** none (see Elevation).
- **Border:** 1 px `rule`.
- **Internal Padding:** `0.85rem 1rem`.

### Inputs / Fields
- **Style:** `sunk` fill, 1 px `rule-2` edge, 6px radius; placeholder in `ink-3`.
- **Focus:** the edge turns `ink`, with no offset. Elsewhere focus is a 2 px `ink` outline offset 2 px.
- **Number fields:** 32 px high, set in Geist Mono with tabular figures (position and size in the design editor).
- **Range:** a 4 px track filled `ink-2` up to the value over `rule-2`, a 14 px ink thumb ringed in `stage`.

### Navigation
- **Top bar:** `panel`, 44 px, hairline below. The stage stepper shows numbered pills joined by short rules; the current stage is a solid ink pill.
- **View rail:** 64 px column on `panel`. Each view is an 18 px Lucide icon over an 11 px label in `ink-3`; hover fills `raised`, the active view sits on a `hover` pill (8px) in `ink`. Below 720 px it turns into a horizontal strip.
- **Side tabs:** equal-width tabs at the top of the right panel, 30 px high, icon plus word; the active tab fills `hover`.

### The Floating Tool Tray (signature)
The one place controls sit on top of the model. A `tray` slab, 8px radius, `rule-2` edge and the Float shadow, docked bottom-centre with a `0.75rem` margin. On the Model view row one holds Play, Explode with its slider and percentage, the values and see-through chips and Reset; row two, under a hairline, holds the wire-kind chips. The Design and Simulator views use the same tray shape for their bar, and the live build uses it for its status note. It slides up 8 px over 300 ms after an 80 ms delay.

### 3D Labels
- **Selected part:** name plate in `select` with `on-light` text, 600, 0.75rem, 4px radius.
- **Hover:** the same plate in `ink`.
- **Wire values:** Geist Mono 0.6875rem on 92% `panel` with a `rule-2` edge, led by a dot in the wire's kind colour.

### Confidence Mark
A 12 px circle, 1.5 px stroke in `currentColor`: full for observed, half (left half filled) for inferred, empty for assumed. Always carries its word, either visible or as a title and screen-reader text. The parts list repeats the key in a legend at its foot.

### Agent Panel
A chat thread on `panel`. The user's messages are right-aligned `hover` bubbles; the agent writes plain text with check results as coral, red or green tags beside a linked heading, and follow-up actions as chips. The ask box sits below a hairline.

## Do's and Don'ts

### Do:
- **Do** let the 3D stage fill the space between the rail and the right panel, on `stage` (oklch(15.5% 0.012 256)).
- **Do** take every surface from the graphite ladder and separate regions with 1 px `rule` hairlines.
- **Do** set every measured or counted value in Geist Mono with tabular figures.
- **Do** colour a connection by its kind from `KIND_COLOR` and name the kind in words beside it.
- **Do** mark every part and connection observed, inferred or assumed with the full, half or empty disc and its word.
- **Do** put on-model controls in the one floating tray, bottom-centre, with the Float shadow.
- **Do** keep interface motion at 300 ms or less and tied to a change of state; the model's 1.3 s explode is the one long motion. Honour `prefers-reduced-motion`.

### Don't:
- **Don't** use amber for anything but selection: not for focus, warnings, highlights or brand.
- **Don't** add hues to the chrome beyond selection, the wire kinds and the check states. Hues that encode data on the model (part colours, fit classes, board copper, agent cursors) stay on the model and are named in a legend.
- **Don't** box the 3D model in a card or frame it as a preview inside a page.
- **Don't** give resting panels, cards or rows a shadow.
- **Don't** set numbers in the sans face, or words in the mono face.
- **Don't** dress an estimate as a measurement: an inferred or assumed value keeps its confidence mark.
