// The teardown data model. Everything in the app — the 3D view, the power
// tree, the BOM and the Blender / STEP exports — is derived from this one
// object. Units: millimetres, Z up, origin at the centre of the product.

export type Vec3 = [number, number, number];

export type PartCategory =
  | 'enclosure'
  | 'pcb'
  | 'ic'
  | 'passive'
  | 'connector'
  | 'power'
  | 'battery'
  | 'display'
  | 'electromech'
  | 'sensor'
  | 'antenna'
  | 'thermal'
  | 'fastener'
  | 'other';

/** observed: visible in the photo or stated by the user.
 *  inferred: follows from what is observed (e.g. a USB-C port implies CC resistors).
 *  assumed: typical for this product class, not supported by this evidence. */
export type Confidence = 'observed' | 'inferred' | 'assumed';

export type Shape = 'box' | 'cylinder' | 'shell';
export type Axis = 'x' | 'y' | 'z';
export type OpenFace = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

/** One solid of a part that is built from several. */
export interface PartShape {
  shape: 'box' | 'cylinder';
  size: Vec3;
  axis?: Axis;
  /** Centre relative to the centre of the part. */
  offset: Vec3;
  color?: string;
}

export interface Part {
  id: string;
  name: string;
  category: PartCategory;
  refDes?: string;
  qty: number;
  function: string;
  material?: string;
  process?: string;
  package?: string;
  candidates?: string[];
  estCostUsd?: number;
  confidence: Confidence;
  evidence: string;
  unknowns?: string;
  /** Id of the part this one is mounted on (a component on its PCB). */
  parentId?: string | null;

  shape: Shape;
  /** Bounding box in mm. For a cylinder the length runs along `axis`. */
  size: Vec3;
  axis?: Axis;
  /** shell only: which face of the box is open, and the wall thickness. */
  open?: OpenFace;
  wall?: number;
  /** Centre of the part when the product is assembled. */
  position: Vec3;
  /** Extra centres for identical copies (screws, feet). qty = 1 + copies. */
  copies?: Vec3[];
  /** Offset from `position` when the view is fully exploded. */
  explode: Vec3;
  color: string;
  /** The form of the part as several solids. When present it replaces the plain shape; size stays the bounding box. */
  shapes?: PartShape[];
}

export type ConnectionKind = 'power' | 'ground' | 'signal' | 'rf' | 'mechanical';

export interface Connection {
  id: string;
  from: string;
  to: string;
  kind: ConnectionKind;
  label: string;
  medium?: string;
  voltageV?: number;
  currentA?: number;
  powerW?: number;
  protocol?: string;
  wire?: string;
  confidence: Confidence;
  evidence?: string;
}

/** What a control does when pressed in the simulator. */
export type ControlEffect = 'power' | 'toggle' | 'momentary' | 'level-up' | 'level-down';

export interface ControlSpec {
  /** The switch, button or knob. */
  partId: string;
  label: string;
  effect: ControlEffect;
  /** One sentence: what the product does when this is pressed. */
  action: string;
  /** Output parts that respond (LEDs, speakers, motors, displays). */
  affects?: string[];
}

/** Firmware written for the product's controller: a PlatformIO project. */
export interface FirmwareBundle {
  controller: string;
  framework: string;
  env: { platform: string; board: string; framework: string; libDeps: string[]; buildFlags: string[]; monitorSpeed: number };
  summary: string;
  pins: { pin: string; signal: string; direction: string; connectsTo: string; note?: string }[];
  files: { path: string; content: string }[];
  build: string[];
  test: string[];
  assumptions: string[];
  model?: string;
  createdAt: string;
}

export interface Teardown {
  product: {
    name: string;
    category: string;
    summary: string;
    dimensionsMm: Vec3;
    powerInput?: string;
  };
  parts: Part[];
  connections: Connection[];
  /** How the product responds to its buttons. Optional; worked out from the parts when absent. */
  controls?: ControlSpec[];
  unknowns: string[];
  verifySteps: string[];
  safety: string[];
  /** Firmware written for this design, when the user has asked for it. */
  firmware?: FirmwareBundle;
  meta: {
    source: 'claude' | 'sample';
    model?: string;
    createdAt: string;
  };
}

export const CATEGORY_LABEL: Record<PartCategory, string> = {
  enclosure: 'Enclosure and mouldings',
  pcb: 'Circuit boards',
  ic: 'Integrated circuits',
  passive: 'Passives',
  connector: 'Connectors',
  power: 'Power conversion',
  battery: 'Battery',
  display: 'Display and indicators',
  electromech: 'Electromechanical',
  sensor: 'Sensors',
  antenna: 'Antennas',
  thermal: 'Thermal',
  fastener: 'Fasteners',
  other: 'Other',
};

export const CATEGORY_ORDER: PartCategory[] = [
  'enclosure', 'pcb', 'ic', 'power', 'battery', 'connector', 'passive',
  'electromech', 'sensor', 'display', 'antenna', 'thermal', 'fastener', 'other',
];

export const KIND_LABEL: Record<ConnectionKind, string> = {
  power: 'Power',
  ground: 'Ground',
  signal: 'Signal',
  rf: 'RF',
  mechanical: 'Mechanical',
};

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  observed: 'Observed',
  inferred: 'Inferred',
  assumed: 'Assumed',
};
