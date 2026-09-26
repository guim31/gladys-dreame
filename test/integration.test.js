// The integration logic against the fake Dreamehome cloud and its MQTT broker,
// in process, with an in-memory SDK stub: discovery, publication rules, the
// real-time loop, commands, the room selector and a refused session.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as mqttLibrary from 'mqtt';

import { DreameCloud, hashPassword } from '../src/dreame/cloud.js';
import { DreameIntegration } from '../src/integration.js';
import { CONFIG_KEYS } from '../src/session.js';
import { ACCOUNT, ROBOT, startFakeDreame } from './helpers/fakeDreame.js';
import { createFakeGladys, silentLogger } from './helpers/fakeGladys.js';
import { waitUntil } from './helpers/fakeGladysHost.js';

// The fake broker speaks plain MQTT; the real one is TLS.
const plainMqtt = {
  connect: (url, options) => mqttLibrary.connect(url.replace('mqtts://', 'mqtt://'), options),
};

function setup(fake, config, timings = {}) {
  const gladys = createFakeGladys({ config });
  const dreame = new DreameIntegration({
    gladys,
    logger: silentLogger,
    dataDir: mkdtempSync(path.join(tmpdir(), 'gladys-dreame-')),
    mqtt: plainMqtt,
    createCloud: (options) => new DreameCloud({ ...options, baseUrl: fake.base }),
    timings: { REFRESH_AFTER_COMMAND_MS: [], ...timings },
  });
  return { gladys, dreame };
}

const storedSession = () => ({
  [CONFIG_KEYS.USERNAME]: ACCOUNT.username,
  [CONFIG_KEYS.REGION]: 'eu',
  [CONFIG_KEYS.PASSWORD_HASH]: hashPassword(ACCOUNT.password),
  [CONFIG_KEYS.REFRESH_TOKEN]: 'refresh-1',
});

const code = (externalId) => externalId.split(':').pop();

