// -----------------------------------------------------------------------------
// Real-time channel of one robot: the Dreamehome MQTT broker the robot is bound
// to (its `bindDomain`, e.g. `10000.mt.eu.iot.dreame.tech:19973`) pushes every
// property change the robot reports, as the app receives them.
//
//   - client id  `p_<masterUid>_<13 random letters A-F>_<broker host>`;
//   - username   the account uid, password the access token;
//   - topic      `/status/<did>/<masterUid>/<model>/<region>/`;
//   - payload    `{ "data": { "method": "properties_changed",
//                              "params": [{ "siid", "piid", "value" }] } }`.
//
// The access token expires: a reconnection takes the current one (mqtt.js
// rebuilds its CONNECT packet from `client.options` on every attempt), and a
// "not authorized" answer renews it first. Korean accounts are still served on
// the Singapore topic by some firmwares, and their broker name only resolves
// with the 10000 node: both are handled as the Home Assistant integration does.
// -----------------------------------------------------------------------------

import { randomInt } from 'node:crypto';

import { DREAME_MQTT } from '../constants.js';

// CONNACK return codes of a refused login (MQTT 3.1.1).
const AUTH_REFUSED_CODES = new Set([4, 5]);

/**
 * The random part of the client id, as the app draws it.
 * @returns {string} 13 letters among A-F
 */
export function randomAgentId() {
  let id = '';
  for (let i = 0; i < 13; i += 1) {
    id += 'ABCDEF'[randomInt(6)];
  }
  return id;
}

/**
 * Where to connect, and what to subscribe to, for one robot.
 * @param {object} device the robot (`did`, `model`, `masterUid`, `bindDomain`)
 * @param {string} region the account region
 * @returns {{ host: string, port: number, clientId: string, topics: string[] }|null}
 *   null when the robot has no broker
 */
export function brokerOf(device, region) {
  const [rawHost, rawPort] = String(device.bindDomain || '').split(':');
  const port = Number(rawPort);
  if (!rawHost || !Number.isInteger(port) || port <= 0) {
    return null;
  }
  const host = region === 'kr' ? rawHost.replace('10100', '10000') : rawHost;
  const topic = (topicRegion) =>
    `/status/${device.did}/${device.masterUid}/${device.model}/${topicRegion}/`;
  const topics = [topic(region)];
  if (region === 'kr') {
    topics.push(topic('sg'));
  }
  return {
    host,
    port,
    clientId: `p_${device.masterUid}_${randomAgentId()}_${host}`,
    topics,
  };
}

/**
 * Decode one broker message into the property changes it carries.
 * @param {Buffer|string} payload the MQTT payload
 * @returns {Array<{ key: string, value: * }>} the changes (`siid.piid` keys)
 */
export function propertyChangesOf(payload) {
  let json;
  try {
    json = JSON.parse(payload.toString());
  } catch {
    return [];
  }
  const data = json && json.data;
  if (!data || data.method !== 'properties_changed' || !Array.isArray(data.params)) {
    return [];
  }
  return data.params
    .filter((param) => param && param.value !== undefined && param.siid !== undefined)
    .map((param) => ({ key: `${param.siid}.${param.piid}`, value: param.value }));
}

export class DreameMqttChannel {
  /**
   * @param {object} options the channel
   * @param {object} options.device the robot
   * @param {string} options.region the account region
   * @param {Function} options.getCredentials `async (forceRefresh) => ({ username, password })`
   * @param {Function} options.onChanges `(changes) => void`
   * @param {Function} [options.onStatus] `(connected) => void`
   * @param {object} options.mqtt the mqtt.js module (injectable)
   * @param {object} options.logger the logger
   */
  constructor({ device, region, getCredentials, onChanges, onStatus, mqtt, logger }) {
    this.device = device;
    this.region = region;
    this.getCredentials = getCredentials;
    this.onChanges = onChanges;
    this.onStatus = onStatus || (() => {});
    this.mqtt = mqtt;
    this.logger = logger;
    this.client = null;
    this.connected = false;
    this.everConnected = false;
    this.startedAt = null;
    this.renewing = false;
    this.lastRenewal = 0;
    this.failures = 0;
    this.messages = 0;
    this.lastError = null;
  }

