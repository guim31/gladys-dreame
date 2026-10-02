// Small modules: model table, shortcuts, session keys, real-time channel
// helpers, robot cache.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

import {
  firmwareBuild,
  isKnownModel,
  mapIvFor,
  modelKey,
  usesNewStateNumbering,
} from '../src/dreame/models.js';
import { mergeSettings, parseSettings } from '../src/dreame/settings.js';
import { parseShortcuts } from '../src/dreame/shortcuts.js';
import {
  DreameMqttChannel,
  brokerOf,
  propertyChangesOf,
  randomAgentId,
} from '../src/dreame/mqtt.js';
import {
  CONFIG_KEYS,
  clearedSessionConfig,
  isSessionUsable,
  readLanguage,
  readSession,
  sessionToConfig,
} from '../src/session.js';
import { RobotStore } from '../src/store.js';
import { silentLogger } from './helpers/fakeGladys.js';

// --- Model table ---------------------------------------------------------------------

test('the model table gives the map IV of a known model, a best guess otherwise', () => {
  assert.equal(modelKey('dreame.vacuum.r2228o'), 'r2228o');
  assert.ok(isKnownModel('dreame.vacuum.r2228o'));
  assert.deepEqual(mapIvFor('dreame.vacuum.p2114a'), { iv: '6PFiLPYMHLylp7RR', guessed: false });
  const guess = mapIvFor('dreame.vacuum.r9999z');
  assert.equal(guess.guessed, true);
  assert.equal(guess.iv.length, 16);
});

test('the state numbering follows the model and its firmware build', () => {
  assert.equal(firmwareBuild('4.3.9_1114'), 1114);
  assert.equal(firmwareBuild('4.3.9'), null);
  // p2008 (Dreame D9) predates the renumbering
  assert.equal(usesNewStateNumbering('dreame.vacuum.p2008', '1.2.3_1000'), false);
  // r2416 numbers the new way from build 1
  assert.equal(usesNewStateNumbering('dreame.vacuum.r2416', '4.3.9_1450'), true);
  // a model newer than the table is assumed recent
  assert.equal(usesNewStateNumbering('dreame.vacuum.r9999z', null), true);
  // a model that needs a minimum build: below it, the old numbering
  const table = JSON.parse(readFileSync(new URL('../src/data/models.json', import.meta.url)));
  const [build, models] = Object.entries(table.newStateFromFirmware).find(
    ([b]) => Number(b) > 1000,
  );
  const model = `dreame.vacuum.${models[0]}`;
  assert.equal(usesNewStateNumbering(model, `4.0.0_${Number(build) - 1}`), false);
  assert.equal(usesNewStateNumbering(model, `4.0.0_${build}`), true);
});

// --- Shortcuts -----------------------------------------------------------------------------

test('shortcuts are read from the robot property, names decoded', () => {
  const value = JSON.stringify([
    { id: 32, name: Buffer.from('Après le dîner').toString('base64'), state: '-1' },
    { id: 33, name: '', state: '1' }, // running
    { id: 34, name: Buffer.from('Cuisine').toString('base64'), state: '0' }, // running too
    { id: 32, name: 'ZHVw' }, // duplicate id: ignored
    { name: 'bm8gaWQ=' }, // no id: ignored
  ]);
  assert.deepEqual(parseShortcuts(value), [
    { id: 32, name: 'Après le dîner', running: false },
    { id: 33, name: '#33', running: true },
    { id: 34, name: 'Cuisine', running: true },
  ]);
  assert.deepEqual(parseShortcuts(''), []);
  assert.deepEqual(parseShortcuts('not json'), []);
  assert.deepEqual(parseShortcuts(undefined), []);
});

// --- Settings (4.50) ---------------------------------------------------------------------

test('a pushed setting is merged into the known list, a read list replaces it', () => {
  const list = JSON.stringify([
    { k: 'CleanRoute', v: 1 },
    { k: 'LessColl', v: 1 },
  ]);
  const merged = mergeSettings(list, '{"k":"CleanRoute","v":3}');
  assert.deepEqual(
    [...parseSettings(merged)],
    [
      ['CleanRoute', 3],
      ['LessColl', 1],
    ],
  );
  assert.deepEqual(
    [...parseSettings(mergeSettings(merged, '[{"k":"SmartHost","v":0}]'))],
    [['SmartHost', 0]],
  );
  assert.equal(parseSettings('garbage'), null);
  assert.equal(mergeSettings(list, 'garbage'), 'garbage');
});

// --- Session ---------------------------------------------------------------------------------

test('the session survives a round trip through the config, and can be erased', () => {
  const session = {
    username: 'a@b.fr',
    region: 'us',
    passwordHash: 'hash',
    refreshToken: 'refresh',
    tenantId: '000000',
  };
  assert.deepEqual(readSession(sessionToConfig(session)), session);
  assert.ok(isSessionUsable(session));
  const cleared = readSession(clearedSessionConfig());
  assert.equal(isSessionUsable(cleared), false);
  assert.equal(cleared.region, 'eu');
  assert.ok(Object.values(clearedSessionConfig()).every((value) => value === ''));
  assert.equal(isSessionUsable({ username: 'a@b.fr', passwordHash: 'h' }), true);
  assert.equal(isSessionUsable({ username: 'a@b.fr' }), false);
});

