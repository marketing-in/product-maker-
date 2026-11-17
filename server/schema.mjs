// JSON schema for the tool Claude is forced to call. It mirrors
// src/lib/types.ts (without `meta`, which the server adds).

const vec3 = (description) => ({
  type: 'array',
  description,
  items: { type: 'number' },
  minItems: 3,
  maxItems: 3,
});

const confidence = {
  type: 'string',
  enum: ['observed', 'inferred', 'assumed'],
  description:
    'observed: visible in a photo or stated by the user. inferred: follows from what is observed. assumed: typical for the product class only.',
};

export const CATEGORIES = [
  'enclosure', 'pcb', 'ic', 'passive', 'connector', 'power', 'battery', 'display',
  'electromech', 'sensor', 'antenna', 'thermal', 'fastener', 'other',
];

export const KINDS = ['power', 'ground', 'signal', 'rf', 'mechanical'];

export const TEARDOWN_TOOL = {
  name: 'record_teardown',
  description:
    'Record the complete reverse-engineering teardown of the product: every part, how the parts connect, and the approximate 3D layout.',
  input_schema: {
    type: 'object',
    required: ['product', 'parts', 'connections', 'unknowns', 'verifySteps', 'safety'],
    properties: {
      product: {
        type: 'object',
        required: ['name', 'category', 'summary', 'dimensionsMm'],
        properties: {
          name: { type: 'string' },
          category: { type: 'string' },
          summary: { type: 'string', description: 'Two or three sentences on how the product is built and powered.' },
          dimensionsMm: vec3('Overall width (X), depth (Y), height (Z) in mm.'),
          powerInput: { type: 'string', description: 'For example "USB-C, 5 V up to 2 A" or "230 V AC mains".' },
        },
      },
      parts: {
        type: 'array',
        minItems: 3,
        maxItems: 60,
        items: {
          type: 'object',
          required: [
            'id', 'name', 'category', 'qty', 'function', 'confidence', 'evidence',
            'shape', 'size', 'position', 'explode', 'color',
          ],
          properties: {
            id: { type: 'string', description: 'Short unique id, lowercase letters, digits and hyphens.' },
            name: { type: 'string' },
            category: { type: 'string', enum: CATEGORIES },
            refDes: { type: 'string', description: 'Reference designator such as U1, C12, J3. Only when the part sits on a board.' },
            qty: { type: 'integer', minimum: 1 },
            function: { type: 'string', description: 'What the part does in this product, one sentence.' },
            material: { type: 'string' },
            process: { type: 'string', description: 'How it is made: injection moulding, die casting, stamping, SMT reflow and so on.' },
            package: { type: 'string', description: 'Electronic package or mechanical format.' },
            candidates: {
              type: 'array',
              items: { type: 'string' },
              description: 'Likely part numbers or families. Give exact numbers only when a marking is legible.',
            },
            estCostUsd: { type: 'number', description: 'Rough unit cost at volume.' },
            confidence,
            evidence: { type: 'string', description: 'What in the photo or description supports this part.' },
            unknowns: { type: 'string', description: 'What is still unknown about this part and how to find out.' },
            parentId: { type: 'string', description: 'Id of the part this one is mounted on, such as its PCB.' },
            shape: { type: 'string', enum: ['box', 'cylinder', 'shell'] },
            size: vec3('Bounding box in mm along X, Y, Z.'),
            axis: { type: 'string', enum: ['x', 'y', 'z'], description: 'Cylinder only: the axis its length runs along.' },
            open: {
              type: 'string',
              enum: ['+x', '-x', '+y', '-y', '+z', '-z'],
              description: 'Shell only: the open face, which points at the mating housing half.',
            },
            wall: { type: 'number', description: 'Shell only: wall thickness in mm.' },
            position: vec3('Centre of the part in mm when assembled.'),
            copies: {
              type: 'array',
              items: vec3('Centre of an identical copy.'),
              description: 'Centres of identical extra copies (screws, feet, repeated switches).',
            },
            explode: vec3('Offset in mm from position when the view is fully exploded.'),
            color: { type: 'string', description: 'Realistic colour as #rrggbb.' },
            shapes: {
              type: 'array',
              description: 'Optional. The form of the part built from 2 to 8 simple solids, the way a modeller blocks out an object, instead of one plain box. Use it for the parts that define how the product looks: wheels (tyre, hub), motors (can, gearbox, shaft), housings with a raised or stepped form, knobs, lenses, antennas, feet, large connectors. Leave it out for small board components. All solids must stay inside the part size.',
              items: {
                type: 'object',
                required: ['shape', 'size', 'offset'],
                properties: {
                  shape: { type: 'string', enum: ['box', 'cylinder'] },
                  size: vec3('Bounding box of this solid in mm. For a cylinder the length runs along axis.'),
                  axis: { type: 'string', enum: ['x', 'y', 'z'], description: 'Cylinder axis.' },
                  offset: vec3('Centre of this solid relative to the centre of the part, in mm.'),
                  color: { type: 'string', description: 'Colour as #rrggbb if it differs from the part colour: a black tyre on a white hub, a brass shaft.' },
                },
              },
            },
          },
        },
      },
      connections: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'from', 'to', 'kind', 'label', 'confidence'],
          properties: {
            id: { type: 'string' },
            from: { type: 'string', description: 'Part id. For power: the source side.' },
            to: { type: 'string', description: 'Part id. For power: the load side.' },
            kind: { type: 'string', enum: KINDS },
            label: { type: 'string', description: 'Net or harness name, such as VBUS, 3V3, I2C, speaker out.' },
            medium: { type: 'string', description: 'PCB trace, wire, flex cable, board-to-board connector, spring contact and so on.' },
            voltageV: { type: 'number' },
            currentA: { type: 'number' },
            powerW: { type: 'number' },
            protocol: { type: 'string' },
            wire: { type: 'string', description: 'Colour and gauge if it is a discrete wire.' },
            confidence,
            evidence: { type: 'string' },
          },
        },
      },
      controls: {
        type: 'array',
        description: 'How the product responds to the user: one entry per button, switch, knob or key. Used by the click-to-operate simulator. A part with several copies (a row of keys) gets one entry per copy, in the order of its position then copies.',
        items: {
          type: 'object',
          required: ['partId', 'label', 'effect', 'action'],
          properties: {
            partId: { type: 'string', description: 'Id of the switch, button or knob part.' },
            label: { type: 'string', description: 'What the user would call it: Power, Volume up, Mode.' },
            effect: {
              type: 'string',
              enum: ['power', 'toggle', 'momentary', 'level-up', 'level-down'],
              description: 'power: switches the whole product on or off. toggle: latches the affected outputs on or off. momentary: the affected outputs respond while pressed. level-up / level-down: raises or lowers volume, brightness or speed.',
            },
            action: { type: 'string', description: 'One sentence: what the product does when this is pressed.' },
            affects: { type: 'array', items: { type: 'string' }, description: 'Ids of the output parts that respond: LEDs, displays, speakers, motors, heaters.' },
          },
        },
      },
      unknowns: { type: 'array', items: { type: 'string' } },
      verifySteps: {
        type: 'array',
        items: { type: 'string' },
        description: 'Measurements or photos that would confirm or correct this teardown, most useful first.',
      },
      safety: { type: 'array', items: { type: 'string' } },
    },
  },
};

