import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

import {
  CONSUMABLES,
  DISCOVERY_PROPERTIES,
  VACUUM_CLEANER_CLEAN_MODE as CLEAN,
  VACUUM_CLEANER_MODE as MODE,
  VACUUM_CLEANER_STATE as STATE,
} from '../src/constants.js';
import {
  UnsupportedCommandError,
  buildCommand,
  buildStates,
  buildVacuumFeatures,
  gladysStateOf,
  isRoomCleaning,
  normalizeState,
  runModeOf,
  waterLevelOf,
} from '../src/devices/vacuum.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

const CATEGORIES = new Set(Object.values(DEVICE_FEATURE_CATEGORIES));
const TYPES = new Set(Object.values(DEVICE_FEATURE_TYPES).flatMap((t) => Object.values(t)));
const UNITS = new Set(Object.values(DEVICE_FEATURE_UNITS));

const ids = createFakeGladys().externalIds('vacuum', '42');
// `siid.piid` keys as strings, in pairs: in an object literal, Prettier would
// unquote them into numbers (and 4.10 would silently become 4.1).
const props = (entries) => new Map(entries);
const docked = [
  ['2.1', 13],
  ['2.2', 0],
  ['3.2', 3],
  ['4.1', 0],
  ['4.7', 0],
  ['4.17', 0],
];

// --- States ------------------------------------------------------------------------

test('the Dreame states map to the Gladys ones', () => {
  const cases = [
    [
      [
        ['2.1', 1],
        ['4.7', 1],
        ['4.1', 2],
      ],
      STATE.RUNNING,
    ],
    [
      [
        ['2.1', 12],
        ['4.7', 1],
      ],
      STATE.RUNNING,
    ],
    [
      [
        ['2.1', 3],
        ['4.7', 6],
      ],
      STATE.PAUSED,
    ],
    [
      [
        ['2.1', 5],
        ['4.1', 3],
      ],
      STATE.RETURNING_TO_DOCK,
    ],
    [
      [
        ['2.1', 6],
        ['3.2', 1],
      ],
      STATE.CHARGING,
    ],
    [
      [
        ['2.1', 13],
        ['3.2', 3],
      ],
      STATE.DOCKED,
    ],
    [[['2.1', 9]], STATE.DOCKED], // washing the mops
    [[['2.1', 22]], STATE.DOCKED], // auto emptying
    [[['2.1', 97]], STATE.RUNNING], // running a shortcut
    [[['2.1', 14]], STATE.STOPPED], // upgrading
  ];
  for (const [entries, expected] of cases) {
    assert.equal(gladysStateOf(props(entries), true), expected, JSON.stringify(entries));
  }
});

test('idle means paused, charging, docked or stopped depending on the task and charger', () => {
  assert.equal(
    gladysStateOf(
      props([
        ['2.1', 2],
        ['4.7', 8],
      ]),
      true,
    ),
    STATE.PAUSED,
  );
  // paused for a charge, reported as a boolean by some models
  assert.equal(
    gladysStateOf(
      props([
        ['2.1', 2],
        ['4.7', 0],
        ['4.17', true],
      ]),
      true,
    ),
    STATE.PAUSED,
  );
  assert.equal(
    gladysStateOf(
      props([
        ['2.1', 2],
        ['4.7', 0],
        ['3.2', 1],
      ]),
      true,
    ),
    STATE.CHARGING,
  );
  assert.equal(
    gladysStateOf(
      props([
        ['2.1', 2],
        ['4.7', 0],
        ['3.2', 3],
      ]),
      true,
    ),
    STATE.DOCKED,
  );
  assert.equal(
    gladysStateOf(
      props([
        ['2.1', 2],
        ['4.7', 0],
        ['3.2', 2],
      ]),
      true,
    ),
    STATE.STOPPED,
  );
  // docking paused is not a task: the robot was only sent home
  assert.equal(
    gladysStateOf(
      props([
        ['2.1', 2],
        ['4.7', 11],
        ['3.2', 2],
      ]),
      true,
    ),
    STATE.STOPPED,
  );
});

test('an error code is an error, a warning code is not', () => {
  assert.equal(gladysStateOf(props([...docked, ['2.2', 12]]), true), STATE.ERROR); // main brush
  assert.equal(gladysStateOf(props([...docked, ['2.2', 121]]), true), STATE.DOCKED); // dust bag full
  assert.equal(
    gladysStateOf(
      props([
        ['2.1', 4],
        ['2.2', 0],
      ]),
      true,
    ),
    STATE.ERROR,
  );
});

test('old firmwares number their states above 18 differently', () => {
  // old 24 = auto emptying = new 22; old 19 = remote control = new 23
  assert.equal(normalizeState(24, false), 22);
  assert.equal(normalizeState(19, false), 23);
  assert.equal(normalizeState(24, true), 24);
  assert.equal(normalizeState(13, false), 13);
  assert.equal(gladysStateOf(props([['2.1', 24]]), false), STATE.DOCKED);
  assert.equal(gladysStateOf(props([['2.1', 24]]), true), STATE.CHARGING); // smart charging
});

