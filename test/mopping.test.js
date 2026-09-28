import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  UnsupportedCommandError,
  buildCommand,
  buildStates,
  buildVacuumFeatures,
  washValuesOf,
} from '../src/devices/vacuum.js';
import { modelCapabilities } from '../src/dreame/models.js';
import { cleaningModeOf, moppingOf, splitGroup, washLimits } from '../src/dreame/mopping.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

const ids = createFakeGladys().externalIds('vacuum', '42');
// `siid.piid` keys as strings, in pairs (see vacuum.test.js).
const props = (entries) => new Map(entries);
const settings = (entries) => JSON.stringify(entries.map(([k, v]) => ({ k, v })));

// The robot of the first tester: a dreame.vacuum.r2449a whose app showed
// "Mop" with a wash every 15 m² when 4.23 was 3841, "Vacuum" at 3842.
const R2449A = modelCapabilities('dreame.vacuum.r2449a', '4.3.9_1771');
const answered = new Set(['4.4', '4.23', '4.25', '4.26', '4.50', '28.1']);
const mopping = moppingOf(
  R2449A,
  answered,
  new Set(['BackWashType', 'SuctionMax', 'CleanRoute', 'LessColl']),
);
const robot = (entries) =>
  props([
    ['4.23', 3841],
    ['4.25', 2],
    ['4.26', 0],
    ['28.1', 25],
    [
      '4.50',
      settings([
        ['BackWashType', 1],
        ['SuctionMax', 0],
        ['CleanRoute', 1],
      ]),
    ],
    ...entries,
  ]);
const command = (code, value, entries = [], context = {}) =>
  buildCommand(code, value, robot(entries), { mopping, ...context });

test('the model table says how a robot stores its mop settings', () => {
  for (const flag of [
    'mopPadLifting',
    'wetnessLevel',
    'selfCleanFrequency',
    'maxSuctionPower',
    'moppingAfterSweeping',
    'gen5',
  ]) {
    assert.ok(R2449A.flags.has(flag), flag);
  }
  assert.ok(!R2449A.flags.has('onboardWetnessLevel'));
  assert.equal(modelCapabilities('dreame.vacuum.x9999z'), null);
  assert.equal(moppingOf(null, answered, new Set()).cleaningMode, false);
});

test('4.23 groups the mode, the washing value and the water level', () => {
  assert.deepEqual(splitGroup(3841), { mode: 1, wash: 15, water: 0 });
  assert.deepEqual(splitGroup((2 << 16) | (20 << 8) | 3), { mode: 3, wash: 20, water: 2 });
  assert.equal(splitGroup(undefined), null);
});

test('the cleaning mode reads the lifting mops numbering', () => {
  const mode = (value, custom = 0) =>
    cleaningModeOf(
      robot([
        ['4.23', value],
        ['4.26', custom],
      ]),
      mopping,
    );
  assert.equal(mode(3841), 'mopping');
  assert.equal(mode(3842), 'sweeping');
  assert.equal(mode(3840), 'sweeping-and-mopping');
  assert.equal(mode(3843), 'mopping-after-sweeping');
  assert.equal(mode(3842, 1), 'custom');
  assert.equal(mode(undefined), null);
});

test('setting the cleaning mode only changes the mode bits', () => {
  assert.deepEqual(command('cleaning-mode', 'sweeping').writes, [{ key: '4.23', value: 3842 }]);
  assert.deepEqual(command('cleaning-mode', 'mopping-after-sweeping').writes, [
    { key: '4.23', value: 3843 },
  ]);
  // Room-by-room settings are left, as in the app.
  assert.deepEqual(command('cleaning-mode', 'mopping', [['4.26', 1]]).writes, [
    { key: '4.26', value: 0 },
    { key: '4.23', value: 3841 },
  ]);
  assert.deepEqual(command('cleaning-mode', 'custom').writes, [{ key: '4.26', value: 1 }]);
  assert.throws(() => command('cleaning-mode', 'turbo'), UnsupportedCommandError);
  assert.throws(
    () => buildCommand('cleaning-mode', 'sweeping', robot([]), {}),
    UnsupportedCommandError,
  );
});

