import { instances } from './geometry';
import type { Part, Teardown } from './types';

// What a product can physically do, worked out from its parts, so the simulator
// can offer the matching function: drive it, spin it, look through its camera.

const WHEEL = /wheel|tyre|tire|tread|crawler track/i;
const NOT_WHEEL = /caster|castor|ball|encoder|hub cap|mount|bracket|axle/i;
const MOTOR = /motor|servo|actuator|gearbox/i;
const SPINNER = /\b(fan|propeller|impeller|rotor|blade|turntable|platter|drum)\b/i;
const CAMERA = /camera|image sensor|cmos sensor|ccd|\bov\d{4}|imx\d{3}|webcam|lens module/i;

export interface Wheel { part: Part; axis: 0 | 1 | 2; radius: number; /** -1 for the left side, 1 for the right, 0 on the centre line. */ side: number }

export interface Abilities {
  drive: {
    wheels: Wheel[];
    /** Distance between the left and right wheels, mm. */
    track: number;
    radius: number;
    /** Which horizontal axis is forward: 0 for X, 1 for Y. */
    forward: 0 | 1;
    /** Height of the floor under the wheels, in product coordinates. */
    floorZ: number;
  } | null;
  spinners: { part: Part; axis: 0 | 1 | 2 }[];
  cameras: Part[];
}

/** The axis a round part turns about. */
function turnAxis(p: Part): 0 | 1 | 2 {
  const cyl = p.shapes?.find((s) => s.shape === 'cylinder');
  const named = cyl?.axis ?? (p.shape === 'cylinder' ? p.axis ?? 'z' : undefined);
  if (named) return (['x', 'y', 'z'] as const).indexOf(named) as 0 | 1 | 2;
  // A disc is thinnest along its axle.
  return p.size.indexOf(Math.min(...p.size)) as 0 | 1 | 2;
}

export function abilities(td: Teardown): Abilities {
  const wheelParts = td.parts.filter((p) => WHEEL.test(p.name) && !NOT_WHEEL.test(p.name));
  let drive: Abilities['drive'] = null;
  const hasMotor = td.parts.some((p) => MOTOR.test(p.name));
  const wheelCount = wheelParts.reduce((n, p) => n + instances(p).length, 0);
  if (wheelCount >= 2 && hasMotor) {
    // Wheels turn about a horizontal axle. Forward is the other horizontal direction.
    const axes = wheelParts.map(turnAxis).filter((a) => a !== 2);
    const axle = (axes.length ? axes.sort((a, b) => axes.filter((v) => v === a).length - axes.filter((v) => v === b).length).pop()! : 0) as 0 | 1;
    const centres = wheelParts.flatMap((p) => instances(p).map((c) => c[axle]));
    const mid = (Math.min(...centres) + Math.max(...centres)) / 2;
    const track = Math.max(20, Math.max(...centres) - Math.min(...centres));
    const wheels: Wheel[] = wheelParts.map((p) => {
      const others = ([0, 1, 2] as const).filter((i) => i !== axle);
      const radius = Math.max(p.size[others[0]], p.size[others[1]]) / 2;
      const off = p.position[axle] - mid;
      return { part: p, axis: axle, radius, side: Math.abs(off) < track * 0.1 ? 0 : Math.sign(off) };
    });
    const radius = Math.max(4, ...wheels.map((w) => w.radius));
    const floorZ = Math.min(...wheelParts.map((p) => p.position[2] - Math.max(p.size[2], radius * 2) / 2));
    drive = { wheels, track, radius, forward: axle === 0 ? 1 : 0, floorZ };
  }
  const spinners = td.parts
    .filter((p) => SPINNER.test(p.name) && !WHEEL.test(p.name) && !/guard|grille|shroud|housing|frame|connector|header/i.test(p.name))
    .map((part) => ({ part, axis: turnAxis(part) }));
  const cameras = td.parts.filter((p) => CAMERA.test(`${p.name} ${p.package ?? ''}`) && !/connector|cable|flex|bracket|holder|cover/i.test(p.name));
  return { drive, spinners, cameras };
}

/** Where the product is and how its turning parts stand. Written every frame by the simulator, read by the 3D view. */
export interface Motion {
  x: number;
  y: number;
  /** Radians, anticlockwise seen from above. */
  heading: number;
  /** Turn angle of each spinning part, by part id. */
  spin: Record<string, { axis: 0 | 1 | 2; angle: number }>;
  floorZ: number;
}

export const rest = (floorZ = 0): Motion => ({ x: 0, y: 0, heading: 0, spin: {}, floorZ });
