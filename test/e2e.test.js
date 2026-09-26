// End-to-end: boots the real index.js against a fake Gladys host (REST +
// WebSocket) and the fake Dreamehome cloud (HTTP + MQTT broker), and drives it
// the way the Gladys UI does: link the account from the action, add the robot
// from the Discovery screen, watch its states, send commands, run the
// diagnostic, unlink.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONFIG_KEYS } from '../src/session.js';
import { ACCOUNT, ROBOT, startFakeDreame } from './helpers/fakeDreame.js';
import { TOKEN, startFakeGladysHost, waitUntil } from './helpers/fakeGladysHost.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELECTOR = 'dreame-e2e';
const DEVICE = `ext:${SELECTOR}:vacuum:${ROBOT.did}`;

test('the integration, driven like the Gladys UI drives it', async (t) => {
  const fake = await startFakeDreame();
  const gladys = await startFakeGladysHost({ [CONFIG_KEYS.LANGUAGE]: 'fr' });
  let output = '';
  const child = spawn(process.execPath, ['index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      GLADYS_HOST_API_URL: `http://127.0.0.1:${gladys.port}`,
      GLADYS_INTEGRATION_TOKEN: TOKEN,
      GLADYS_INTEGRATION_SELECTOR: SELECTOR,
      DREAME_API_BASE: fake.base,
      DREAME_MQTT_PROTOCOL: 'mqtt',
      DREAME_DATA_DIR: mkdtempSync(path.join(tmpdir(), 'gladys-dreame-e2e-')),
      LOG_LEVEL: 'debug',
    },
  });
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  t.after(async () => {
    child.kill('SIGKILL');
    await gladys.close();
    await fake.close();
  });
  const wait = (predicate, what) => waitUntil(predicate, `${what}\n--- output ---\n${output}`);
  const command = (type, payload) => gladys.command(type, payload, wait);
  const action = (key, fields) => command('external-integration.action.run', { key, fields });
  const feature = (code) => `${DEVICE}:${code}`;
  const published = () => gladys.state.statePosts.flat();
  const lastState = (code) =>
    published()
      .filter((state) => state.device_feature_external_id === feature(code))
      .at(-1);

  await t.test('starts unlinked, and says so', async () => {
    await wait(() => gladys.state.connectionStatusPosts.length > 0, 'the first status');
    assert.equal(gladys.state.connectionStatusPosts.at(-1).connected, false);
    assert.equal(fake.state.tokenRequests.length, 0);
  });

  await t.test('links the account from the action', async () => {
    const result = await action('dreame_link', {
      username: ACCOUNT.username,
      password: ACCOUNT.password,
      region: 'eu',
    });
    assert.equal(result.success, true, result.error);
    assert.match(result.data.message.fr, /Compte lié, 1 robot\(s\) trouvé\(s\)/);
    const devices = gladys.state.discoveredDevicePosts.at(-1);
    assert.equal(devices.length, 1);
    assert.equal(devices[0].external_id, DEVICE);
    assert.equal(gladys.state.connectionStatusPosts.at(-1).connected, true);
    assert.ok(!output.includes(ACCOUNT.password), 'the password never reaches the logs');
  });

  await t.test('the robot added from the Discovery screen gets its states', async () => {
    gladys.createDevice(gladys.state.discoveredDevicePosts.at(-1)[0]);
    await wait(() => lastState('state') !== undefined, 'the first states');
    assert.equal(lastState('state').state, 6);
    assert.equal(lastState('battery').state, 100);
    assert.equal(lastState('error').text, 'Aucune erreur');
    await wait(() => gladys.state.transportPosts.length > 0, 'the transport badge');
    assert.deepEqual(gladys.state.transportPosts.flat().at(-1), {
      device_external_id: DEVICE,
      transport: 'cloud',
    });
  });

  await t.test('starting from Gladys, the robot state follows in real time', async () => {
    const result = await command('external-integration.device.set-value', {
      device: { external_id: DEVICE },
      device_feature: {
        external_id: feature('run-mode'),
        category: 'vacuum-cleaner',
        type: 'run-mode',
      },
      value: 1,
    });
    assert.equal(result.success, true, result.error);
    assert.deepEqual(
      [fake.state.commands.at(-1).params.siid, fake.state.commands.at(-1).params.aiid],
      [2, 1],
    );
    await wait(() => lastState('state').state === 1, 'the running state pushed by the robot');
    assert.equal(lastState('run-mode').state, 1);
  });

  await t.test('back to the dock', async () => {
    const result = await command('external-integration.device.set-value', {
      device: { external_id: DEVICE },
      device_feature: { external_id: feature('dock'), category: 'vacuum-cleaner', type: 'dock' },
      value: 1,
    });
    assert.equal(result.success, true, result.error);
    await wait(() => lastState('state').state === 4, 'the returning state');
  });

  await t.test('an unsupported command is refused with a readable error', async () => {
    const result = await command('external-integration.device.set-value', {
      device: { external_id: DEVICE },
      device_feature: {
        external_id: feature('clean-mode'),
        category: 'vacuum-cleaner',
        type: 'clean-mode',
      },
      value: 6,
    });
    assert.equal(result.success, false);
    assert.match(result.error, /four suction levels/);
  });

  await t.test('a poll answers', async () => {
    const result = await command('external-integration.device.poll', {
      device: { external_id: DEVICE },
    });
    assert.equal(result.success, true, result.error);
  });

  await t.test('the diagnostic is complete and gives nothing away', async () => {
    const result = await action('dreame_diagnostic', {});
    assert.equal(result.success, true, result.error);
    const report = result.data.message;
    assert.match(report, /Robot 1: dreame\.vacuum\.r2416 \(known model\)/);
    assert.match(report, /Firmware: 4\.3\.9_1450; state numbering: new/);
    assert.match(report, /Real-time channel: connected/);
    assert.match(report, /Rooms: 4 \(types 1,4,0,2; 1 with a custom name\)/);
    assert.match(report, /Map: map decoded/);
    for (const secret of [ACCOUNT.username, ROBOT.did, ACCOUNT.uid, 'AA:BB', 'Léa', 'dîner']) {
      assert.ok(!report.includes(secret), `the report leaks ${secret}`);
    }
  });

  await t.test('unlinking forgets the account', async () => {
    const result = await action('dreame_unlink', {});
    assert.equal(result.success, true, result.error);
    assert.deepEqual(gladys.state.discoveredDevicePosts.at(-1), []);
    assert.equal(gladys.state.config[CONFIG_KEYS.REFRESH_TOKEN], '');
    assert.equal(gladys.state.config[CONFIG_KEYS.PASSWORD_HASH], '');
  });
});