test('a sweeping mode falls back on a route it can take', () => {
  const deepRoute = [
    '4.50',
    settings([
      ['BackWashType', 1],
      ['CleanRoute', 3],
    ]),
  ];
  assert.deepEqual(command('cleaning-mode', 'sweeping', [deepRoute]).writes, [
    { key: '4.23', value: 3842 },
    { key: '4.50', value: '{"k":"CleanRoute","v":1}' },
  ]);
  assert.throws(() => command('route', 'deep', [['4.23', 3842]]), UnsupportedCommandError);
  assert.deepEqual(command('route', 'deep').writes, [
    { key: '4.50', value: '{"k":"CleanRoute","v":3}' },
  ]);
  assert.deepEqual(command('route', 'quick', [['4.23', 3842]]).writes, [
    { key: '4.50', value: '{"k":"CleanRoute","v":4}' },
  ]);
});

test('the max suction boost is a switch, ended by a suction level', () => {
  const boosted = [
    '4.50',
    settings([
      ['SuctionMax', 1],
      ['CleanRoute', 1],
    ]),
  ];
  const state = (entries) =>
    buildStates(ids, robot(entries), { newNumbering: true, language: 'fr', mopping }).find(
      (s) => s.device_feature_external_id === ids.feature('max-suction'),
    ).state;
  assert.equal(state([]), 0);
  assert.equal(state([boosted]), 1);
  assert.deepEqual(command('max-suction', 1).writes, [
    { key: '4.50', value: '{"k":"SuctionMax","v":1}' },
  ]);
  assert.deepEqual(command('suction', 'turbo', [boosted]).writes, [
    { key: '4.50', value: '{"k":"SuctionMax","v":0}' },
    { key: '4.4', value: 3 },
  ]);
});

test('the wetness keeps the washing frequency within its bounds', () => {
  assert.deepEqual(command('wetness', 12).writes, [{ key: '28.1', value: 12 }]);
  assert.deepEqual(command('wetness', 40).writes, [{ key: '28.1', value: 32 }]);
  // Wet mops (above 26) are washed every 20 m² at most.
  assert.deepEqual(command('wetness', 30, [['4.23', (30 << 8) | 1]]).writes, [
    { key: '28.1', value: 30 },
    { key: '4.23', value: (20 << 8) | 1 },
  ]);
  assert.deepEqual(washLimits(mopping, null), {
    area: { min: 10, max: 35, default: 20 },
    time: { min: 10, max: 50, default: 25 },
  });
});

test('the washing frequency writes its value with it', () => {
  assert.deepEqual(command('mop-wash-frequency', 'by-room').writes, [
    { key: '4.50', value: '{"k":"BackWashType","v":3}' },
    { key: '4.23', value: 1 },
  ]);
  // No time known yet: the default one.
  assert.deepEqual(command('mop-wash-frequency', 'by-time').writes, [
    { key: '4.50', value: '{"k":"BackWashType","v":2}' },
    { key: '4.23', value: (25 << 8) | 1 },
  ]);
  assert.deepEqual(
    command('mop-wash-frequency', 'by-area', [], { washValues: { area: 30 } }).writes,
    [
      { key: '4.50', value: '{"k":"BackWashType","v":1}' },
      { key: '4.23', value: (30 << 8) | 1 },
    ],
  );
});

test('each washing slider acts on its own frequency, and is kept for later otherwise', () => {
  assert.deepEqual(command('mop-wash-area', 40), {
    kind: 'writes',
    writes: [{ key: '4.23', value: (35 << 8) | 1 }],
    remember: { area: 35 },
  });
  assert.deepEqual(command('mop-wash-time', 30), {
    kind: 'writes',
    writes: [],
    remember: { time: 30 },
  });
  assert.deepEqual(washValuesOf(robot([]), mopping, { time: 30 }), { area: 15, time: 30 });
  const states = buildStates(ids, robot([]), {
    newNumbering: true,
    language: 'fr',
    mopping,
    washValues: { area: 15, time: 30 },
  });
  const value = (code) =>
    states.find((s) => s.device_feature_external_id === ids.feature(code)) || {};
  assert.equal(value('mop-wash-area').state, 15);
  assert.equal(value('mop-wash-time').state, 30);
  assert.equal(value('mop-wash-frequency').text, 'by-area');
  assert.equal(value('cleaning-mode').text, 'mopping');
  assert.equal(value('wetness').state, 25);
});