// The brainstorm step: what the agent needs to know before it designs anything.
export const BRIEF_TOOL = {
  name: 'record_brief',
  description: 'Record the questions to ask and the draft plan for a hardware product the user wants to build.',
  input_schema: {
    type: 'object',
    required: ['title', 'understanding', 'questions', 'requirements', 'blocks', 'risks'],
    properties: {
      title: { type: 'string', description: 'Short product name, such as "Line-following robot".' },
      understanding: { type: 'string', description: 'Two or three sentences: what you understand the user wants, in plain words.' },
      questions: {
        type: 'array',
        description: 'Three to five choices that most change the design. Each has options and the one you would pick.',
        items: {
          type: 'object',
          required: ['id', 'question', 'options', 'assumed'],
          properties: {
            id: { type: 'string' },
            question: { type: 'string' },
            options: { type: 'array', items: { type: 'string' }, description: 'Two to four short options.' },
            assumed: { type: 'string', description: 'The option you would pick if the user does not answer. Must be one of options.' },
            why: { type: 'string', description: 'One short sentence: why this choice matters.' },
          },
        },
      },
      requirements: { type: 'array', items: { type: 'string' }, description: 'Five to nine concrete requirements with numbers: size, supply, run time, speed, range, cost.' },
      blocks: {
        type: 'array',
        description: 'The functional blocks of the design, in signal order.',
        items: {
          type: 'object',
          required: ['name', 'role'],
          properties: {
            name: { type: 'string', description: 'Controller, motor driver, power, sensing and so on.' },
            role: { type: 'string', description: 'What it does, in one sentence.' },
            parts: { type: 'string', description: 'The real part or part family you would use, such as ESP32-C3-MINI-1 or DRV8833.' },
          },
        },
      },
      risks: { type: 'array', items: { type: 'string' }, description: 'Two to four things most likely to go wrong, and what to check.' },
      costLowUsd: { type: 'number', description: 'Rough material cost for one unit, low end.' },
      costHighUsd: { type: 'number', description: 'Rough material cost for one unit, high end.' },
    },
  },
};

