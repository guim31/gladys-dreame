// -----------------------------------------------------------------------------
// A fake Dreamehome cloud and its robot, for the tests:
//   - the OAuth token endpoint (password and refresh grants), answering the
//     errors verified against the live cloud;
//   - the device list, the MIoT command relay (`sendCommand`) and the map file
//     download, all behind the `Dreame-Auth` token;
//   - an MQTT broker (aedes) standing in for the real-time channel, which only
//     accepts the current access token, and on which the robot pushes its
//     property changes.
// The robot reacts to the actions like a real one would (start -> sweeping,
// dock -> returning...) and pushes the changes, so the tests see the whole loop.
// -----------------------------------------------------------------------------

import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { Aedes } from 'aedes';

import { hashPassword } from '../../src/dreame/cloud.js';
import { mapIvFor } from '../../src/dreame/models.js';
import { mergeSettings } from '../../src/dreame/settings.js';
import { buildMapFrame, segment } from './mapFrame.js';

export const ACCOUNT = {
  // a `+` and a space, to check the form encoding
  username: 'robot.owner+gladys@example.com',
  password: 'correct horse',
  uid: 'UID4242',
  tenantId: '000000',
};

export const ROBOT = {
  did: '1098765432',
  model: 'dreame.vacuum.r2416',
  name: 'Robot du salon',
  displayName: 'Dreame L20 Ultra',
  firmware: '4.3.9_1450',
};

export const MAP_KEY = 'aXk3pQ9wZr';
export const ROOMS = {
  1: segment({ type: 1 }), // Salon
  2: segment({ type: 4 }), // Cuisine
  3: segment({ type: 0, name: 'Chambre de Léa' }),
  4: segment({ type: 2, index: 1 }), // Chambre principale 2
};

export const SHORTCUTS = [
  { id: 32, name: Buffer.from('Après le dîner').toString('base64'), state: '-1' },
  { id: 33, name: Buffer.from('Cuisine seule').toString('base64'), state: '-1' },
];

export function initialProperties() {
  // `siid.piid` keys as strings: in an object literal, Prettier would unquote
  // them into numbers, and a key like 4.10 would silently become 4.1.
  return new Map([
    ['2.1', 13], // charging completed
    ['2.2', 0],
    ['3.1', 100],
    ['3.2', 3], // charging completed
    ['4.1', 0],
    ['4.4', 1], // standard
    ['4.5', 2],
    ['4.7', 0],
    ['4.17', 0],
    // self-washing station: mop humidity 3 in the third byte
    ['4.23', (3 << 16) | (20 << 8) | 1],
    ['4.25', 0],
    ['4.48', JSON.stringify(SHORTCUTS)],
    [
      '4.50',
      JSON.stringify([
        { k: 'LessColl', v: 1 },
        { k: 'CleanRoute', v: 1 },
      ]),
    ],
    ['9.2', 87],
    ['10.2', 64],
    ['11.1', 55],
    ['16.1', 12],
    ['18.1', 90],
  ]);
}

/**
 * @param {object} [options] the fake
 * @param {boolean} [options.mapInAnswer] the map location comes in the action
 *   answer (else it is pushed on the real-time channel)
 * @param {boolean} [options.requireMqttAuth] the broker checks the token
 * @returns {Promise<object>} the fake, with its state and helpers
 */
