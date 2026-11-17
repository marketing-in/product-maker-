---
name: teardown-lab
description: The owner's brief for Teardown Lab, collected from every request so far. Read this before changing the app, adding a feature, choosing a reference repo, or spending API tokens. Covers what the product must do, which outside repos to use and how, the rules the owner set, and how to verify work.
---

# Teardown Lab: the owner's brief

This file is the standing record of what the owner has asked for. Add to it whenever the owner gives a new requirement, repo or rule. Keep the owner's intent in plain words; do not paste secrets or key values here.

## What the product is

A tool where you say what hardware you want ("I need a robot") or show a product you have, and an agent takes it from idea to buildable design:

1. **Brainstorm**: the agent says back what it understood, asks a few questions with ready answers, and writes a plan (requirements, blocks, parts, risks).
2. **Design**: it builds the full model (housing, boards, components, wiring, power, controls) and checks it.
3. **Make**: cost and the files to build it.

The owner's reference for the experience is Flux (flux.ai): agent chat on the left, workspace on the right, a realistic 3D view of the board in its enclosure. Build the same *kind* of tool with our own design. Do not copy Flux's branding, artwork or code.

## What the owner asked for, in order

| # | Request | Where it lives |
|---|---|---|
| 1 | Make the API work | `server/index.mjs`. Needs `ANTHROPIC_API_KEY`; user-scoped keys (`sk-ant-usr-…`) also need `ANTHROPIC_WORKSPACE_ID`. Fable 5.2 rejects forced `tool_choice`, so it is `auto`. `max_tokens` is 64000 because thinking counts toward it. |
| 2 | Reverse engineer blinkproof.io with rea | Separate project at `/Users/m/Downloads/blinkproof-re/` (`FINDINGS.md`, `scripts/capture.sh`). Read-only analysis; never copy their code or drawings. |
| 3 | Full analysis: bare board, 3D modelling, mould design and fit, Gerber files, realistic Blender prototype, parameter simulation, board-level architecture, clearer use, possibilities | Tabs: Bare board, Fit and mould, Parameters, Architecture, Guide. `src/lib/board.ts`, `fit.ts`, `simulate.ts`, `exportGerber.ts`, `exportBlender.ts`. |
| 4 | Use Kitspace for PCB | Gerbers are rendered and checked with `pcb-stackup` (what kitspace.org uses) at `/api/board-render`. Export includes `kitspace.yaml` and `1-click-bom.tsv`. |
| 5 | Use KiCad | `src/lib/exportPcbProject.ts` writes a native `.kicad_pcb` with footprints, pads and nets. |
| 6 | 3D view of the board; a simulator where clicking the product's button makes the action happen; more detailed 3D; redesign where parts sit; redesign the mould; place the board and see it | Bare board → 3D. Simulator tab (`src/lib/behaviour.ts`). Design tab (`src/lib/edit.ts`): drag or type positions and sizes, resize housing and walls, live fit check, undo. |
| 7 | A simple description should be enough to make a product | The prompt tells Claude to design products that do not exist yet and to describe every control. |
| 8 | If it is a sound machine, make sound; change the UI to suit | `src/lib/sound.ts`: generated music, white noise, rain, ocean, beep, motor hum. The simulator shows a sound panel with a live meter when the product makes sound. |
| 9 | A Flux-like agent tool: ask for a robot, it runs the process and gives the data it needs; rebuild the site around that | `src/components/Agent.tsx`, `Make.tsx` (Plan, Make), `/api/brief`, `src/lib/validate.ts`. Stage bar: Brainstorm, Design, Make. |
| 10 | 3D view like the Flux screenshot: realistic board in its enclosure, dark stage, labels on the board, view cube | `src/components/Viewer3D.tsx`: studio environment lighting, soft shadows, eased edges, physical materials, printed board face (pads, outlines, reference labels), Top / Front / Side / 3D buttons. |
| 11 | Once a generation completes, store all of its data. Do not spend the tokens again | `server/store.mjs`: every API result is saved under `data/generations/` keyed by the exact request and reused; whole projects are saved under `data/projects/` and listed on the start page. |
| 12 | Use img2threejs to design the 3D | Its method (build an object from several procedural shapes, not one box) is applied to parts through `shapes` in the data model. The skill itself needs Python 3.10+; see below. |
| 13 | Keep everything the owner gives as a skill in a markdown file | This file. |
| 14 | If the user uploads a Gerber file, make the mould for it; understand what the board is using the API; also accept KiCad files; use the repos | Start page → "Make a housing for my board". `server/boardImport.mjs` reads Gerber sets (tracespace parser, as Kitspace uses) and `.kicad_pcb`. `/api/board-import`, then `/api/analyze` in board mode designs the housing. |
| 15 | Use a swarm to build, and show the build during the wait | `server/swarm.mjs` + `/api/build`: architect, parallel builders, integrator, streamed as events. The 3D view fills in as each agent finishes (`live` in `src/App.tsx`). A reload rejoins the running build (`localStorage` key `teardown-lab:building`). |
| 16 | The swarm should look like the Chrome-extension effect where lots of cursors arrive and build the page | Agent cursors in the live build: `AgentCursor` and the cursor loop in `src/components/Viewer3D.tsx`, `.cur` styles, cursors derived from the zones in `src/App.tsx`. New parts pop in with a stagger. Our own cursor design; no other product's artwork. |
| 17 | In the simulator, make the product do what it is: if it moves, make it movable; if it is a camera, make the camera work | `src/lib/abilities.ts` detects drive (wheels + motor), spinners (fans, propellers) and cameras. `Simulator.tsx`: Drive panel (D-pad, arrow keys, W A S D), drive loop, `CameraView` (test pattern or the user's webcam, local only). `Viewer3D` takes a `motion` ref: moves the product over a floor grid and turns wheels. Add new functions the same way: detect in `abilities.ts`, panel in `Simulator.tsx`. |
| 18 | The board must show its copper lines | `src/lib/route.ts`: a grid autorouter (two layers, 45 degree steps, vias, power first). Traces are drawn in the Bare board layout, on the 3D board face, and written to the Gerber and KiCad exports. Always say it is an autorouted first pass, not the original routing and not rule-checked. |
| 19 | Push to git; make the Vercel deployment work | Remote `origin` is `github.com/marketing-in/product-maker-` (linked to a Lovable project). `vercel.json` + `api/index.mjs` run the Express app as a Vercel function. Hosted rules in `server/index.mjs`: paid endpoints need `APP_PASSWORD` and refuse when it is unset; `/api/projects` is off and `src/lib/api.ts` keeps projects in the browser. |
| 20 | Add the Vercel settings so Claude works there | Done with the Vercel CLI (this Mac is logged in as `marketingkeyleer-sys`, project `product-maker-`, https://product-maker-pink.vercel.app). `APP_PASSWORD` was generated and set; the owner has the code. Never write it into the repo. |
| 21 | Full UI test, fix what it finds; save every generation in the repo when pushing | `tests/ui-test.mjs` (`npm run test:ui`, free). `data/` is committed; `npm run push` (`scripts/push.sh`) scans and pushes it; Vercel bundles `data/generations` (`includeFiles` in `vercel.json`) and `server/store.mjs` reads it. |
| 22 | Fit and mould should use 3D too | `FitMould.tsx`: 3D view coloured by fit status with a legend, Open the mould along each part's pull direction, click to select. |
| 23 | One zip with every download; a full, visual PDF of the product with diagrams and flows | `src/lib/exportAll.ts` (compressed zip via `zipCompressed`), `src/lib/report.ts` (jsPDF, vector diagrams: block diagram, power flow as an indented tree, control flow, assembly flow, board with copper, cost chart), `src/lib/snapshot.ts` (off-screen 3D pictures). Export menu and Make tab. Check the PDF by rendering its pages (a small PDFKit Swift script works on this Mac). |
| 24 | `npm install --global rea-agents` does not install; fix it | Fixed inside the project instead (see the rea row below): `npm run setup:rea`. |
| 25 | Generate firmware for the item | Firmware tab → Write the firmware. `/api/firmware-gen` (`FIRMWARE_TOOL`, `FIRMWARE_GEN_PROMPT`), `src/components/WriteFirmware.tsx`, `src/lib/firmware.ts` (platformio.ini, README). Stored on `td.firmware`; in the everything zip and the PDF report. |
| 26 | Use a lower-cost model like Opus 5.5 for firmware | `FIRMWARE_MODEL` (default `claude-opus-5-5`). Measured on the robot: $0.29 and 112 s, against $0.73 and 155 s on Fable 5.2. Opus 5.5 rejects forced tool_choice and cannot turn thinking off; effort is set to medium. |
| 27 | A PDF about the application, visual, with flows and diagrams, using the skills given | `docs/teardown-lab-overview.pdf`, built from `docs/overview/overview.html` (DESIGN.md tokens, SVG diagrams, real screenshots) with headless Chrome; `npm run docs:overview`. Print with `transferMode: 'ReturnAsStream'`: one large message stalls. |
| 28 | Firmware code not visible: colours | The global inline `code` style was painting each line light inside the dark block. `pre.code code` now resets it; the UI test checks every code block. |
| 29 | In the overview PDF, use the camera, not the robot car | The overview shows the saved camera teardown (`p-mwj96jxa-3agl0e`) on every page: `docs/overview/capture.mjs` opens it, hides other saved projects in the start shot, and downloads its report and zip for page 8. The swarm page uses a drawn, product-free illustration. Keep the robot out of the overview. |

## Outside repos the owner named, and how each is used

| Repo | Use it for | State here |
|---|---|---|
| [morluto/rea](https://github.com/morluto/rea) | Reverse engineering firmware, binaries and web bundles. Firmware tab; the blinkproof study; Claude Code's rea tools. | Installed inside the project: `npm run setup:rea` puts rea-agents 6.9.0 and Node 24.22.3 in `tools/rea` (git-ignored, Vercel-ignored); `bin/rea` runs it; `server/rea.mjs` and `.mcp.json` use it. A global install fails here (EACCES on `/usr/local`, and the system Node 24.15 is too old). Changing the user's global npm prefix or shell profile was refused as too broad; leave that to the owner. |
| [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | Interface design guidance. | Installed at `.claude/skills/impeccable`. Follow `PRODUCT.md` and `DESIGN.md`. |
| [kitspace](https://github.com/kitspace) | PCB rendering and sharing: `pcb-stackup`, 1-click BOM, `kitspace.yaml`. | In use. |
| [KiCad](https://github.com/KiCad) | Board redesign. | `.kicad_pcb` export. KiCad is not installed on this Mac, so the file has never been opened in KiCad. Say so until it has. |
| [blender](https://github.com/blender) | Realistic prototype renders. | Scene script export with materials, lights, camera. Blender is not installed on this Mac, so the script has only passed a Python syntax check. Say so until it has run. |
| [img2threejs](https://github.com/img2threejs/img2threejs) | Detailed procedural 3D from a reference image. | An agent skill, not a library. Needs Python ≥ 3.10 (this Mac has 3.9.6) and installs into the global `~/.claude`. Install with `npx --yes img2threejs@latest install --host claude` once Python is updated, and only with the owner's go-ahead since it changes global settings. Until then, apply its approach: several shapes per part. |
| flux.ai | The experience to match: chat-led flow, realistic 3D. | Reference only. |
| blinkproof.io | A competitor studied for ideas (pre-made demos, per-part exploded drawings). | Reference only. |

## Rules the owner has set

- **Do not waste tokens.** A finished generation is stored and reused. Before calling the API, check the cache. A full design costs roughly $1.20 to $1.50 and takes five to eight minutes on `claude-fable-5-2` at medium effort (`CLAUDE_EFFORT`); a plan is cheap. Ask before running several full designs.
- **Derive, do not regenerate.** New views and exports should be computed from the stored teardown wherever possible, so they cost nothing.
- **Make it clear to use.** Plain words, a guide, obvious next steps. The owner writes informally and is not a specialist: explain results without jargon.
- **Realistic and detailed 3D** is a priority.
- **Everything interactive**: click a button and something happens; drag a part and the checks update.

## Rules that come with the work

- Be honest about limits. Board copper is an autorouted first pass with typical pads, not the original routing. Fit, mould and thermal numbers are estimates. Never present an estimate as a measurement.
- State what was not tested (KiCad and Blender files, anything not opened in a real program).
- A hosted copy must never expose the owner's API key to the public: keep the `APP_PASSWORD` gate on every endpoint that calls Claude. Vercel needs `ANTHROPIC_API_KEY`, `ANTHROPIC_WORKSPACE_ID` (user-scoped keys) and `APP_PASSWORD` set by the owner in its settings; never commit them.
- Never put the API key or workspace ID in code, logs, docs or this file. They live only in `.env`, which is git-ignored.
- Do not copy another product's code, artwork or brand.

## Lessons from this build

- A full design was once lost because the test closed the browser before the answer arrived and nothing was stored. Results are now saved on the server before they are sent. Never run a generation without the store in place.
- The fit check must not fail a design for wheels, feet, knobs or aerials being outside the housing.
- The thermal estimate is rough. Motors turn most of their input into motion; a driver's loss is capped at a quarter of its input when the figures do not add up.
- Gerber files do not name parts. Say that footprints are inferred from pads unless a placement file was uploaded.

- Swarm builds are faster but dearer: about 4.5 min and $2.50 against 7.5 min and $1.85 for one pass, on the robot. Do not re-run one to test the page: replay a stored build by stubbing `fetch('/api/build')` with events rebuilt from `data/generations/swarm-*.json`.
- A battery in its holder is not a clash. An estimate above 200 °C means the power figures do not add up, and is reported that way.

- Run `npm run test:ui` after any change to the interface. It found: the chat scrolling the whole page on narrow screens, long answer buttons overflowing, plastic-moulding advice on wood and sheet parts, and opening a project re-saving it. Keep a check for each.
- Opening a saved project must never write it. Only a real change saves.

## How to verify changes

- `npx tsc --noEmit` and `npm run build`.
- Open `http://localhost:5173/#sample:<tab>` (`view`, `design`, `run`, `arch`, `board`, `fit`, `sim`, `power`, `bom`, `firmware`, `make`, `guide`). The sample needs no API key.
- Drive the real app in headless Chrome and read screenshots before claiming a view works. Headless only redraws the 3D scene when a screenshot is taken.
- Editing `server/*.mjs` restarts the API (`node --watch`) and editing `src/*` reloads the page. Do not edit either while a long generation is in flight.

## Map

- `server/`: `index.mjs` (API), `prompt.mjs`, `schema.mjs`, `sanitize.mjs`, `store.mjs`, `boardImport.mjs`, `rea.mjs`.
- `src/lib/types.ts`: the one data model everything derives from.
- `src/lib/`: `geometry`, `board`, `fit`, `simulate`, `behaviour`, `sound`, `edit`, `validate`, `power`, and the `export*` writers.
- `src/components/`: `Agent`, `Viewer3D`, `Designer`, `Simulator`, `BareBoard`, `Architecture`, `FitMould`, `Simulation`, `Make`, `Guide`, `PowerTree`, `BomTable`, `Firmware`, `Inspector`, `PartList`, `Intake`.
- `README.md`, `PRODUCT.md`, `DESIGN.md`: keep them in step with the code.
