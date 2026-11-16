# Design

A service-manual look: warm paper, dark ink, an exploded drawing in the middle. Light theme, chosen from the use scene (a bench in daylight, eyes moving between a real object and the screen).

## Colour

Tokens live at the top of `src/styles.css`.

| Token | Value | Use |
| --- | --- | --- |
| `--paper` | `oklch(96.6% 0.006 85)` | Page ground |
| `--panel` | `oklch(98.8% 0.004 85)` | Side panels, top bar, controls |
| `--stage` | `oklch(94.4% 0.008 85)` | Behind the 3D model |
| `--ink` | `oklch(22% 0.012 255)` | Text, primary button, edges of parts |
| `--ink-2`, `--ink-3` | 38%, 46% lightness | Secondary and tertiary text (both pass 4.5:1 on paper) |
| `--rule`, `--rule-2` | 88.5%, 79% lightness | Hairlines and control borders |
| `--select` | `oklch(78% 0.16 78)` | Selection only: selected part, its label, its row |
| `--select-soft` | `oklch(93.5% 0.055 88)` | Selected rows, safety and setup notes |

Connection kinds, used for wires, dots and legends:

| Kind | Colour |
| --- | --- |
| Power | `#c4421c` |
| Ground | `#3a3f45` |
| Signal | `#2a5fb0` |
| RF | `#12827a` |
| Mechanical | `#8f8a7f` |

Parts carry their own realistic colours from the teardown data.

## Type

- **IBM Plex Sans** 400 / 500 / 600 for interface text. Base size 14 px, 13 px for secondary text, 12 px minimum.
- **IBM Plex Mono** for data only: reference designators, voltages, currents, power, dimensions, part numbers, file extensions, commands.
- One display size, on the start screen heading. Panel headings are 15 to 18 px semibold.

## Layout

- Top bar, then three columns: agent or parts list (21 rem), work area (flexible), inspector (20 rem).
- The work area has eleven tabs: exploded view, design, simulator, architecture, bare board, fit and mould, parameters, power tree, bill of materials, firmware, guide.
- Below 1180 px the inspector moves under the work area. Below 820 px everything stacks and the page scrolls.
- Elevation is declared once: panels use hairlines, only the export menu and the floating part label cast a shadow.

- The left column is the agent: a chat thread with the plan questions, progress and check results, and a box to ask for changes. A switch at the top swaps it for the parts list.
- The top bar shows the three stages: Brainstorm, Design, Make.
- 3D views sit on a dark studio stage (`oklch(19% 0.012 255)`) so materials and shadows read; the rest of the interface stays on paper.

## Components

- **Buttons**: 32 px high, 6 px radius, hairline border. Primary is solid ink.
- **Chips**: pill toggles with `aria-pressed`, used for wire kinds and view options.
- **Confidence mark**: 12 px disc, full / half / empty, always with a text label or a title.
- **Labels in the 3D view**: wire values in mono on a paper plate with a kind-coloured dot; the selected part's name on amber; hover name on ink.

## Motion

One authored moment: the model explodes when a teardown opens (1.3 s, exponential ease-out). Dots travel along wires in the direction of flow. Hover states change background only, 120 ms. All of it stops under `prefers-reduced-motion`.

Second authored moment: the live build. Agent cursors (an arrow, a pill name tag, a click ring) move over the model, and new parts grow in with a 45 ms stagger. The cursor colours are for agents only and are not used elsewhere. Under `prefers-reduced-motion` parts appear at once and the click ring is hidden.

## Don't

- No gradients on text, glass panels, side-stripe borders or decorative grids.
- No colour-only meaning for confidence.
- No monospace outside data.