// Firmware for a designed product: a complete PlatformIO project for its controller.
export const FIRMWARE_TOOL = {
  name: 'record_firmware',
  description: 'Record the firmware for this product as a complete PlatformIO project.',
  input_schema: {
    type: 'object',
    required: ['controller', 'framework', 'platformioEnv', 'summary', 'pins', 'files', 'build', 'test', 'assumptions'],
    properties: {
      controller: { type: 'string', description: 'The chip the firmware runs on, with its refDes, such as "U1 ESP32-C3-MINI-1".' },
      framework: { type: 'string', description: 'arduino, espidf, pico-sdk, zephyr and so on.' },
      platformioEnv: {
        type: 'object',
        required: ['platform', 'board', 'framework'],
        properties: {
          platform: { type: 'string', description: 'PlatformIO platform, such as espressif32, raspberrypi, atmelavr, ststm32.' },
          board: { type: 'string', description: 'PlatformIO board id, such as esp32-c3-devkitm-1.' },
          framework: { type: 'string' },
          libDeps: { type: 'array', items: { type: 'string' }, description: 'lib_deps entries, pinned to a version.' },
          buildFlags: { type: 'array', items: { type: 'string' } },
          monitorSpeed: { type: 'number' },
        },
      },
      summary: { type: 'string', description: 'Three to five sentences: what the firmware does, in plain words.' },
      pins: {
        type: 'array',
        description: 'Every pin the firmware uses.',
        items: {
          type: 'object',
          required: ['pin', 'signal', 'direction', 'connectsTo'],
          properties: {
            pin: { type: 'string', description: 'GPIO name or number as written in the code.' },
            signal: { type: 'string' },
            direction: { type: 'string', enum: ['input', 'output', 'analog in', 'pwm out', 'bus', 'other'] },
            connectsTo: { type: 'string', description: 'The part (refDes and name) at the other end.' },
            note: { type: 'string' },
          },
        },
      },
      files: {
        type: 'array',
        description: 'The source files, complete and ready to build: src/main.cpp at least, plus any headers. Do not include platformio.ini; it is written from platformioEnv.',
        items: {
          type: 'object',
          required: ['path', 'content'],
          properties: {
            path: { type: 'string', description: 'Relative path such as src/main.cpp or include/pins.h.' },
            content: { type: 'string' },
          },
        },
      },
      build: { type: 'array', items: { type: 'string' }, description: 'Steps to build and flash it, as plain sentences with the commands.' },
      test: { type: 'array', items: { type: 'string' }, description: 'Bench tests to run after flashing, safest first.' },
      assumptions: { type: 'array', items: { type: 'string' }, description: 'Every choice not fixed by the design: pins picked, protocols, timings.' },
    },
  },
};
