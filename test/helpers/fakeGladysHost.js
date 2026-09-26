// -----------------------------------------------------------------------------
// A fake Gladys HOST (the REST host API + the WebSocket) for the end-to-end
// test, which boots the real index.js against it. It records everything the
// integration publishes, and lets the test send what Gladys would send (polls,
// commands, actions, device creation).
// -----------------------------------------------------------------------------

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

export const TOKEN = 'integration-token';

/**
 * @param {object} config the stored integration config (mutated by POST /config)
 * @returns {Promise<object>} the fake host
 */
export async function startFakeGladysHost(config) {
  const state = {
    config,
    devices: [],
    discoveredDevicePosts: [],
    statePosts: [],
    transportPosts: [],
    connectionStatusPosts: [],
    configPosts: [],
    commandResults: [],
    ws: null,
  };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const respond = (json) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      const payload = body ? JSON.parse(body) : {};
      if (req.headers.authorization !== `Bearer ${TOKEN}`) {
        res.writeHead(401);
        res.end();
        return;
      }
      if (req.method === 'GET' && req.url === '/api/integration/v1/device') {
        respond(state.devices);
      } else if (req.method === 'GET' && req.url === '/api/integration/v1/config') {
        respond({ config: state.config });
      } else if (req.method === 'POST' && req.url === '/api/integration/v1/config') {
        const written = payload.config || payload;
        state.configPosts.push(written);
        Object.assign(state.config, written);
        respond({ config: state.config });
      } else if (req.method === 'POST' && req.url === '/api/integration/v1/discovered_device') {
        state.discoveredDevicePosts.push(payload.devices);
        respond({ success: true, count: payload.devices.length });
      } else if (req.method === 'POST' && req.url === '/api/integration/v1/state') {
        state.statePosts.push(payload.states);
        respond({ success: true });
      } else if (req.method === 'POST' && req.url === '/api/integration/v1/device/transport') {
        state.transportPosts.push(payload.transports);
        respond({ success: true });
      } else if (req.method === 'POST' && req.url === '/api/integration/v1/connection_status') {
        state.connectionStatusPosts.push(payload);
        respond({ success: true });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => {
    state.ws = ws;
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'authenticate.integration-request' && message.payload.token === TOKEN) {
        ws.send(JSON.stringify({ type: 'authentication.connected', payload: {} }));
      }
      if (message.type === 'external-integration.command-result') {
        state.commandResults.push(message.payload);
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const send = (type, payload) => state.ws.send(JSON.stringify({ type, payload }));
  let messageId = 0;
  const command = async (type, payload, waitUntil) => {
    messageId += 1;
    const id = `message-${messageId}`;
    send(type, { message_id: id, ...payload });
    await waitUntil(
      () => state.commandResults.some((result) => result.message_id === id),
      `the result of ${type}`,
    );
    return state.commandResults.find((result) => result.message_id === id);
  };

  return {
    state,
    port: server.address().port,
    send,
    command,
    /**
     * Create a device from its discovered form, as the Discovery screen does.
     * @param {object} discovered a discovered device
     * @returns {object} the created device
     */
    createDevice(discovered) {
      const device = {
        ...discovered,
        id: `device-${state.devices.length + 1}`,
        selector: discovered.external_id.replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
        params: [],
      };
      state.devices.push(device);
      send('external-integration.device-created', { device });
      return device;
    },
    async close() {
      for (const client of wss.clients) {
        client.terminate();
      }
      wss.close();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/**
 * Poll until a condition holds.
 * @param {Function} predicate the condition
 * @param {string} what what is awaited, for the error
 * @param {number} [timeoutMs] give up after
 */
export async function waitUntil(predicate, what, timeoutMs = 15000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