  /**
   * Connect and subscribe. Resolves at once: the connection lives its own life.
   * @returns {Promise<boolean>} false when the robot has no broker
   */
  async start() {
    const broker = brokerOf(this.device, this.region);
    if (!broker) {
      this.lastError = 'no broker for this robot';
      return false;
    }
    const credentials = await this.getCredentials(false);
    this.topics = broker.topics;
    this.startedAt = Date.now();
    this.client = this.mqtt.connect(`${DREAME_MQTT.PROTOCOL}://${broker.host}:${broker.port}`, {
      clientId: broker.clientId,
      username: credentials.username,
      password: credentials.password,
      clean: true,
      protocolVersion: 4,
      keepalive: DREAME_MQTT.KEEPALIVE_SECONDS,
      reconnectPeriod: DREAME_MQTT.RECONNECT_PERIOD_MS,
      connectTimeout: DREAME_MQTT.CONNECT_TIMEOUT_MS,
      rejectUnauthorized: false,
    });
    this.client.on('connect', () => {
      this.connected = true;
      this.everConnected = true;
      this.lastError = null;
      this.failures = 0;
      this.client.options.reconnectPeriod = DREAME_MQTT.RECONNECT_PERIOD_MS;
      this.client.subscribe(this.topics, { qos: 0 }, (err) => {
        if (err) {
          this.logger.warn(`MQTT subscription refused for ${this.device.did}: ${err.message}`);
        }
      });
      this.logger.info(`Real-time channel open for ${this.device.did}`);
      this.onStatus(true);
    });
    // Ahead of mqtt.js's own listener, which schedules the next attempt with
    // the reconnectPeriod set here.
    this.client.prependListener('close', () => {
      if (this.connected) {
        this.logger.warn(`Real-time channel closed for ${this.device.did}, reconnecting`);
        this.connected = false;
        this.onStatus(false);
        return;
      }
      // An attempt that failed: wait longer before the next one.
      this.failures += 1;
      this.client.options.reconnectPeriod = Math.min(
        DREAME_MQTT.RECONNECT_PERIOD_MS * 2 ** this.failures,
        DREAME_MQTT.RECONNECT_MAX_MS,
      );
    });
    this.client.on('error', (err) => {
      this.lastError = err.message;
      if (AUTH_REFUSED_CODES.has(err.code)) {
        this.renewCredentials();
      } else {
        this.logger.debug(`MQTT error for ${this.device.did}: ${err.message}`);
      }
    });
    this.client.on('message', (_topic, payload) => {
      this.messages += 1;
      const changes = propertyChangesOf(payload);
      if (changes.length > 0) {
        this.onChanges(changes);
      }
    });
    return true;
  }

  /**
   * The broker refused the token: take a renewed one for the next attempt.
   * The renewal itself is forced at most every MIN_RENEWAL_INTERVAL_MS.
   */
  async renewCredentials() {
    if (this.renewing || !this.client) {
      return;
    }
    this.renewing = true;
    try {
      const force = Date.now() - this.lastRenewal > DREAME_MQTT.MIN_RENEWAL_INTERVAL_MS;
      if (force) {
        this.lastRenewal = Date.now();
      }
      this.useCredentials(await this.getCredentials(force));
    } catch (err) {
      this.logger.warn(`Could not renew the MQTT credentials: ${err.message}`);
    } finally {
      this.renewing = false;
    }
  }

  /**
   * Take a renewed token for the next (re)connection.
   * @param {{ username: string, password: string }} credentials the credentials
   */
  useCredentials({ username, password }) {
    if (this.client) {
      this.client.options.username = username;
      this.client.options.password = password;
    }
  }

  /**
   * Whether the channel should be working and is not: it dropped after having
   * worked, or it never came up within the grace delay.
   * @param {number} graceMs how long a first connection may take
   * @returns {boolean} true when real-time updates are missing
   */
  isDown(graceMs) {
    if (!this.client || this.connected) {
      return false;
    }
    return this.everConnected || Date.now() - this.startedAt > graceMs;
  }

  /** Close for good. */
  stop() {
    if (this.client) {
      this.client.removeAllListeners();
      // An 'error' emitted with no listener would crash the process.
      this.client.on('error', () => {});
      this.client.end(true);
      this.client = null;
    }
    this.connected = false;
  }
}
