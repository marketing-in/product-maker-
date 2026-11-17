import type { GerberFile } from './exportGerber';
import type { FirmwareBundle, Teardown } from './types';

// Turns a firmware bundle into the files of a PlatformIO project.

export function platformioIni(fw: FirmwareBundle): string {
  const e = fw.env;
  const lines = [
    '; PlatformIO project for the firmware written by Teardown Lab.',
    '; Build: pio run    Flash: pio run -t upload    Serial: pio device monitor',
    '',
    `[env:${e.board.replace(/[^\w-]/g, '_')}]`,
    `platform = ${e.platform}`,
    `board = ${e.board}`,
    `framework = ${e.framework}`,
    `monitor_speed = ${e.monitorSpeed}`,
  ];
  if (e.libDeps.length) lines.push('lib_deps =', ...e.libDeps.map((d) => `    ${d}`));
  if (e.buildFlags.length) lines.push('build_flags =', ...e.buildFlags.map((f) => `    ${f}`));
  return `${lines.join('\n')}\n`;
}

export function firmwareReadme(fw: FirmwareBundle, td: Teardown): string {
  const cell = (s: string) => s.replace(/\|/g, '/');
  return `# Firmware: ${td.product.name}

${fw.summary}

- Controller: ${fw.controller}
- Framework: ${fw.framework} on PlatformIO \`${fw.env.platform}\`, board \`${fw.env.board}\`
- Written by ${fw.model ?? 'Claude'} on ${fw.createdAt.slice(0, 10)} from the design. It has not been compiled or run on hardware by Teardown Lab.

## Pins

| Pin | Signal | Direction | Connects to | Note |
| --- | --- | --- | --- | --- |
${fw.pins.map((p) => `| ${cell(p.pin)} | ${cell(p.signal)} | ${cell(p.direction)} | ${cell(p.connectsTo)} | ${cell(p.note ?? '')} |`).join('\n')}

## Build and flash

${fw.build.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Test on the bench

${fw.test.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Assumptions

${fw.assumptions.map((s) => `- ${s}`).join('\n')}
`;
}

/** The project's files, under one folder. */
export function firmwareFiles(fw: FirmwareBundle, td: Teardown, folder: string): GerberFile[] {
  return [
    { name: `${folder}/platformio.ini`, text: platformioIni(fw) },
    { name: `${folder}/README.md`, text: firmwareReadme(fw, td) },
    ...fw.files.map((f) => ({ name: `${folder}/${f.path}`, text: f.content })),
  ];
}