test('a linked account, from discovery to commands', async (t) => {
  const fake = await startFakeDreame();
  const { gladys, dreame } = setup(fake, storedSession());
  t.after(async () => {
    dreame.stopAll();
    await fake.close();
  });
  const ids = gladys.externalIds('vacuum', ROBOT.did);
  const statesOf = (feature) =>
    gladys.states.filter((state) => state.device_feature_external_id === ids.feature(feature));

  await t.test('reopens the stored session and discovers the robot only', async () => {
    await dreame.onConnected();
    const devices = gladys.discovered.at(-1);
    assert.equal(devices.length, 1, 'the stick vacuum of the account is not a robot');
    const [device] = devices;
    assert.equal(device.external_id, ids.device);
    assert.equal(device.name, ROBOT.name);
    assert.equal(device.model, ROBOT.displayName);
    assert.equal(device.should_poll, true);
    assert.equal(device.poll_frequency, 60000);
    assert.deepEqual(
      device.features.map((f) => code(f.external_id)),
      [
        'state',
        'run-mode',
        'dock',
        'pause',
        'clean-mode',
        'battery',
        'error',
        'room',
        'shortcut-32',
        'shortcut-33',
        'locate',
        'consumable-main-brush',
        'consumable-side-brush',
        'consumable-filter',
        'consumable-sensor',
        'consumable-mop-pad',
      ],
    );
    // the rooms come from the encrypted map, sorted by name
    const room = device.features.find((f) => code(f.external_id) === 'room');
    assert.deepEqual(
      room.supported_options.map((option) => option.label),
      ['—', 'Chambre de Léa', 'Chambre principale 2', 'Cuisine', 'Salon'],
    );
    assert.equal(
      device.features.find((f) => code(f.external_id) === 'shortcut-32').name,
      'Raccourci - Après le dîner',
    );
    assert.deepEqual(gladys.statuses.at(-1), {
      connected: true,
      message: {
        en: `Linked account: ${ACCOUNT.username} (Europe).`,
        fr: `Compte lié : ${ACCOUNT.username} (Europe).`,
      },
    });
  });

  await t.test('publishes nothing for a robot that is not created in Gladys', async () => {
    assert.equal(gladys.states.length, 0);
    assert.equal(gladys.transports.length, 0);
  });

  await t.test('a created robot gets all its states at once, then only the changes', async () => {
    gladys.devices.push(gladys.discovered.at(-1)[0]);
    await dreame.onDeviceCreated(gladys.devices[0]);
    const byCode = Object.fromEntries(
      gladys.states.map((state) => [code(state.device_feature_external_id), state]),
    );
    assert.equal(byCode.state.state, 6); // docked, charging completed
    assert.equal(byCode['run-mode'].state, 0);
    assert.equal(byCode['clean-mode'].state, 0); // standard suction = Auto
    assert.equal(byCode.battery.state, 100);
    assert.equal(byCode.error.text, 'Aucune erreur');
    assert.equal(byCode['consumable-main-brush'].state, 87);
    // the room selector starts on "—"
    assert.equal(byCode.room.text, 'none');
    assert.deepEqual(gladys.transports.at(-1), { external_id: ids.device, transport: 'cloud' });

    const count = gladys.states.length;
    await dreame.poll(gladys.devices[0]);
    assert.equal(gladys.states.length, count, 'a poll with no change publishes nothing');
  });

  await t.test('a change pushed by the robot is published at once', async () => {
    await waitUntil(() => dreame.robots.get(ROBOT.did).channel.connected, 'the real-time channel');
    await fake.change([
      ['2.1', 1],
      ['4.1', 2],
      ['4.7', 1],
      ['3.2', 2],
    ]);
    await waitUntil(() => statesOf('state').at(-1).state === 1, 'the running state');
    assert.equal(statesOf('run-mode').at(-1).state, 1);
  });

  await t.test('commands reach the robot, whose answer comes back', async () => {
    await dreame.setValue(gladys.devices[0], { external_id: ids.feature('run-mode') }, 0);
    assert.equal(fake.state.commands.at(-1).method, 'action');
    assert.deepEqual(
      [fake.state.commands.at(-1).params.siid, fake.state.commands.at(-1).params.aiid],
      [4, 2],
    );
    await waitUntil(() => statesOf('run-mode').at(-1).state === 0, 'the robot stopping');

    await dreame.setValue(gladys.devices[0], { external_id: ids.feature('clean-mode') }, 5);
    assert.deepEqual(fake.state.commands.at(-1).params, [
      { did: ROBOT.did, siid: 4, piid: 4, value: 3 },
    ]);
    // optimistic: the confirmed value is already published
    assert.equal(statesOf('clean-mode').at(-1).state, 5);

    await assert.rejects(
      dreame.setValue(gladys.devices[0], { external_id: ids.feature('clean-mode') }, 6),
      /four suction levels/,
    );

    await dreame.setValue(gladys.devices[0], { external_id: ids.feature('shortcut-33') }, 1);
    assert.deepEqual(fake.state.commands.at(-1).params.in, [
      { piid: 1, value: 25 },
      { piid: 10, value: '33' },
    ]);
  });

  await t.test('a room clean, then the selector goes back to "—" when it is over', async () => {
    await dreame.setValue(gladys.devices[0], { external_id: ids.feature('room') }, '2');
    const clean = fake.state.commands.at(-1).params;
    assert.deepEqual([clean.siid, clean.aiid], [4, 1]);
    // suction turbo (3, set above), mop humidity 3 from the station
    assert.deepEqual(clean.in, [
      { piid: 1, value: 18 },
      { piid: 10, value: '{"selects":[[2,1,3,3,1]]}' },
    ]);
    await waitUntil(() => dreame.robots.get(ROBOT.did).roomCleaning?.started, 'the room clean');
    const resets = () => statesOf('room').filter((state) => state.text === 'none').length;
    const before = resets();
    await fake.change([
      ['4.1', 0],
      ['4.7', 0],
      ['2.1', 13],
      ['3.2', 3],
    ]);
    await waitUntil(() => resets() === before + 1, 'the room selector reset');
  });

  await t.test('the transport badge says when the real-time channel is down', async () => {
    const robot = dreame.robots.get(ROBOT.did);
    robot.channel.stop();
    robot.channel = { connected: false, isDown: () => true, stop() {}, useCredentials() {} };
    await dreame.publishTransport(robot);
    assert.equal(gladys.transports.at(-1).degraded, true);
    assert.match(gladys.transports.at(-1).message.fr, /temps réel/);
  });
});

