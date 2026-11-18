---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/styles.css"]
---

# Workspace (src/App.tsx): Studio dark

Scope: the whole app shell and every work view (start, plan, exploded view, design editor, simulator, architecture, bare board, fit and mould, parameters, power tree, BOM, firmware, guide, make). Mode: Operate.
Audience and task: hardware engineers, repair technicians and students who open a product or board, read it part by part, change it, and take the files away. Pinned by the user: "Studio dark (Recommended)": a dark pro tool like Flux or Figma, the 3D model fills the screen, views on an icon rail at the left, the agent as a slim right panel, tools floating over the 3D.

## Direction contract

THESIS: The model is the workspace. Refuses the category default of a light form page with a boxed 3D preview and a long tab strip: the 3D stage runs edge to edge between a narrow view rail and a slim agent panel, and all chrome is a lifted shade of the same dark studio.
OWN-WORLD: Graphite studio, cool blue-black ground (stage darker than panels by two steps), warm off-white ink, hairlines one step above the panel. Amber only for the selected part. Wire-kind colours are the only other hues. Geist Sans for interface, Geist Mono for data. 8 px radii on trays, 6 px on controls; one soft shadow, used by floating trays and menus only.
STORY: The user sees the product first, finds a part in 3D or in the parts tray, reads what it is in the details panel, asks the agent for a change, and exports from the top bar.
FIRST VIEWPORT: Top bar 44 px: mark, product name, stage stepper, save state, Export, New project. Below: 64 px icon rail of views (icon over a short label, active view on a lifted pill), optional 272 px parts tray, the full-bleed 3D stage, and a 352 px right panel with Agent and Details tabs. On the exploded view, one floating tray docked bottom-centre carries explode, wire kinds and view toggles; the view cube floats top-right.
FORM: Pinned whole by the user; seed: none (pinned) "Studio dark (Recommended): A dark pro tool like Flux or Figma: the 3D model fills the screen, views move to an icon rail on the left, the agent chat becomes a slim panel, tools float over the 3D." Signature move: the floating tool tray, the one place controls sit on top of the model.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
