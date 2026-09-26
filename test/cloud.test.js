import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTH_FAILURE,
  DreameAuthError,
  DreameCloud,
  hashPassword,
  iotNodeOf,
} from '../src/dreame/cloud.js';
import { ACCOUNT, ROBOT, startFakeDreame } from './helpers/fakeDreame.js';

const robotOf = (fake) => ({
  did: ROBOT.did,
  model: ROBOT.model,
  bindDomain: fake.state.bindDomain,
});

test('the password is sent the way the app sends it', () => {
  // md5("secret" + "RAylYC%fmSKp7%Tq"), computed with Python's hashlib, the
  // way the Home Assistant integration does it
  assert.equal(hashPassword('secret'), 'ab51518dc498dcac64b000f288be8ea6');
});

test('the IoT node is the first label of the bind domain', () => {
  assert.equal(iotNodeOf('10000.mt.eu.iot.dreame.tech:19973'), '10000');
  assert.equal(iotNodeOf(''), null);
  assert.equal(iotNodeOf(undefined), null);
});

test('the region picks the host', () => {
  assert.equal(
    new DreameCloud({ region: 'us', baseUrl: null }).baseUrl,
    'https://us.iot.dreame.tech:13267',
  );
  // an unknown region falls back to Europe rather than a host that does not exist
  assert.equal(
    new DreameCloud({ region: 'xx', baseUrl: null }).baseUrl,
    'https://eu.iot.dreame.tech:13267',
  );
});

test('login, device list and commands against the cloud', async (t) => {
  const fake = await startFakeDreame();
  t.after(() => fake.close());
  const sessions = [];
  const cloud = new DreameCloud({ baseUrl: fake.base, onSession: (s) => sessions.push(s) });

  await t.test('a refused login says it is about the credentials', async () => {
    await assert.rejects(cloud.login(ACCOUNT.username, 'wrong'), (err) => {
      assert.ok(err instanceof DreameAuthError);
      assert.equal(err.reason, AUTH_FAILURE.CREDENTIALS);
      return true;
    });
  });

  await t.test('the password grant carries the hashed password, form-encoded', async () => {
    await cloud.login(ACCOUNT.username, ACCOUNT.password);
    const { form, appHeaders } = fake.state.tokenRequests.at(-1);
    assert.ok(appHeaders, 'the app client, user agent and tenant are presented');
    assert.equal(form.get('grant_type'), 'password');
    assert.equal(form.get('platform'), 'IOS');
    assert.equal(form.get('scope'), 'all');
    assert.equal(form.get('type'), 'account');
    // the `+` of the address survived the encoding
    assert.equal(form.get('username'), ACCOUNT.username);
    assert.equal(form.get('password'), hashPassword(ACCOUNT.password));
    assert.equal(cloud.uid, ACCOUNT.uid);
    // what is persisted can reopen the session, and never holds the password
    const session = sessions.at(-1);
    assert.equal(session.refreshToken, 'refresh-1');
    assert.equal(session.passwordHash, hashPassword(ACCOUNT.password));
    assert.ok(!JSON.stringify(session).includes(ACCOUNT.password));
  });

  await t.test('lists the devices of the account', async () => {
    const records = await cloud.listDevices();
    assert.deepEqual(
      records.map((record) => record.model),
      [ROBOT.model, 'dreame.hold.w2422'],
    );
  });

  await t.test('an expired token is renewed with the refresh token, once', async () => {
    const before = fake.state.tokenRequests.length;
    fake.expireAccessToken();
    await cloud.listDevices();
    const grants = fake.state.tokenRequests.slice(before).map((r) => r.form.get('grant_type'));
    assert.deepEqual(grants, ['refresh_token']);
  });

  await t.test('a dead refresh token falls back to the stored password hash', async () => {
    const before = fake.state.tokenRequests.length;
    fake.state.refreshToken = 'rotated-by-dreame';
    fake.expireAccessToken();
    await cloud.listDevices();
    const grants = fake.state.tokenRequests.slice(before).map((r) => r.form.get('grant_type'));
    assert.deepEqual(grants, ['refresh_token', 'password']);
    assert.equal(cloud.refreshToken, 'rotated-by-dreame');
  });

  await t.test('without a hash, a dead session asks to link again', async () => {
    const orphan = new DreameCloud({ baseUrl: fake.base, refreshToken: 'long-gone' });
    await assert.rejects(orphan.listDevices(), (err) => {
      assert.equal(err.reason, AUTH_FAILURE.SESSION_EXPIRED);
      return true;
    });
  });

  await t.test('properties are read by batches of 15, on the robot node', async () => {
    const keys = ['2.1', '3.1', ...Array.from({ length: 20 }, (_, i) => `99.${i + 1}`)];
    const before = fake.state.commands.length;
    const values = await cloud.getProperties(robotOf(fake), keys);
    const calls = fake.state.commands.slice(before);
    assert.deepEqual(
      calls.map((call) => call.params.length),
      [15, 7],
    );
    assert.equal(calls[0].path, '/dreame-iot-com-127/device/sendCommand');
    assert.equal(calls[0].method, 'get_properties');
    // a property the robot lacks is simply absent
    assert.deepEqual(
      [...values.entries()],
      [
        ['2.1', 13],
        ['3.1', 100],
      ],
    );
  });

  await t.test('writes a property and runs an action with the robot id', async () => {
    await cloud.setProperty(robotOf(fake), '4.4', 3);
    const write = fake.state.commands.at(-1);
    assert.equal(write.method, 'set_properties');
    assert.deepEqual(write.params, [{ did: ROBOT.did, siid: 4, piid: 4, value: 3 }]);

    const result = await cloud.action(robotOf(fake), [3, 1]);
    assert.equal(result.code, 0);
    assert.deepEqual(fake.state.commands.at(-1).params, {
      did: ROBOT.did,
      siid: 3,
      aiid: 1,
      in: [],
    });
  });

  await t.test('a refused write is an error, not a silent no-op', async () => {
    await assert.rejects(cloud.setProperty(robotOf(fake), '99.9', 1), /refused/);
  });
});