test('an unknown or missing state publishes nothing rather than a wrong value', () => {
  assert.equal(gladysStateOf(props([['2.1', 250]]), true), null);
  assert.equal(gladysStateOf(props([]), true), null);
  assert.deepEqual(
    buildStates(ids, props([['2.1', 250]]), { newNumbering: true, language: 'fr' }),
    [],
  );
});

test('the run mode is Cleaning only while a task actively runs', () => {
  const mode = (entries) => {
    const p = props(entries);
    return runModeOf(p, gladysStateOf(p, true), true);
  };
  assert.equal(
    mode([
      ['2.1', 1],
      ['4.1', 2],
      ['4.7', 1],
    ]),
    MODE.CLEANING,
  );
  // back to the station to wash the mops, mid-task: still cleaning
  assert.equal(
    mode([
      ['2.1', 10],
      ['4.1', 2],
      ['4.7', 1],
    ]),
    MODE.CLEANING,
  );
  // paused: Idle, so choosing Cleaning again resumes it
  assert.equal(
    mode([
      ['2.1', 3],
      ['4.7', 6],
    ]),
    MODE.IDLE,
  );
  assert.equal(
    mode([
      ['2.1', 11],
      ['4.1', 21],
      ['4.7', 5],
    ]),
    MODE.MAPPING,
  );
  assert.equal(mode(docked), MODE.IDLE);
});

test('the suction level is the clean mode, like the other vacuum integrations', () => {
  const cleanMode = (suction) =>
    buildStates(ids, props([...docked, ['4.4', suction]]), {
      newNumbering: true,
      language: 'fr',
    }).find((state) => state.device_feature_external_id === ids.feature('clean-mode')).state;
  assert.equal(cleanMode(0), CLEAN.QUIET);
  assert.equal(cleanMode(1), CLEAN.AUTO);
  assert.equal(cleanMode(2), CLEAN.DEEP_CLEAN);
  assert.equal(cleanMode(3), CLEAN.VACUUM);
});

test('battery, consumables and the error text', () => {
  const states = buildStates(
    ids,
    props([...docked, ['3.1', 101], ['9.2', 87], ['11.1', -3], ['2.2', 12]]),
    {
      newNumbering: true,
      language: 'fr',
    },
  );
  const byCode = Object.fromEntries(
    states.map((state) => [state.device_feature_external_id.split(':').pop(), state]),
  );
  assert.equal(byCode.battery.state, 100); // clamped
  assert.equal(byCode['consumable-main-brush'].state, 87);
  assert.equal(byCode['consumable-filter'].state, 0);
  assert.equal(byCode.error.text, 'Brosse principale bloquée');
  const english = buildStates(ids, props([['2.2', 0]]), { newNumbering: true, language: 'en' });
  assert.equal(english[0].text, 'No error');
  const unknown = buildStates(ids, props([['2.2', 777]]), { newNumbering: true, language: 'fr' });
  assert.equal(unknown.find((state) => state.text !== undefined).text, 'Erreur 777');
  // an unknown code is still a fault
  assert.equal(
    unknown.find((state) => state.device_feature_external_id === ids.feature('state')).state,
    STATE.ERROR,
  );
});

test('a room clean is recognised while it runs or pauses', () => {
  assert.equal(
    isRoomCleaning(
      props([
        ['4.1', 18],
        ['4.7', 3],
      ]),
    ),
    true,
  );
  assert.equal(
    isRoomCleaning(
      props([
        ['4.1', 18],
        ['4.7', 8],
      ]),
    ),
    true,
  );
  assert.equal(
    isRoomCleaning(
      props([
        ['4.1', 0],
        ['4.7', 0],
      ]),
    ),
    false,
  );
});

// --- Features ------------------------------------------------------------------------

test('every feature is valid for Gladys, NOT NULL columns included', () => {
  const features = buildVacuumFeatures(
    ids,
    {
      capabilities: new Set(DISCOVERY_PROPERTIES),
      rooms: [
        { id: 3, name: 'Chambre' },
        { id: 1, name: 'Salon' },
      ],
      shortcuts: [{ id: 32, name: 'Après le dîner' }],
    },
    'fr',
  );
  const seen = new Set();
  for (const feature of features) {
    assert.ok(!seen.has(feature.external_id), `duplicate ${feature.external_id}`);
    seen.add(feature.external_id);
    assert.ok(feature.external_id.startsWith(`${ids.device}:`));
    assert.ok(CATEGORIES.has(feature.category), `${feature.external_id}: ${feature.category}`);
    assert.ok(TYPES.has(feature.type), `${feature.external_id}: ${feature.type}`);
    if (feature.unit !== undefined) {
      assert.ok(UNITS.has(feature.unit));
    }
    // A missing NOT NULL column makes "Add to Gladys" fail with a 422.
    for (const column of ['min', 'max']) {
      assert.ok(Number.isFinite(feature[column]), `${feature.external_id}: ${column}`);
    }
    for (const column of ['read_only', 'has_feedback', 'keep_history']) {
      assert.equal(typeof feature[column], 'boolean', `${feature.external_id}: ${column}`);
    }
    assert.ok(feature.name && feature.name.length <= 60, feature.name);
    // The core derives unique selectors itself and drops a published one.
    assert.equal(feature.selector, undefined);
  }
  const codes = features.map((feature) => feature.external_id.split(':').pop());
  assert.deepEqual(codes.slice(0, 10), [
    'state',
    'run-mode',
    'dock',
    'pause',
    'clean-mode',
    'battery',
    'error',
    'room',
    'shortcut-32',
    'locate',
  ]);
  assert.equal(codes.filter((code) => code.startsWith('consumable-')).length, CONSUMABLES.length);
});

