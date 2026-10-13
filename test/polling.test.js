// The safety-net refresh runs on the integration's own timer (Gladys 5.2.0 may
// never poll a robot, GladysAssistant/Gladys#3198), the Gladys poll stays as a
// fallback without doubling the work, and a normal round writes nothing at the
// info level; a robot that stops answering is logged once, and once when it
// answers again.

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
import { createFakeGladys } from './helpers/fakeGladys.js';
import { waitUntil } from './helpers/fakeGladysHost.js';

const plainMqtt = {
  connect: (url, options) => mqttLibrary.connect(url.replace('mqtts://', 'mqtt://'), options),
};

function recordingLogger() {
  const lines = [];
  const at = (level) => (message) => lines.push({ level, message: String(message) });
  return {
    lines,
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
  };
}

async function start(timings) {
  const fake = await startFakeDreame();
  const logger = recordingLogger();
  const gladys = createFakeGladys({
    config: {
      [CONFIG_KEYS.USERNAME]: ACCOUNT.username,
      [CONFIG_KEYS.REGION]: 'eu',
      [CONFIG_KEYS.PASSWORD_HASH]: hashPassword(ACCOUNT.password),
      [CONFIG_KEYS.REFRESH_TOKEN]: 'refresh-1',
    },
  });
  const dreame = new DreameIntegration({
    gladys,
    logger,
    dataDir: mkdtempSync(path.join(tmpdir(), 'gladys-dreame-poll-')),
    mqtt: plainMqtt,
    createCloud: (options) => new DreameCloud({ ...options, baseUrl: fake.base }),
    timings: { REFRESH_AFTER_COMMAND_MS: [], ...timings },
  });
  await dreame.onConnected();
  gladys.devices.push(gladys.discovered.at(-1)[0]);
  await dreame.onDeviceCreated(gladys.devices[0]);
  const robot = dreame.robots.get(ROBOT.did);
  await waitUntil(() => robot.channel && robot.channel.connected, 'the real-time channel');
  const reads = () => fake.state.commands.filter((c) => c.method === 'get_properties').length;
  return { fake, logger, gladys, dreame, robot, reads };
}

test('the robots are refreshed by the own timer, the Gladys poll only as a fallback', async (t) => {
  const { fake, gladys, dreame, robot, reads } = await start({ POLL_MS: 150, FRESH_MS: 100 });
  t.after(async () => {
    dreame.stopAll();
    await fake.close();
  });

  await t.test('without any Gladys poll, the robot is refreshed', async () => {
    const before = reads();
    await waitUntil(() => reads() >= before + 2, 'two timer refreshes');
    assert.ok(robot.refreshedAt > 0);
  });

  await t.test('a Gladys poll right after a refresh does not read the robot again', async () => {
    dreame.stopAll();
    robot.refreshedAt = Date.now();
    const before = reads();
    await dreame.poll(gladys.devices[0]);
    assert.equal(reads(), before);
  });

  await t.test('a Gladys poll once the last refresh is old reads the robot', async () => {
    robot.refreshedAt = Date.now() - 1000;
    const before = reads();
    await dreame.poll(gladys.devices[0]);
    assert.ok(reads() > before);
  });

  await t.test('the timer skips a robot the Gladys poll just refreshed', async () => {
    robot.refreshedAt = Date.now();
    const before = reads();
    await dreame.pollAll();
    assert.equal(reads(), before);
  });

  await t.test('a robot not created in Gladys is not refreshed', async () => {
    robot.refreshedAt = 0;
    const created = gladys.devices.splice(0);
    const before = reads();
    await dreame.pollAll();
    assert.equal(reads(), before);
    gladys.devices.push(...created);
  });

  await t.test('stopAll stops the timer', () => {
    assert.equal(dreame.pollTimer, null);
  });
});

test('the default cadence is the 60 s of the published devices', async () => {
  const { TIMINGS } = await import('../src/integration.js');
  assert.equal(TIMINGS.POLL_MS, 60000);
  assert.ok(TIMINGS.FRESH_MS > 0 && TIMINGS.FRESH_MS < TIMINGS.POLL_MS);
});

test('a normal round writes nothing at the info level', async (t) => {
  const { fake, logger, gladys, dreame, robot, reads } = await start({
    POLL_MS: 100,
    FRESH_MS: 50,
  });
  t.after(async () => {
    dreame.stopAll();
    await fake.close();
  });
  const startup = logger.lines.length;

  // timer refreshes, a Gladys poll, a change pushed by the robot, a rediscovery
  const before = reads();
  await waitUntil(() => reads() >= before + 3, 'three timer refreshes');
  robot.refreshedAt = 0;
  await dreame.poll(gladys.devices[0]);
  await fake.change([['3.1', 99]]);
  await waitUntil(
    () =>
      gladys.states.some(
        (s) => s.device_feature_external_id.endsWith(':battery') && s.state === 99,
      ),
    'the pushed battery level',
  );
  await dreame.discover();

  const noisy = logger.lines
    .slice(startup)
    .filter((line) => line.level !== 'debug')
    .map((line) => `${line.level}: ${line.message}`);
  assert.deepEqual(noisy, []);
  for (const line of logger.lines) {
    for (const secret of [ACCOUNT.username, ACCOUNT.password, ACCOUNT.uid, ROBOT.did]) {
      assert.ok(!line.message.includes(secret), `a log line gives away ${secret}: ${line.message}`);
    }
  }
});

test('a robot that stops answering is logged once, and once when it is back', async (t) => {
  const { fake, logger, dreame, robot } = await start({ POLL_MS: 60 * 60 * 1000, FRESH_MS: 0 });
  t.after(async () => {
    dreame.stopAll();
    await fake.close();
  });
  const startup = logger.lines.length;
  const loud = () =>
    logger.lines.slice(startup).filter((line) => line.level === 'warn' || line.level === 'info');

  fake.state.offline = true;
  for (let i = 0; i < 3; i += 1) {
    await dreame.pollAll();
  }
  assert.equal(robot.reachable, false);
  assert.equal(loud().length, 1);
  assert.equal(loud()[0].level, 'warn');
  assert.match(loud()[0].message, /does not answer/);

  fake.state.offline = false;
  await dreame.pollAll();
  await dreame.pollAll();
  assert.equal(robot.reachable, true);
  assert.equal(loud().length, 2);
  assert.equal(loud()[1].level, 'info');
  assert.match(loud()[1].message, /answers again/);
});
