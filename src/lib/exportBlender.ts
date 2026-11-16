import { instances, partPrims } from './geometry';
import { connPower, connValues } from './power';
import type { Teardown } from './types';

// Writes a Python script for Blender (3.6 or newer). Open Blender, go to the
// Scripting tab, open the file and press Run. It builds every part, wires the
// connections between them and keyframes the exploded view from frame 1
// (assembled) to frame 60 (exploded). One Blender unit is one millimetre.
//
// The scene is set up for a realistic product render: a physically based
// material per part chosen from its material note and category (moulded
// plastic, metal, FR-4, rubber, glass), bevelled edges, a studio backdrop,
// three soft lights, a camera with depth of field and Cycles settings.

export function buildBlenderScript(td: Teardown): string {
  const data = {
    name: td.product.name,
    parts: td.parts.map((p) => ({
      id: p.id,
      name: p.refDes ? `${p.refDes} ${p.name}` : p.name,
      category: p.category,
      function: p.function,
      package: p.package ?? '',
      material: p.material ?? '',
      confidence: p.confidence,
      color: p.color,
      explode: p.explode,
      instances: instances(p),
      prims: partPrims(p),
    })),
    wires: td.connections
      .filter((c) => c.kind !== 'mechanical')
      .map((c) => ({
        id: c.id,
        from: c.from,
        to: c.to,
        kind: c.kind,
        label: c.label,
        values: connValues(c),
        power: connPower(c) ?? 0,
      })),
  };
  const payload = JSON.stringify(JSON.stringify(data));

  return `# Teardown Lab export for Blender 3.6+
# ${td.product.name.replace(/[\r\n]/g, ' ')}
# Geometry is an approximate reconstruction, not a measured model.
# Run from the Scripting tab. Press Space to play the exploded view.
# Press F12 to render a still, or Ctrl+F12 to render the animation.
#
# Without opening Blender:
#   blender -b -P this_file.py -- --render prototype.png            (assembled)
#   blender -b -P this_file.py -- --render exploded.png --frame 60  (exploded)
#   blender -b -P this_file.py -- --render prototype.png --fast     (Eevee, seconds not minutes)

import json
import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

DATA = json.loads(${payload})

EXPLODE_START = 1
EXPLODE_END = 60
WIRE_COLORS = {
    "power": (0.78, 0.25, 0.10, 1.0),
    "ground": (0.16, 0.17, 0.19, 1.0),
    "signal": (0.13, 0.36, 0.70, 1.0),
    "rf": (0.05, 0.50, 0.47, 1.0),
}


def hex_rgba(value):
    value = value.lstrip("#")
    r, g, b = (int(value[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    # sRGB to linear, so colours match the browser view.
    lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (lin(r), lin(g), lin(b), 1.0)


def set_input(bsdf, names, value):
    # Socket names changed between Blender 3.x and 4.x; use whichever exists.
    for name in names:
        socket = bsdf.inputs.get(name)
        if socket is not None:
            socket.default_value = value
            return


# Surface presets, matched against the part's material note and category.
# (keywords, metallic, roughness, extra)
SURFACES = [
    (("glass", "lens", "acrylic", "pmma", "window"), 0.0, 0.05, {"transmission": 0.9, "ior": 1.5}),
    (("gold", "enig"), 1.0, 0.25, {}),
    (("copper", "brass"), 1.0, 0.3, {}),
    (("steel", "stainless", "iron", "nickel", "zinc", "tin", "chrome"), 1.0, 0.35, {}),
    (("alumin",), 1.0, 0.4, {}),
    (("rubber", "silicone", "tpe", "tpu", "foam", "eva"), 0.0, 0.9, {}),
    (("fr-4", "fr4", "solder mask"), 0.0, 0.35, {"coat": 0.6}),
    (("paper", "card", "fabric", "cloth", "felt"), 0.0, 0.95, {}),
    (("gloss", "polished", "piano"), 0.0, 0.12, {"coat": 0.5}),
    (("abs", "pc", "polycarbonate", "nylon", "plastic", "pp", "mould", "mold"), 0.0, 0.45, {}),
]
CATEGORY_SURFACE = {
    "pcb": (0.0, 0.35, {"coat": 0.6}),
    "ic": (0.0, 0.5, {}),
    "fastener": (1.0, 0.35, {}),
    "connector": (1.0, 0.4, {}),
    "thermal": (1.0, 0.4, {}),
    "battery": (0.0, 0.3, {"coat": 0.3}),
    "display": (0.0, 0.08, {"coat": 0.8}),
    "enclosure": (0.0, 0.45, {}),
}


def surface_for(note, category):
    text = (note or "").lower()
    for keys, metallic, roughness, extra in SURFACES:
        if any(k in text for k in keys):
            return metallic, roughness, extra
    return CATEGORY_SURFACE.get(category, (0.0, 0.55, {}))


def material(name, rgba, roughness=0.55, metallic=0.0, extra=None):
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
        mat.diffuse_color = rgba
        mat.metallic = metallic
        mat.roughness = roughness
        if mat.node_tree is None:  # Blender 4.x and older
            mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf is not None:
            extra = extra or {}
            set_input(bsdf, ["Base Color"], rgba)
            set_input(bsdf, ["Roughness"], roughness)
            set_input(bsdf, ["Metallic"], metallic)
            if "coat" in extra:
                set_input(bsdf, ["Coat Weight", "Clearcoat"], extra["coat"])
                set_input(bsdf, ["Coat Roughness", "Clearcoat Roughness"], 0.1)
            if "transmission" in extra:
                set_input(bsdf, ["Transmission Weight", "Transmission"], extra["transmission"])
                set_input(bsdf, ["IOR"], extra.get("ior", 1.45))
    return mat


def collection(name, parent):
    col = bpy.data.collections.new(name)
    parent.children.link(col)
    return col


AXIS_ROTATION = {
    "x": Matrix.Rotation(math.radians(90.0), 4, "Y"),
    "y": Matrix.Rotation(math.radians(-90.0), 4, "X"),
    "z": Matrix.Identity(4),
}


def add_prim(bm, prim):
    center = Matrix.Translation(Vector(prim["center"]))
    if prim["kind"] == "box":
        sx, sy, sz = prim["size"]
        matrix = center @ Matrix.Diagonal((sx, sy, sz, 1.0))
        bmesh.ops.create_cube(bm, size=1.0, matrix=matrix)
    else:
        matrix = center @ AXIS_ROTATION[prim["axis"]]
        bmesh.ops.create_cone(
            bm,
            cap_ends=True,
            segments=48,
            radius1=prim["radius"],
            radius2=prim["radius"],
            depth=prim["length"],
            matrix=matrix,
        )


def build_part(part, col):
    mesh = bpy.data.meshes.new(part["name"])
    bm = bmesh.new()
    for prim in part["prims"]:
        add_prim(bm, prim)
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = len(poly.vertices) == 4 and any(p["kind"] == "cyl" for p in part["prims"])
    metallic, roughness, extra = surface_for(part["material"], part["category"])
    mat_name = "TL %s m%.0f r%.2f %s" % (part["color"], metallic, roughness, "".join(sorted(extra)))
    mesh.materials.append(material(mat_name, hex_rgba(part["color"]), roughness, metallic, extra))
    smallest = min(min(p["size"]) if p["kind"] == "box" else min(p["radius"] * 2.0, p["length"]) for p in part["prims"])

    objects = []
    for index, centre in enumerate(part["instances"]):
        name = part["name"] if index == 0 else "%s #%d" % (part["name"], index + 1)
        obj = bpy.data.objects.new(name, mesh)
        col.objects.link(obj)
        obj["teardown_id"] = part["id"]
        obj["category"] = part["category"]
        obj["function"] = part["function"]
        obj["package"] = part["package"]
        obj["material_note"] = part["material"]
        obj["confidence"] = part["confidence"]
        # A small bevel catches the light on every edge, as real parts do.
        bevel = obj.modifiers.new("Edge bevel", "BEVEL")
        bevel.width = max(0.03, min(0.6, smallest * 0.12))
        bevel.segments = 3
        bevel.limit_method = "ANGLE"
        bevel.angle_limit = math.radians(40.0)
        obj.location = Vector(centre)
        obj.keyframe_insert("location", frame=EXPLODE_START)
        obj.location = Vector(centre) + Vector(part["explode"])
        obj.keyframe_insert("location", frame=EXPLODE_END)
        objects.append(obj)
    return objects


def build_wire(wire, a, b, col):
    # A unit-length rod along +Y that follows part A and stretches to part B,
    # so the wire stays attached while the view explodes.
    radius = 0.35 + min(1.0, math.sqrt(max(wire["power"], 0.0)) * 0.3)
    mesh = bpy.data.meshes.new("wire " + wire["id"])
    bm = bmesh.new()
    matrix = Matrix.Translation((0.0, 0.5, 0.0)) @ Matrix.Rotation(math.radians(-90.0), 4, "X")
    bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=radius, radius2=radius, depth=1.0, matrix=matrix)
    bm.to_mesh(mesh)
    bm.free()
    rgba = WIRE_COLORS.get(wire["kind"], (0.5, 0.5, 0.5, 1.0))
    mesh.materials.append(material("TL wire " + wire["kind"], rgba, 0.4))

    label = wire["label"] + ((" | " + wire["values"]) if wire["values"] else "")
    obj = bpy.data.objects.new(label[:60], mesh)
    col.objects.link(obj)
    obj["kind"] = wire["kind"]
    obj["values"] = wire["values"]
    follow = obj.constraints.new("COPY_LOCATION")
    follow.target = a
    stretch = obj.constraints.new("STRETCH_TO")
    stretch.target = b
    stretch.rest_length = 1.0
    stretch.volume = "NO_VOLUME"
    return obj


def main():
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 0.001
    scene.unit_settings.length_unit = "MILLIMETERS"
    scene.frame_start = EXPLODE_START
    scene.frame_end = EXPLODE_END + 30

    root = collection("Teardown: " + DATA["name"][:40], scene.collection)
    parts_col = collection("Parts", root)
    wires_col = collection("Wiring", root)

    first = {}
    reach = 10.0
    for part in DATA["parts"]:
        objects = build_part(part, parts_col)
        first[part["id"]] = objects[0]
        for centre in part["instances"]:
            reach = max(reach, (Vector(centre) + Vector(part["explode"])).length)

    wires = 0
    for wire in DATA["wires"]:
        a = first.get(wire["from"])
        b = first.get(wire["to"])
        if a is None or b is None or a is b:
            continue
        build_wire(wire, a, b, wires_col)
        wires += 1

    target = bpy.data.objects.new("Teardown target", None)
    root.objects.link(target)

    # Lowest point of the model at any moment of the explosion: the floor sits just under it.
    low = 0.0
    for part in DATA["parts"]:
        half = max(max(p["size"]) if p["kind"] == "box" else max(p["radius"] * 2.0, p["length"]) for p in part["prims"]) / 2.0
        for centre in part["instances"]:
            low = min(low, centre[2] - half, centre[2] + part["explode"][2] - half)

    # Studio backdrop: a floor that curves up into a back wall, so there is no horizon line.
    mesh = bpy.data.meshes.new("Teardown backdrop")
    bm = bmesh.new()
    span = reach * 14.0
    steps = 12
    profile = [(-span, low), (span * 0.25, low)]
    for i in range(1, steps + 1):
        a = (math.pi / 2.0) * i / steps
        profile.append((span * 0.25 + math.sin(a) * span * 0.2, low + (1.0 - math.cos(a)) * span * 0.2))
    profile.append((span * 0.45, low + span))
    rows = [[bm.verts.new((x, y, z)) for x in (-span, span)] for y, z in profile]
    for a, b in zip(rows, rows[1:]):
        bm.faces.new((a[0], a[1], b[1], b[0]))
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = True
    mesh.materials.append(material("TL backdrop", (0.80, 0.79, 0.76, 1.0), 0.6))
    backdrop = bpy.data.objects.new("Teardown backdrop", mesh)
    root.objects.link(backdrop)

    cam_data = bpy.data.cameras.new("Teardown camera")
    cam_data.lens = 70.0
    cam_data.clip_start = 1.0
    cam_data.clip_end = reach * 60.0
    cam = bpy.data.objects.new("Teardown camera", cam_data)
    cam.location = (reach * 2.6, -reach * 3.4, reach * 1.9)
    track = cam.constraints.new("TRACK_TO")
    track.target = target
    root.objects.link(cam)
    scene.camera = cam
    cam_data.dof.use_dof = True
    cam_data.dof.focus_object = target
    cam_data.dof.aperture_fstop = 8.0

    # Three soft area lights: key, fill and rim. Power scales with distance squared.
    def area_light(name, location, size, watts, colour):
        data = bpy.data.lights.new(name, "AREA")
        data.shape = "DISK"
        data.size = size
        data.energy = watts
        data.color = colour
        obj = bpy.data.objects.new(name, data)
        obj.location = location
        aim = obj.constraints.new("TRACK_TO")
        aim.target = target
        root.objects.link(obj)

    # Cycles measures distance in scene units (millimetres here), so power grows with reach squared.
    area_light("Teardown key light", (reach * 2.5, -reach * 2.0, reach * 3.5), reach * 2.5, 900.0 * reach * reach, (1.0, 0.97, 0.93))
    area_light("Teardown fill light", (-reach * 3.5, -reach * 1.5, reach * 1.5), reach * 4.0, 300.0 * reach * reach, (0.93, 0.96, 1.0))
    area_light("Teardown rim light", (-reach * 1.0, reach * 3.5, reach * 2.5), reach * 2.0, 600.0 * reach * reach, (1.0, 1.0, 1.0))

    world = scene.world or bpy.data.worlds.new("Teardown world")
    scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    if background is not None:
        background.inputs["Color"].default_value = (0.75, 0.76, 0.78, 1.0)
        background.inputs["Strength"].default_value = 0.35

    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    fast = "--fast" in args
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    scene.render.film_transparent = False
    try:
        scene.view_settings.view_transform = "Filmic" if bpy.app.version < (4, 0, 0) else "AgX"
        scene.view_settings.look = "None"
    except (TypeError, AttributeError):
        pass
    if fast:
        engines = [e.identifier for e in type(scene.render).bl_rna.properties["engine"].enum_items]
        scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
    else:
        scene.render.engine = "CYCLES"
        scene.cycles.samples = 192
        scene.cycles.use_denoising = True
        scene.cycles.max_bounces = 8

    for area in bpy.context.screen.areas if bpy.context.screen else []:
        if area.type == "VIEW_3D":
            for space in area.spaces:
                if space.type == "VIEW_3D":
                    space.clip_end = reach * 40.0

    frame = int(args[args.index("--frame") + 1]) if "--frame" in args else EXPLODE_START
    scene.frame_set(frame)
    # Wires are a diagram, not part of the product: hide them in a beauty render unless asked.
    wires_col.hide_render = "--wires" not in args
    print("Teardown Lab: built %d parts and %d wires." % (len(DATA["parts"]), wires))
    if "--render" in args:
        scene.render.filepath = args[args.index("--render") + 1]
        bpy.ops.render.render(write_still=True)
        print("Teardown Lab: rendered " + scene.render.filepath)


main()
`;
}