test('a session Dreame refuses stops everything and asks to link again', async (t) => {
  const fake = await startFakeDreame();
  // only a refresh token: nothing to log in again with
  const { gladys, dreame } = setup(fake, { [CONFIG_KEYS.REFRESH_TOKEN]: 'refresh-1' });
  t.after(async () => {
    dreame.stopAll();
    await fake.close();
  });
  await dreame.onConnected();
  assert.equal(gladys.statuses.at(-1).connected, true);
  gladys.devices.push(gladys.discovered.at(-1)[0]);

  fake.state.refreshToken = 'revoked';
  fake.expireAccessToken();
  await assert.rejects(dreame.poll(gladys.devices[0]));
  assert.deepEqual(gladys.statuses.at(-1).connected, false);
  assert.match(gladys.statuses.at(-1).message.fr, /Liez à nouveau le compte/);

  // no more calls to the cloud with dead credentials
  const tokenRequests = fake.state.tokenRequests.length;
  await assert.rejects(dreame.poll(gladys.devices[0]), /Link the account again/);
  assert.equal(fake.state.tokenRequests.length, tokenRequests);
  assert.equal(dreame.robots.get(ROBOT.did).channel, null);
});

test('linking an account, then unlinking it', async (t) => {
  const fake = await startFakeDreame({ mapInAnswer: false });
  const { gladys, dreame } = setup(fake, {});
  t.after(async () => {
    dreame.stopAll();
    await fake.close();
  });
  await dreame.onConnected();
  assert.equal(gladys.statuses.at(-1).connected, false);
  assert.equal(fake.state.tokenRequests.length, 0, 'nothing is sent without an account');

  assert.match((await dreame.link({ username: '  ', password: 'x' })).fr, /Saisissez l'adresse/);
  const refused = await dreame.link({ username: ACCOUNT.username, password: 'nope', region: 'eu' });
  assert.match(refused.fr, /Dreame a refusé ces identifiants dans la région Europe/);
  assert.equal(gladys.configWrites.length, 0, 'a refused link stores nothing');

  const linked = await dreame.link({
    username: ` ${ACCOUNT.username} `,
    password: ACCOUNT.password,
    region: 'eu',
  });
  assert.equal(
    linked.fr,
    "Compte lié, 1 robot(s) trouvé(s). Ouvrez l'onglet Découverte pour les ajouter à Gladys.",
  );
  const stored = gladys.configWrites.at(-1);
  assert.equal(stored[CONFIG_KEYS.USERNAME], ACCOUNT.username);
  assert.equal(stored[CONFIG_KEYS.PASSWORD_HASH], hashPassword(ACCOUNT.password));
  assert.equal(stored[CONFIG_KEYS.REFRESH_TOKEN], 'refresh-1');
  assert.ok(
    !JSON.stringify(gladys.configWrites).includes(ACCOUNT.password),
    'the clear password is never stored',
  );
  // the map location came on the real-time channel this time
  const room = gladys.discovered.at(-1)[0].features.find((f) => code(f.external_id) === 'room');
  assert.equal(room.supported_options.length, 5);

  const unlinked = await dreame.unlink();
  assert.match(unlinked.fr, /Le compte a été délié/);
  assert.deepEqual(gladys.discovered.at(-1), []);
  assert.equal(gladys.configWrites.at(-1)[CONFIG_KEYS.PASSWORD_HASH], '');
  assert.equal(gladys.statuses.at(-1).connected, false);
});

test('the language renames the rooms and the error text', async (t) => {
  const fake = await startFakeDreame();
  const { gladys, dreame } = setup(fake, storedSession());
  t.after(async () => {
    dreame.stopAll();
    await fake.close();
  });
  await dreame.onConnected();
  gladys.devices.push(gladys.discovered.at(-1)[0]);
  await dreame.onDeviceCreated(gladys.devices[0]);
  await dreame.onConfigUpdated({ ...gladys.config, [CONFIG_KEYS.LANGUAGE]: 'en' });
  const room = gladys.discovered.at(-1)[0].features.find((f) => code(f.external_id) === 'room');
  assert.deepEqual(
    room.supported_options.map((option) => option.label),
    ['—', 'Chambre de Léa', 'Kitchen', 'Living room', 'Primary bedroom 2'],
  );
  assert.equal(gladys.states.at(-1).text, 'No error');
});
