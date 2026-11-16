# Teardown Lab

Say what you want to build, or add photos of a product you have. An agent plans it, then Claude names every part (mouldings, circuit boards, components, connectors, fasteners), lays them out as a 3D exploded model, and traces the wiring with the voltage, current and power on each path. Export the result to Blender, CAD (STEP), a bill of materials or JSON.

Built on two open-source projects:

- **[rea](https://github.com/morluto/rea)** handles the software side. rea reverse-engineers firmware images, flash dumps, binaries and apps, not photos, so Teardown Lab uses it in the Firmware tab: upload a file that came out of the product, rea inspects it locally, and Claude ties the findings back to the chips in the teardown. Teardown Lab also borrows rea's evidence discipline: every part is marked observed, inferred or assumed, with the evidence and the open questions.
- **[impeccable](https://github.com/pbakaus/impeccable)** guides the interface. Its skill is installed in `.claude/skills/impeccable`, with the project context in `PRODUCT.md` and `DESIGN.md`.

## How it works for the user

1. **Brainstorm.** Say what you want in a sentence: "I need a robot". The agent says back what it understood, asks a few questions with ready answers (kind, size, power, control, budget), and writes a plan: numbered requirements, functional blocks with real parts, risks and a cost range. Under a minute.
2. **Design.** Press "Build the design". The agent builds the whole model: housing, boards, components, wiring, power on each path and what each button does. Then it runs checks: electrical rules, connections, fit in the housing, clashes, temperature, battery, board layout. Several minutes, up to ten for a product with many parts.
3. **Make.** Cost by group and the files to build it: KiCad and Gerber, STEP, Blender, bill of materials.

### A team of agents builds a new product

A new product is not designed in one long pass. A swarm does it:

1. An **architect** agent sets the overall size and splits the product into three to six sub-assemblies (chassis, drive, power, controller…), each with a box to stay inside and a brief.
2. One **builder** agent per sub-assembly designs its parts. They all run at the same time.
3. An **integrator** agent wires the sub-assemblies to each other and describes the controls.

While they work, the 3D view shows the build, in the style of many people editing one page at once: every agent has its own named, coloured cursor that moves over the piece it is working on and clicks as it goes. A grey box marks where each sub-assembly will go; when its agent finishes, the cursor leaves and the real parts pop in one after another. A last cursor hops between the pieces while they are wired together. The agent panel lists each agent and how far it has got. If the page reloads or the tab closes, the build carries on at the server and the page rejoins it.

Measured once on "I need a robot": the swarm took about 4.5 minutes and cost about $2.50, against 7.5 minutes and $1.85 for a single pass. It produced more parts (55 against 41). Agents working apart can place parts that overlap; the checks list them and the Design tab fixes them. Taking apart a real product and housing a board still use one careful pass (`/api/analyze`).

### Start from a board you already have

Choose "Make a housing for my board" and upload either:

- a **Gerber set** (loose files or the .zip you would send to a board house). It is parsed with gerber-parser and gerber-plotter and drawn with pcb-stackup, the [tracespace](https://github.com/tracespace/tracespace) tools [Kitspace](https://github.com/kitspace) uses. The outline, pads and drill hits are measured. Gerbers do not name parts, so footprints are found by grouping pads; a placement CSV in the same upload names them.
- a **KiCad board** (`.kicad_pcb`, KiCad 5 to 9). The outline, every footprint with its reference and value, pads, mounting holes and nets are read directly.

The agent shows what it read. Then Claude works out what the board is from the data and a picture of it, and designs a two-piece housing round it: walls, clearance, screw bosses at the mounting holes, and an opening for each connector and switch. The Fit and mould tab then gives the mould notes, and the Design tab lets you adjust it.

### Nothing is generated twice

Every result from Claude is written to `data/generations/` the moment it arrives, keyed by the exact request. Asking for the same thing again returns the stored result at no cost, and a result is kept even if the browser closed while waiting. Whole projects (plan, answers, design, your edits, the chat, an uploaded board) are saved to `data/projects/` and listed on the start page. The `data/` folder is git-ignored; delete a file to forget it.

`CLAUDE_EFFORT` in `.env` sets how hard the model thinks on a full design (`low`, `medium`, `high`; default `medium`). Higher is slower and costs more.

The agent stays in the left panel. Ask for a change in words ("add a second battery"), or edit by hand in the Design tab. "Take apart a product I have" skips the questions and works from your photos and description instead.

## Run it

You need Node.js 22 or newer.

```bash
npm install
cp .env.example .env        # then put your Claude API key in .env
npm run dev                 # opens on http://localhost:5173
```

Without an API key the app still starts, and the built-in sample teardown works in full. Analysis of your own products needs the key.

For a single-process build:

```bash
npm run build
npm start                   # serves the app and API on http://127.0.0.1:8787
```

### Put it online (Vercel)

The repository is ready for Vercel: `vercel.json` builds the web app and runs the API (`server/`) as one function through `api/index.mjs`. In the Vercel project, under Settings → Environment Variables, add:

| Variable | Value |
| --- | --- |
| `ANTHROPIC_API_KEY` | Your Claude API key |
| `ANTHROPIC_WORKSPACE_ID` | Only for a user-scoped key (`sk-ant-usr-…`): the `wrkspc_…` ID |
| `APP_PASSWORD` | An access code you choose. **Required.** |

Then redeploy. Without `APP_PASSWORD` the agent stays off on a hosted copy, on purpose: a public address must not let strangers spend your credit. With it set, the site asks each visitor for the code once.

What is different when hosted:

- **Projects are saved in the visitor's browser**, not on the server, because Vercel has no lasting disk. They do not follow you to another browser or device.
- **The generation cache does not last.** It lives in temporary storage that Vercel clears, so a repeated request may be paid for again.
- **Requests are cut off at 300 seconds** (`maxDuration` in `vercel.json`; raise it to 800 on a Pro plan). The model effort defaults to `low` to fit. A large design can still time out, and a timed-out result is lost. Long designs are safer run on your own computer.
- **Uploads are limited to about 4.5 MB** by Vercel. Firmware inspection with rea is not available.

### Firmware stage (optional)

```bash
npm install --global rea-agents
```

Restart Teardown Lab afterwards. Container formats rea reads natively (uImage, FIT, ESP flash images and more) need nothing else. Region scans of raw firmware need Binwalk on Linux: set `REA_BINWALK_COMMAND` in `.env`.

## What you get

| View | What it shows |
| --- | --- |
| Exploded view | Every part as a 3D solid on a dark studio stage, with realistic materials, soft shadows and eased edges. Boards show their pads and reference labels. Buttons jump to top, front, side and 3D views. Drag the Explode slider or press play. Wires are coloured by kind (power, ground, signal, RF) and animated in the direction of flow. Power paths are labelled with volts, amps and watts. Click a part for its details. |
| Power tree | Power from the input down to each load, with what each part receives, passes on and uses. |
| Bill of materials | Reference, package or material, candidate part numbers, quantity, rough unit cost, and the basis for each line. |
| Firmware | rea's report on an uploaded firmware or flash image, with Claude's reading of it. |

| Design | Redesign the product. Drag a part in 3D or type its position and size. Resize the whole housing, change a wall, centre a part, move a board with everything mounted on it. The fit check updates live, with undo and reset. Every other view and export follows the edit. |
| Simulator | Operate the product. Click a button on the 3D model or in the list: the press travels along the wiring, and the LEDs, speakers and motors that respond light up. Shows power drawn and a log of what happened. The simulator offers the functions the product has. A product with wheels and a motor can be driven: hold the on-screen arrows or use the arrow keys or W A S D, and it moves across a floor grid with its wheels turning, showing speed and distance. Fans and propellers spin while it is on. A product with a camera gets a camera view: a moving test pattern, or your own webcam if you allow it (the picture stays in the browser), with a button to take photos. If the product makes sound, you hear it: generated music for a speaker, white noise, rain or ocean for a sound machine, a beep for a buzzer, a hum for a motor, with a live level meter, a sound picker and a mute button. |
| Architecture | A block diagram of each board: what feeds it, what it drives, every supply rail and bus, and a table of all interfaces. |
| Bare board | The board on its own: outline, holes, footprints, pads and connections, top and bottom, flat or in 3D. A fabrication preview drawn from the generated Gerber files. |
| Fit and mould | For each housing part: material, wall, tool direction, draft, ribs, shrink, mass, clamp force and cooling time. Then the gap from every part to the housing wall, and any parts that overlap. |
| Parameters | Sliders for load, time at peak, supply voltage, ambient temperature and battery capacity. Shows input current, heat and a rough temperature per part, and battery runtime. |
| Make | The checks the design passes and fails, cost by group, and every export in one place. |
| Plan | The brainstorm result: requirements, blocks, risks. Shown when the project started from an idea. |
| Guide | What each view is for, and what you can do with the result. |

A link such as `http://localhost:5173/#sample:board` opens the sample on a given tab (`view`, `design`, `run`, `arch`, `board`, `fit`, `sim`, `power`, `bom`, `firmware`, `guide`).

### Exports

- **CAD model (.step)**, assembled or exploded. AP214, millimetres, one named and coloured solid per part. Opens in FreeCAD, Fusion, SolidWorks, Onshape and KiCad's 3D viewer. Cylinders are written as 32-sided prisms.
- **Blender scene script (.py)**. In Blender, open the Scripting tab, open the file and press Run. It builds every part and wire and keyframes the explosion from frame 1 to frame 60. One Blender unit is one millimetre. Written for Blender 3.6 and newer, tested on 5.3.
- **Gerber set (.zip)**, per board: outline, pads, mask, paste, silkscreen outlines, drill and placement files, RS-274X and Excellon in millimetres. The files are checked with [pcb-stackup](https://github.com/tracespace/tracespace), the renderer [Kitspace](https://github.com/kitspace) uses.
- **KiCad and Kitspace project (.zip)**: a native `.kicad_pcb` for [KiCad](https://github.com/KiCad) 6 or newer with one footprint per part and the nets between them, the Gerber set, a Kitspace `1-click-bom.tsv` and a `kitspace.yaml`.
- **Bill of materials (.csv)** and **teardown data (.json)**.

The Blender script now sets up a product render: a physically based material per part (plastic, metal, FR-4, rubber, glass), bevelled edges, a studio backdrop, three soft lights, a camera with depth of field and Cycles. Press F12 in Blender, or render without opening it:

```bash
blender -b -P speaker-blender.py -- --render prototype.png             # assembled
blender -b -P speaker-blender.py -- --render exploded.png --frame 60   # exploded
blender -b -P speaker-blender.py -- --render quick.png --fast          # Eevee, seconds
```

**Copper traces.** `src/lib/route.ts` is a small autorouter. It connects the pads of each net on two layers, straight or at 45 degrees, with vias where it has to change layer, wider traces for power, and clearance to other nets. About nine nets in ten route; the rest stay as dashed lines to finish by hand. The traces appear in the board layout, the 3D board, the fabrication preview, the Gerber files and the KiCad board. This is a first pass: for a photographed product it is not the original routing, the pads are typical rather than measured, and nothing is checked for current, impedance or noise. Review and re-route in KiCad before ordering boards.

## What it cannot know

A photo does not contain exact geometry or exact electrical values. The 3D model is an approximate reconstruction scaled from features of known size, built from boxes, cylinders and open shells. Voltages, currents and part numbers are engineering estimates until you measure or read a marking. The app says so per part, lists what is still unknown, and gives the measurements that would settle it. Add what you learn under "Correct or extend this teardown" and Claude revises the model.

Use it on products you own or are authorised to examine.

## How it works

```
browser (React, three.js)
  │  description + photos (resized in the browser)
  ▼
server/index.mjs ── /api/brief  ── Claude API ──▶ questions and plan
  │              ── /api/analyze ── Claude API (claude-fable-5-2), tool call ──▶ teardown JSON
  │                 system prompt: server/prompt.mjs (mechanical, PCB and power knowledge)
  │                 schema:        server/schema.mjs
  │                 validation:    server/sanitize.mjs
  └── /api/firmware ── rea CLI (server/rea.mjs) ──▶ evidence JSON ──▶ Claude reading
```

The teardown JSON (`src/lib/types.ts`) is the single source for everything else:

- `src/lib/geometry.ts` turns a part into primitives. The viewer, the STEP writer and the Blender script all build from the same primitives.
- `src/components/Viewer3D.tsx` is the exploded view.
- `src/lib/power.ts` derives per-part power and the power tree.
- `server/swarm.mjs` is the team build behind `/api/build` (a stream of events).
- `server/store.mjs` keeps generations and projects; `server/boardImport.mjs` reads Gerber and KiCad uploads.
- `src/components/Agent.tsx` is the chat panel; `src/lib/validate.ts` the checks it reports; `src/lib/sound.ts` the simulator's audio.
- `src/lib/edit.ts` holds the design edits, `behaviour.ts` the click-to-operate simulator and `abilities.ts` what a product can do (drive, spin, see).
- `src/lib/board.ts` derives the bare board; `fit.ts` the mould and fit checks; `simulate.ts` the parameter simulation.
- `src/lib/exportStep.ts`, `exportBlender.ts`, `exportGerber.ts`, `exportPcbProject.ts`, `exportBom.ts` are the exports.
- `src/lib/sample.ts` is the built-in sample, an illustrative Bluetooth speaker.

## Working on it with Claude Code

- `.mcp.json` registers rea's MCP server, so Claude Code can run rea investigations directly.
- `/impeccable critique`, `/impeccable audit` and `/impeccable polish` review the interface. `npm run design:scan` runs impeccable's detector on the source.
# product-maker-