test('several rooms are cleaned from the rooms picked, in the order of the map', () => {
  const rooms = [{ id: 3 }, { id: 1 }, { id: 5 }];
  const picks = new Set(['5', '3']);
  assert.deepEqual(command('room-pick-1', 1), { kind: 'pick', room: '1', on: true });
  assert.deepEqual(command('room-pick-1', 0), { kind: 'pick', room: '1', on: false });
  const clean = command('clean-rooms', 1, [['4.4', 2]], { rooms, picks });
  assert.deepEqual(clean.action, [4, 1]);
  assert.deepEqual(JSON.parse(clean.params[1].value), {
    selects: [
      [3, 1, 2, 2, 1],
      [5, 1, 2, 2, 1],
    ],
  });
  // Older robots number the entries.
  const older = buildCommand('clean-rooms', 1, props([['4.4', 1]]), { rooms, picks });
  assert.deepEqual(
    JSON.parse(older.params[1].value).selects.map((entry) => entry[4]),
    [1, 2],
  );
  assert.equal(command('clean-rooms', 0, [], { rooms, picks }), null);
  assert.throws(
    () => command('clean-rooms', 1, [], { rooms, picks: new Set() }),
    UnsupportedCommandError,
  );
  const states = buildStates(ids, props([]), {
    newNumbering: true,
    language: 'fr',
    rooms,
    picks,
  });
  assert.deepEqual(
    states.map((s) => [s.device_feature_external_id.split(':').pop(), s.state]),
    [
      ['room-pick-3', 1],
      ['room-pick-1', 0],
      ['room-pick-5', 1],
    ],
  );
});

test('the mop settings are published as the app lists them', () => {
  const features = buildVacuumFeatures(
    ids,
    {
      capabilities: answered,
      rooms: [{ id: 3, name: 'Chambre' }],
      hasRoute: true,
      settingKeys: new Set(['BackWashType', 'SuctionMax', 'CleanRoute']),
      mopping,
    },
    'fr',
  );
  const byCode = new Map(features.map((f) => [f.external_id.split(':').pop(), f]));
  assert.deepEqual([...byCode.keys()].slice(4, 14), [
    'cleaning-mode',
    'suction',
    'max-suction',
    'wetness',
    'mop-wash-frequency',
    'mop-wash-area',
    'mop-wash-time',
    'route',
    'room',
    'room-pick-3',
  ]);
  assert.deepEqual(
    byCode.get('cleaning-mode').supported_options.map((option) => option.label),
    [
      'Aspiration',
      'Lavage du sol',
      'Aspiration et lavage du sol',
      'Lavage du sol après aspiration',
      'Personnaliser le nettoyage des pièces',
    ],
  );
  assert.deepEqual(
    byCode.get('mop-wash-frequency').supported_options.map((option) => option.label),
    ['Par zone', 'Par heure', 'Par pièce'],
  );
  assert.equal(byCode.get('max-suction').name, "Puissance d'aspiration maximale");
  assert.equal(byCode.get('route').name, 'Itinéraire');
  const wetness = byCode.get('wetness');
  assert.deepEqual([wetness.type, wetness.min, wetness.max], ['dimmer', 1, 32]);
  const area = byCode.get('mop-wash-area');
  assert.deepEqual([area.unit, area.min, area.max], ['square-meter', 10, 35]);
  const time = byCode.get('mop-wash-time');
  assert.deepEqual([time.unit, time.min, time.max], ['minutes', 10, 50]);
  assert.equal(byCode.get('room-pick-3').name, 'Sélection - Chambre');
  assert.equal(byCode.get('clean-rooms').type, 'push');
});