test('only the supported features are published', () => {
  const features = buildVacuumFeatures(
    ids,
    { capabilities: new Set(['2.1', '3.1', '9.2']), rooms: [], shortcuts: [] },
    'en',
  );
  assert.deepEqual(
    features.map((feature) => feature.external_id.split(':').pop()),
    ['state', 'run-mode', 'dock', 'pause', 'battery', 'locate', 'consumable-main-brush'],
  );
  assert.equal(features.find((f) => f.name === 'Main brush').type, 'life-remaining');
});

test('the room selector lists the rooms after an empty choice', () => {
  const room = buildVacuumFeatures(
    ids,
    { capabilities: new Set(), rooms: [{ id: 3, name: 'Chambre' }], shortcuts: [] },
    'fr',
  ).find((feature) => feature.type === 'select');
  assert.equal(room.name, 'Pièce à nettoyer');
  assert.equal(room.has_feedback, false);
  assert.deepEqual(room.supported_options, [
    { value: 'none', label: '—', sort_order: 0 },
    { value: '3', label: 'Chambre', sort_order: 1 },
  ]);
});

// --- Commands ------------------------------------------------------------------------

test('the run mode starts (or resumes) and stops', () => {
  assert.deepEqual(buildCommand('run-mode', MODE.CLEANING, props([])), {
    kind: 'action',
    action: [2, 1],
    params: [],
  });
  assert.deepEqual(buildCommand('run-mode', MODE.IDLE, props([])).action, [4, 2]);
  assert.throws(() => buildCommand('run-mode', MODE.MAPPING, props([])), UnsupportedCommandError);
});

test('the push buttons act on a press only', () => {
  assert.deepEqual(buildCommand('dock', 1, props([])).action, [3, 1]);
  assert.deepEqual(buildCommand('pause', 1, props([])).action, [2, 2]);
  assert.deepEqual(buildCommand('locate', 1, props([])).action, [7, 1]);
  assert.equal(buildCommand('dock', 0, props([])), null);
  assert.equal(buildCommand('shortcut-32', 0, props([])), null);
});

test('the clean mode writes the suction level, and refuses what Dreame lacks', () => {
  assert.deepEqual(buildCommand('clean-mode', CLEAN.QUIET, props([])), {
    kind: 'set',
    key: '4.4',
    value: 0,
  });
  assert.equal(buildCommand('clean-mode', CLEAN.VACUUM, props([])).value, 3);
  for (const mode of [CLEAN.QUICK, CLEAN.LOW_NOISE, CLEAN.MOP]) {
    assert.throws(() => buildCommand('clean-mode', mode, props([])), UnsupportedCommandError);
  }
});

test('a room clean sends the room with the current suction and water level', () => {
  const command = buildCommand(
    'room',
    '3',
    props([
      ['4.4', 2],
      ['4.5', 1],
    ]),
  );
  assert.deepEqual(command.action, [4, 1]);
  assert.deepEqual(command.params, [
    { piid: 1, value: 18 },
    { piid: 10, value: '{"selects":[[3,1,2,1,1]]}' },
  ]);
  assert.equal(buildCommand('room', 'none', props([])), null);
  assert.throws(() => buildCommand('room', 'kitchen', props([])), UnsupportedCommandError);
});

test('self-washing stations keep the water level in the cleaning mode', () => {
  // mop humidity 3 in the third byte of 4.23, the station status present
  assert.equal(
    waterLevelOf(
      props([
        ['4.23', (3 << 16) | (20 << 8) | 1],
        ['4.25', 0],
        ['4.5', 1],
      ]),
    ),
    3,
  );
  assert.equal(
    waterLevelOf(
      props([
        ['4.23', 1],
        ['4.5', 1],
      ]),
    ),
    1,
  );
  assert.equal(waterLevelOf(props([])), 2);
});

test('a shortcut starts with its id, keeping everything saved in the app', () => {
  assert.deepEqual(buildCommand('shortcut-33', 1, props([])).params, [
    { piid: 1, value: 25 },
    { piid: 10, value: '33' },
  ]);
});

test('a read-only feature cannot be controlled', () => {
  assert.throws(() => buildCommand('battery', 50, props([])), UnsupportedCommandError);
});