export async function startFakeDreame({ mapInAnswer = true, requireMqttAuth = true } = {}) {
  const state = {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    tokenCounter: 1,
    tokenRequests: [],
    apiRequests: [],
    commands: [],
    props: initialProperties(),
    mqttRefusals: 0,
    mqttClients: 0,
    base: null,
    bindDomain: null,
  };

  // --- Real-time channel ------------------------------------------------------
  const aedes = await Aedes.createBroker();
  aedes.authenticate = (client, username, password, callback) => {
    const ok =
      !requireMqttAuth ||
      (username === ACCOUNT.uid && password && password.toString() === state.accessToken);
    if (!ok) {
      state.mqttRefusals += 1;
      const error = new Error('Not authorized');
      error.returnCode = 5;
      callback(error, false);
      return;
    }
    state.mqttClients += 1;
    callback(null, true);
  };
  const mqttServer = createNetServer(aedes.handle);
  await new Promise((resolve) => mqttServer.listen(0, '127.0.0.1', resolve));
  state.bindDomain = `127.0.0.1:${mqttServer.address().port}`;

  const topic = `/status/${ROBOT.did}/${ACCOUNT.uid}/${ROBOT.model}/eu/`;
  const push = (changes) =>
    new Promise((resolve) => {
      aedes.publish(
        {
          topic,
          payload: Buffer.from(
            JSON.stringify({
              id: 1,
              data: {
                id: Date.now(),
                method: 'properties_changed',
                params: changes.map(([key, value]) => {
                  const [siid, piid] = key.split('.').map(Number);
                  return { did: ROBOT.did, siid, piid, value };
                }),
              },
            }),
          ),
          qos: 0,
          retain: false,
        },
        resolve,
      );
    });
  const change = async (entries) => {
    for (const [key, value] of entries) {
      state.props.set(key, value);
    }
    await push(entries);
  };

  const objectName = `${ROBOT.model}/${ACCOUNT.uid}/${ROBOT.did}/map-1700000000`;
  const mapFrame = buildMapFrame({
    data: { seg_inf: ROOMS, timestamp_ms: 1700000000000 },
    key: MAP_KEY,
    iv: mapIvFor(ROBOT.model).iv,
  });

  // --- Robot ----------------------------------------------------------------------
  function runAction({ siid, aiid, in: input = [] }) {
    const key = `${siid}.${aiid}`;
    const out = [];
    const after = [];
    if (key === '2.1') {
      after.push(['2.1', 1], ['4.1', 2], ['4.7', 1], ['3.2', 2]);
    } else if (key === '2.2') {
      after.push(['2.1', 3], ['4.7', 6]);
    } else if (key === '4.2') {
      after.push(['2.1', 2], ['4.1', 0], ['4.7', 0]);
    } else if (key === '3.1') {
      after.push(['2.1', 5], ['4.1', 3], ['4.7', 0]);
    } else if (key === '4.1') {
      const kind = input.find((item) => item.piid === 1);
      if (kind && kind.value === 18) {
        after.push(['2.1', 1], ['4.1', 18], ['4.7', 3], ['3.2', 2]);
      } else if (kind && kind.value === 25) {
        after.push(['2.1', 97], ['4.1', 25], ['4.7', 1], ['3.2', 2]);
      }
    } else if (key === '6.1') {
      if (mapInAnswer) {
        out.push(
          { piid: 3, value: `${objectName},${MAP_KEY}` },
          { piid: 5, value: '1700000000000' },
        );
      } else {
        setTimeout(() => push([['6.3', `${objectName},${MAP_KEY}`]]), 50);
      }
    }
    if (after.length > 0) {
      setTimeout(() => change(after), 20);
    }
    return { siid, aiid, code: 0, out };
  }

  function sendCommand(method, params) {
    if (method === 'get_properties') {
      return params.map(({ did, siid, piid }) => {
        const key = `${siid}.${piid}`;
        return state.props.has(key)
          ? { did, siid, piid, code: 0, value: state.props.get(key) }
          : { did, siid, piid, code: -4004 };
      });
    }
    if (method === 'set_properties') {
      return params.map(({ did, siid, piid, value }) => {
        const key = `${siid}.${piid}`;
        if (!state.props.has(key)) {
          return { did, siid, piid, code: -4004 };
        }
        if (key === '4.50') {
          // one setting written, the whole list kept; the push carries only it
          state.props.set(key, mergeSettings(state.props.get(key), value));
          setTimeout(() => push([[key, value]]), 20);
        } else {
          setTimeout(() => change([[key, value]]), 20);
        }
        return { did, siid, piid, code: 0 };
      });
    }
    if (method === 'action') {
      return runAction(params);
    }
    return null;
  }

  // --- HTTP cloud -------------------------------------------------------------------
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost');
      const reply = (status, json) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      const appHeaders =
        req.headers.authorization === 'Basic ZHJlYW1lX2FwcHYxOkFQXmR2QHpAU1FZVnhOODg=' &&
        String(req.headers['user-agent']).startsWith('Dreame_Smarthome/') &&
        Boolean(req.headers['tenant-id']);

      if (url.pathname === '/dreame-auth/oauth/token') {
        const form = new URLSearchParams(body);
        state.tokenRequests.push({ form, appHeaders });
        const grant = form.get('grant_type');
        const valid =
          grant === 'password'
            ? form.get('username') === ACCOUNT.username &&
              form.get('password') === hashPassword(ACCOUNT.password) &&
              form.get('type') === 'account'
            : form.get('refresh_token') === state.refreshToken;
        if (!appHeaders || !valid) {
          if (grant === 'password') {
            reply(400, { error: 'invalid_user', error_description: 'username or password error' });
          } else {
            reply(401, {
              error: 'invalid_token',
              error_description: 'Invalid refresh token (expired)',
            });
          }
          return;
        }
        state.tokenCounter += 1;
        state.accessToken = `access-${state.tokenCounter}`;
        reply(200, {
          access_token: state.accessToken,
          token_type: 'bearer',
          refresh_token: state.refreshToken,
          expires_in: 3600,
          scope: 'all',
          tenant_id: ACCOUNT.tenantId,
          uid: ACCOUNT.uid,
          region: 'eu',
        });
        return;
      }

      if (url.pathname.startsWith('/files/')) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(mapFrame);
        return;
      }

      state.apiRequests.push({ path: url.pathname, body: body ? JSON.parse(body) : null });
      if (req.headers['dreame-auth'] !== state.accessToken) {
        reply(401, { code: 401, data: null, message: 'Token invalid or expired' });
        return;
      }
      if (url.pathname === '/dreame-user-iot/iotuserbind/device/listV2') {
        reply(200, {
          code: 0,
          success: true,
          data: {
            page: {
              records: [
                {
                  did: ROBOT.did,
                  model: ROBOT.model,
                  mac: 'AA:BB:CC:DD:EE:FF',
                  customName: ROBOT.name,
                  masterUid: ACCOUNT.uid,
                  bindDomain: state.bindDomain,
                  ver: ROBOT.firmware,
                  online: true,
                  property: JSON.stringify({ iotId: 'iot-1' }),
                  deviceInfo: { displayName: ROBOT.displayName },
                },
                { did: '555', model: 'dreame.hold.w2422', customName: 'Aspirateur balai' },
              ],
            },
          },
        });
        return;
      }
      if (url.pathname.endsWith('/device/sendCommand')) {
        const { did, data } = JSON.parse(body);
        state.commands.push({ path: url.pathname, method: data.method, params: data.params });
        if (did !== ROBOT.did) {
          reply(200, { code: 80001, success: false, msg: 'device offline' });
          return;
        }
        reply(200, {
          code: 0,
          success: true,
          data: { id: data.id, result: sendCommand(data.method, data.params) },
        });
        return;
      }
      if (url.pathname === '/dreame-user-iot/iotfile/getDownloadUrl') {
        const { filename } = JSON.parse(body);
        reply(200, {
          code: 0,
          success: true,
          data: `${state.base}/files/${encodeURIComponent(filename)}`,
        });
        return;
      }
      reply(404, { code: 404, msg: 'not found' });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  state.base = `http://127.0.0.1:${server.address().port}`;

  return {
    state,
    base: state.base,
    push,
    change,
    /** Make the current access token invalid, as when it expires. */
    expireAccessToken() {
      state.tokenCounter += 1;
      state.accessToken = `access-${state.tokenCounter}`;
    },
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
      await new Promise((resolve) => aedes.close(resolve));
      await new Promise((resolve) => mqttServer.close(resolve));
    },
  };
}