test('the language comes from the config, French by default', () => {
  assert.equal(readLanguage({ [CONFIG_KEYS.LANGUAGE]: 'en' }), 'en');
  assert.equal(readLanguage({ [CONFIG_KEYS.LANGUAGE]: 'de' }), 'fr');
  assert.equal(readLanguage(), 'fr');
});

// --- Real-time channel ---------------------------------------------------------------------

test('the broker, client id and topic of a robot', () => {
  const robot = {
    did: '42',
    model: 'dreame.vacuum.r2416',
    masterUid: 'UID1',
    bindDomain: '10000.mt.eu.iot.dreame.tech:19973',
  };
  const broker = brokerOf(robot, 'eu');
  assert.equal(broker.host, '10000.mt.eu.iot.dreame.tech');
  assert.equal(broker.port, 19973);
  assert.match(broker.clientId, /^p_UID1_[A-F]{13}_10000\.mt\.eu\.iot\.dreame\.tech$/);
  assert.deepEqual(broker.topics, ['/status/42/UID1/dreame.vacuum.r2416/eu/']);
  // Korean accounts: the 10000 node, and the Singapore topic too
  const korea = brokerOf({ ...robot, bindDomain: '10100.mt.kr.iot.dreame.tech:19973' }, 'kr');
  assert.equal(korea.host, '10000.mt.kr.iot.dreame.tech');
  assert.deepEqual(korea.topics, [
    '/status/42/UID1/dreame.vacuum.r2416/kr/',
    '/status/42/UID1/dreame.vacuum.r2416/sg/',
  ]);
  assert.equal(brokerOf({ ...robot, bindDomain: '' }, 'eu'), null);
  assert.match(randomAgentId(), /^[A-F]{13}$/);
});

test('only property changes are read from the broker messages', () => {
  const payload = JSON.stringify({
    data: {
      method: 'properties_changed',
      params: [
        { did: '42', siid: 2, piid: 1, value: 1 },
        { did: '42', siid: 3, piid: 1 },
      ],
    },
  });
  assert.deepEqual(propertyChangesOf(Buffer.from(payload)), [{ key: '2.1', value: 1 }]);
  assert.deepEqual(propertyChangesOf('{"data":{"method":"event_occured","params":[]}}'), []);
  assert.deepEqual(propertyChangesOf('garbage'), []);
});

test('a refused token is renewed for the next connection attempt', async () => {
  const client = new EventEmitter();
  client.options = {};
  client.subscribe = () => {};
  client.end = () => {};
  let connectedWith = null;
  const mqtt = {
    connect(url, options) {
      connectedWith = { url, options };
      client.options = { ...options };
      return client;
    },
  };
  let renewals = 0;
  const channel = new DreameMqttChannel({
    device: { did: '42', model: 'm', masterUid: 'UID1', bindDomain: 'host:1883' },
    region: 'eu',
    getCredentials: async (force) => {
      renewals += force ? 1 : 0;
      return { username: 'UID1', password: force ? 'fresh-token' : 'old-token' };
    },
    onChanges: () => {},
    mqtt,
    logger: silentLogger,
  });
  await channel.start();
  assert.equal(connectedWith.options.password, 'old-token');
  assert.equal(connectedWith.options.rejectUnauthorized, false);
  const refused = new Error('Connection refused: Not authorized');
  refused.code = 5;
  client.emit('error', refused);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(renewals, 1);
  assert.equal(client.options.password, 'fresh-token');
  // refused again right away: no second forced renewal (the broker may refuse
  // for another reason), and the next attempt waits longer
  client.emit('error', refused);
  client.emit('close');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(renewals, 1);
  assert.equal(client.options.reconnectPeriod, 20 * 1000);
  client.emit('close');
  assert.equal(client.options.reconnectPeriod, 40 * 1000);
  // not up yet, within the grace delay: not reported as down
  assert.equal(channel.isDown(60 * 1000), false);
  client.emit('connect');
  // connected: back to the first delay
  assert.equal(client.options.reconnectPeriod, 10 * 1000);
  client.emit('close');
  // it worked, then dropped: down
  assert.equal(channel.isDown(60 * 1000), true);
  channel.stop();
});

// --- Robot cache -------------------------------------------------------------------------------

test('the robot cache survives a restart and forgets the robots gone', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gladys-dreame-'));
  const store = new RobotStore(dir, silentLogger);
  store.set('1', { capabilities: ['2.1'], rooms: [], shortcuts: [] });
  store.set('2', { capabilities: ['3.1'], rooms: [], shortcuts: [] });
  const reopened = new RobotStore(dir, silentLogger);
  assert.deepEqual(reopened.get('1').capabilities, ['2.1']);
  reopened.retain(new Set(['2']));
  assert.equal(new RobotStore(dir, silentLogger).get('1'), null);
  // an unwritable directory costs the cache, nothing else (a file stands in
  // for a directory; not /proc, where Node's recursive mkdir never returns)
  const file = path.join(dir, 'robots.json');
  const broken = new RobotStore(path.join(file, 'nested'), silentLogger);
  broken.set('1', { capabilities: [], rooms: [], shortcuts: [] });
  assert.deepEqual(broken.get('1').capabilities, []);
});
