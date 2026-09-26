// -----------------------------------------------------------------------------
// The integration itself, independent from the SDK wiring (index.js):
//
//   - the Dreamehome account: linked once with its credentials, then reopened
//     silently at every start from the persisted session;
//   - discovery: the robots of the account, what each one supports (probed
//     property by property), its rooms (from its map) and its shortcuts;
//   - live states: every change the robot pushes on its real-time channel is
//     published at once, the Gladys poll only being a safety net; a state is
//     published when it changes, and only for the robots created in Gladys;
//   - commands, and a quick refresh after each of them;
//   - the transport badge: cloud, degraded when the real-time channel is down,
//     unreachable when the robot does not answer.
// -----------------------------------------------------------------------------

import * as mqttLibrary from 'mqtt';

import {
  CONSUMABLES,
  DISCOVERY_PROPERTIES,
  FEATURE_CODES,
  PROP,
  ROOM_SELECTION_NONE,
  STATUS_PROPERTIES,
  VACUUM_CLEANER_STATE,
} from './constants.js';
import { convertDevice, didOf, vacuumExternalIds } from './devices/convertDevice.js';
import {
  buildCommand,
  buildStates,
  gladysStateOf,
  isRoomCleaning,
  routeOf,
} from './devices/vacuum.js';
import { AUTH_FAILURE, DreameApiError, DreameAuthError, DreameCloud } from './dreame/cloud.js';
import { usesNewStateNumbering } from './dreame/models.js';
import { DreameMqttChannel } from './dreame/mqtt.js';
import { fetchRooms } from './dreame/rooms.js';
import { mergeSettings } from './dreame/settings.js';
import { parseShortcuts } from './dreame/shortcuts.js';
import { MESSAGES } from './messages.js';
import { RobotStore } from './store.js';
import {
  clearedSessionConfig,
  isSessionUsable,
  readLanguage,
  readSession,
  sessionToConfig,
} from './session.js';

// What every robot answers: the features of a robot that has never been
// reachable are built from these.
export const BASE_CAPABILITIES = [
  PROP.STATE,
  PROP.ERROR,
  PROP.BATTERY,
  PROP.CHARGING_STATUS,
  PROP.STATUS,
  PROP.SUCTION_LEVEL,
  PROP.TASK_STATUS,
];

export const TIMINGS = {
  // Rooms and shortcuts are re-read that often (they change in the app).
  REDISCOVERY_MS: 6 * 60 * 60 * 1000,
  // After a failed start (cloud down), retry from this delay, doubled up to the max.
  RETRY_MIN_MS: 60 * 1000,
  RETRY_MAX_MS: 30 * 60 * 1000,
  // Refreshes after a command, for the robots whose real-time channel lags.
  REFRESH_AFTER_COMMAND_MS: [3 * 1000, 12 * 1000],
  // A room clean the robot has not started within this delay is forgotten,
  // and the room selector goes back to "—".
  ROOM_START_GRACE_MS: 2 * 60 * 1000,
  // How long the real-time channel may take to come up before the badge says so.
  CHANNEL_GRACE_MS: 2 * 60 * 1000,
};

const DEGRADED_MESSAGE = {
  en: 'Real-time updates unavailable: the robot is refreshed every minute.',
  fr: 'Mises à jour en temps réel indisponibles : le robot est actualisé toutes les minutes.',
};

/**
 * @param {object} record a device of the account
 * @returns {boolean} whether it is a robot vacuum (the only devices handled)
 */
export function isRobotVacuum(record) {
  return Boolean(record && typeof record.model === 'string' && record.model.includes('.vacuum.'));
}

/**
 * The firmware version of a device record (its field name varies).
 * @param {object} record a device of the account
 * @returns {string|null} the version
 */
export function firmwareOf(record) {
  for (const value of [record.ver, record.fw_ver, record.firmwareVersion, record.version]) {
    if (typeof value === 'string' && value) {
      return value;
    }
  }
  return null;
}

/**
 * Record a property value of a robot. The settings list (4.50) is merged: a
 * robot pushes (and is written) one setting at a time.
 * @param {object} robot the robot
 * @param {string} key `siid.piid`
 * @param {*} value the value
 */
export function setProp(robot, key, value) {
  robot.props.set(
    key,
    key === PROP.AUTO_SWITCH ? mergeSettings(robot.props.get(key), value) : value,
  );
}

export class DreameIntegration {
  /**
   * @param {object} options the environment
   * @param {object} options.gladys the SDK instance
   * @param {object} options.logger the logger
   * @param {string} [options.dataDir] the writable directory
   * @param {object} [options.mqtt] the mqtt.js module
   * @param {Function} [options.createCloud] `(options) => DreameCloud`
   * @param {object} [options.timings] TIMINGS overrides (tests)
   */
  constructor({
    gladys,
    logger,
    dataDir = process.env.DREAME_DATA_DIR || '/data',
    mqtt = mqttLibrary,
    createCloud = (options) => new DreameCloud(options),
    timings = {},
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.mqtt = mqtt;
    this.createCloud = createCloud;
    this.timings = { ...TIMINGS, ...timings };
    this.store = new RobotStore(dataDir, logger);
    this.language = readLanguage();
    this.cloud = null;
    this.linkingCloud = null;
    this.authFailure = null;
    this.robots = new Map();
    this.otherModels = [];
    this.lastDiscovered = null;
    this.discovering = null;
    this.rediscoveryTimer = null;
    this.retryTimer = null;
    this.retryDelay = null;
    this.persistedSession = null;
    this.status = { connected: false, message: undefined };
  }

  // --- Lifecycle -------------------------------------------------------------

  /**
   * Gladys is (again) reachable. First time: reopen the stored session and
   * discover. Afterwards (Gladys restarted, WebSocket dropped): Gladys lost
   * the discovered devices and the connection badge, so publish them again.
   */
  async onConnected() {
    // The SDK resynchronized the config just before emitting `connected`.
    const config = this.gladys.config || (await this.gladys.getConfig());
    this.language = readLanguage(config);
    for (const robot of this.robots.values()) {
      robot.published.clear();
      robot.transportKey = null;
    }
    if (this.cloud) {
      await this.republish();
      return;
    }
    const session = readSession(config);
    this.persistedSession = session;
    if (!isSessionUsable(session)) {
      this.logger.info('No Dreamehome account linked yet: link it from the integration settings');
      await this.reportStatus(false);
      return;
    }
    this.cloud = this.newCloud(session);
    await this.refreshAccount();
  }

  async republish() {
    if (this.lastDiscovered) {
      await this.gladys.publishDiscoveredDevices(this.lastDiscovered);
    }
    await this.reportStatus(this.status.connected, this.status.message);
    for (const robot of this.robots.values()) {
      await this.publishTransport(robot);
      await this.publishRobot(robot);
    }
  }

  /** Stop the channels and timers (shutdown, unlink, refused session). */
  stopAll() {
    clearInterval(this.rediscoveryTimer);
    clearTimeout(this.retryTimer);
    this.rediscoveryTimer = null;
    this.retryTimer = null;
    for (const robot of this.robots.values()) {
      this.stopRobot(robot);
    }
  }

  stopRobot(robot) {
    if (robot.channel) {
      robot.channel.stop();
      robot.channel = null;
    }
    clearTimeout(robot.channelCheck);
    for (const timer of robot.refreshTimers) {
      clearTimeout(timer);
    }
    robot.refreshTimers = [];
    this.resolveMapWaiters(robot, null);
  }

  // --- Account -----------------------------------------------------------------

  newCloud(session) {
    const cloud = this.createCloud({
      ...session,
      onSession: (current) => this.onSession(cloud, current),
    });
    return cloud;
  }

  /**
   * After every login or token renewal: persist what changed, and hand the new
   * token to the real-time channels for their next reconnection. A client
   * being replaced (account linked again) is ignored.
   * @param {object} cloud the client that renewed
   * @param {object} session its session
   */
  async onSession(cloud, session) {
    if (cloud !== this.cloud && cloud !== this.linkingCloud) {
      return;
    }
    if (cloud === this.cloud) {
      for (const robot of this.robots.values()) {
        if (robot.channel) {
          robot.channel.useCredentials(this.mqttIdentity(robot));
        }
      }
    }
    const persisted = this.persistedSession || {};
    if (
      persisted.username === session.username &&
      persisted.region === session.region &&
      persisted.passwordHash === session.passwordHash &&
      persisted.refreshToken === session.refreshToken &&
      persisted.tenantId === session.tenantId
    ) {
      return;
    }
    this.persistedSession = { ...session };
    try {
      await this.gladys.setConfig(sessionToConfig(session));
    } catch (err) {
      this.logger.error(`Could not persist the Dreamehome session: ${err.message}`);
    }
  }

  /** Open the session, discover, report the badge; never throws. */
  async refreshAccount() {
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    try {
      await this.discover();
      this.retryDelay = null;
      await this.reportStatus(true, this.linkedMessage());
      this.startRediscovery();
    } catch (err) {
      if (err instanceof DreameAuthError) {
        return;
      }
      this.logger.error(`Dreamehome discovery failed: ${err.message}`);
      await this.reportStatus(false, MESSAGES.cloudUnreachable(err.message));
      // The cloud may come back: retry, less and less often.
      this.retryDelay = Math.min(
        this.retryDelay ? this.retryDelay * 2 : this.timings.RETRY_MIN_MS,
        this.timings.RETRY_MAX_MS,
      );
      this.retryTimer = setTimeout(() => this.refreshAccount(), this.retryDelay);
      this.retryTimer.unref?.();
    }
  }

  linkedMessage() {
    return this.cloud && this.cloud.username
      ? MESSAGES.linkedAccount(this.cloud.username, this.cloud.region)
      : undefined;
  }

  startRediscovery() {
    if (this.rediscoveryTimer) {
      return;
    }
    this.rediscoveryTimer = setInterval(() => this.refreshAccount(), this.timings.REDISCOVERY_MS);
    this.rediscoveryTimer.unref?.();
  }

  /**
   * Run a cloud call; a refused session stops everything and says so, so the
   * integration never keeps hammering the account with dead credentials.
   * @param {Function} call the cloud call
   * @returns {Promise<*>} its result
   */
  async guard(call) {
    try {
      return await call();
    } catch (err) {
      if (err instanceof DreameAuthError) {
        await this.onAuthFailure(err);
      }
      throw err;
    }
  }

  async onAuthFailure(err) {
    if (this.authFailure) {
      return;
    }
    this.authFailure = err.reason;
    this.logger.error(`The Dreamehome session was refused: ${err.message}`);
    this.stopAll();
    const message =
      err.reason === AUTH_FAILURE.NOT_LINKED ? MESSAGES.notLinked : MESSAGES.relinkNeeded;
    await this.reportStatus(false, message);
  }

  requireCloud() {
    if (!this.cloud) {
      throw new Error(MESSAGES.notLinked.en);
    }
    if (this.authFailure) {
      throw new Error(MESSAGES.relinkNeeded.en);
    }
    return this.cloud;
  }

  async reportStatus(connected, message) {
    this.status = { connected, message };
    try {
      await this.gladys.setConnectionStatus(connected, message);
    } catch (err) {
      this.logger.error(`Could not report the connection status: ${err.message}`);
    }
  }

  /**
   * Action "Link the account".
   * @param {object} fields `{ username, password, region }` — the password is
   *   hashed at once and never logged nor stored
   * @returns {Promise<object>} the message shown under the button
   */
  async link(fields = {}) {
    const username = typeof fields.username === 'string' ? fields.username.trim() : '';
    const password = typeof fields.password === 'string' ? fields.password : '';
    const region = typeof fields.region === 'string' ? fields.region : undefined;
    if (!username) {
      return MESSAGES.missingUsername;
    }
    if (!password) {
      return MESSAGES.missingPassword;
    }
    const cloud = this.newCloud({ region });
    this.linkingCloud = cloud;
    try {
      await cloud.login(username, password);
    } catch (err) {
      if (err instanceof DreameAuthError) {
        return MESSAGES.credentialsRefused(cloud.region);
      }
      return MESSAGES.cloudUnreachable(err.message);
    } finally {
      this.linkingCloud = null;
    }
    // Let a discovery of the previous account finish before replacing it.
    if (this.discovering) {
      await this.discovering.catch(() => {});
    }
    this.stopAll();
    this.robots.clear();
    this.store.clear();
    this.cloud = cloud;
    this.authFailure = null;
    this.lastDiscovered = null;
    this.retryDelay = null;
    this.logger.info('Dreamehome account linked');
    await this.refreshAccount();
    if (!this.status.connected) {
      return this.status.message;
    }
    return this.robots.size > 0 ? MESSAGES.linked(this.robots.size) : MESSAGES.linkedNoRobot;
  }

  /**
   * Action "Unlink the account": forget the session and the robots.
   * @returns {Promise<object>} the message shown under the button
   */
  async unlink() {
    // A discovery under way would publish the robots again once done.
    if (this.discovering) {
      await this.discovering.catch(() => {});
    }
    this.stopAll();
    this.cloud = null;
    this.authFailure = null;
    this.robots.clear();
    this.store.clear();
    this.lastDiscovered = [];
    this.persistedSession = null;
    try {
      await this.gladys.setConfig(clearedSessionConfig());
    } catch (err) {
      this.logger.error(`Could not clear the Dreamehome session: ${err.message}`);
    }
    await this.gladys.publishDiscoveredDevices([]);
    await this.reportStatus(false);
    return MESSAGES.unlinked;
  }

  /**
   * The configuration form was saved: only the language lives there. Room
   * labels follow it at once; feature names were fixed when each device was
   * created.
   * @param {object} config the new config
   */
  async onConfigUpdated(config) {
    const language = readLanguage(config);
    if (language === this.language) {
      return;
    }
    this.language = language;
    for (const robot of this.robots.values()) {
      robot.published.delete(
        vacuumExternalIds(this.gladys, robot.did).feature(FEATURE_CODES.ERROR),
      );
    }
    if (this.robots.size > 0) {
      await this.publishDevices();
      for (const robot of this.robots.values()) {
        await this.publishRobot(robot);
      }
    }
  }

  // --- Discovery -----------------------------------------------------------------

  /**
   * Discover the robots of the account (single flight).
   * @returns {Promise<Array>} the robots
   */
  async discover() {
    if (!this.discovering) {
      this.discovering = this.runDiscovery().finally(() => {
        this.discovering = null;
      });
    }
    return this.discovering;
  }

  async runDiscovery() {
    const cloud = this.requireCloud();
    const records = await this.guard(() => cloud.listDevices());
    this.otherModels = records
      .filter((record) => !isRobotVacuum(record))
      .map((r) => String(r.model));
    const seen = new Set();
    for (const record of records.filter(isRobotVacuum)) {
      const robot = this.upsertRobot(record);
      seen.add(robot.did);
      await this.startChannel(robot);
      await this.probe(robot);
    }
    for (const [did, robot] of this.robots) {
      if (!seen.has(did)) {
        this.stopRobot(robot);
        this.robots.delete(did);
      }
    }
    this.store.retain(seen);
    this.logger.info(
      `${this.robots.size} robot vacuum(s) on the account` +
        (this.otherModels.length ? `, other devices ignored: ${this.otherModels.join(', ')}` : ''),
    );
    await this.publishDevices();
    for (const robot of this.robots.values()) {
      await this.publishTransport(robot);
      await this.publishRobot(robot);
    }
    return [...this.robots.values()];
  }

  upsertRobot(record) {
    const did = String(record.did);
    let robot = this.robots.get(did);
    if (!robot) {
      robot = {
        did,
        props: new Map(),
        capabilities: null,
        rooms: [],
        shortcuts: [],
        channel: null,
        channelCheck: null,
        published: new Map(),
        transportKey: null,
        reachable: null,
        lastError: null,
        roomCleaning: null,
        roomSelectorReady: false,
        refreshTimers: [],
        mapWaiters: [],
      };
      this.robots.set(did, robot);
    }
    const info = record.deviceInfo || {};
    robot.model = String(record.model);
    robot.name = record.customName || info.displayName || robot.model;
    robot.displayModel = info.displayName || robot.model;
    robot.firmware = firmwareOf(record);
    robot.bindDomain = record.bindDomain || null;
    robot.masterUid = record.masterUid ? String(record.masterUid) : null;
    robot.online = record.online !== false;
    robot.newNumbering = usesNewStateNumbering(robot.model, robot.firmware);
    return robot;
  }

  /**
   * Learn what a robot supports, its shortcuts and its rooms. A robot that
   * does not answer keeps what an earlier discovery learned.
   * @param {object} robot the robot
   */
  async probe(robot) {
    const cached = this.store.get(robot.did);
    try {
      const props = await this.guard(() => this.cloud.getProperties(robot, DISCOVERY_PROPERTIES));
      if (props.size === 0) {
        throw new DreameApiError('the robot answered no property');
      }
      robot.capabilities = new Set(props.keys());
      for (const [key, value] of props) {
        setProp(robot, key, value);
      }
      robot.reachable = true;
      robot.lastError = null;
    } catch (err) {
      if (err instanceof DreameAuthError) {
        throw err;
      }
      robot.reachable = false;
      robot.lastError = err.message;
      this.logger.warn(`Robot "${robot.name}" did not answer: ${err.message}`);
      robot.capabilities =
        robot.capabilities || new Set(cached ? cached.capabilities : BASE_CAPABILITIES);
    }
    if (robot.reachable) {
      robot.hasRoute = routeOf(robot.props) !== null;
    } else if (robot.hasRoute === undefined) {
      robot.hasRoute = Boolean(cached && cached.hasRoute);
    }
    if (robot.props.has(PROP.SHORTCUTS)) {
      robot.shortcuts = parseShortcuts(robot.props.get(PROP.SHORTCUTS));
    } else if (cached && robot.shortcuts.length === 0) {
      robot.shortcuts = cached.shortcuts || [];
    }
    let roomsRead = false;
    if (robot.reachable) {
      const trace = [];
      try {
        robot.rooms = await this.guard(() =>
          fetchRooms(this.cloud, robot, {
            waitForPush: (ms) => this.waitForMapLocation(robot, ms),
            trace,
          }),
        );
        roomsRead = true;
        this.logger.info(`Rooms of "${robot.name}": ${trace.join(' | ')}`);
      } catch (err) {
        if (err instanceof DreameAuthError) {
          throw err;
        }
        // Each step of the map reading, so a user's log tells where it stops.
        this.logger.warn(
          `Could not read the rooms of "${robot.name}": ${err.message} (${trace.join(' | ')})`,
        );
      }
    }
    // A map read without rooms is the truth (map deleted in the app); only a
    // map that could not be read falls back on what was known.
    if (!roomsRead && robot.rooms.length === 0 && cached) {
      robot.rooms = cached.rooms || [];
    }
    this.saveRobot(robot);
  }

  saveRobot(robot) {
    this.store.set(robot.did, {
      capabilities: [...robot.capabilities],
      rooms: robot.rooms,
      shortcuts: robot.shortcuts,
      hasRoute: Boolean(robot.hasRoute),
    });
  }

  async publishDevices() {
    const devices = [...this.robots.values()]
      .filter((robot) => robot.capabilities)
      .map((robot) => convertDevice(this.gladys, robot, this.language));
    this.lastDiscovered = devices;
    await this.gladys.publishDiscoveredDevices(devices);
  }

  // --- Real-time channel ---------------------------------------------------------

  mqttIdentity(robot) {
    return {
      username: this.cloud.uid || robot.masterUid,
      password: this.cloud.accessToken,
    };
  }

  async startChannel(robot) {
    if (!robot.bindDomain || !robot.masterUid) {
      return;
    }
    if (robot.channel && robot.channel.bindDomain === robot.bindDomain) {
      return;
    }
    if (robot.channel) {
      robot.channel.stop();
    }
    const channel = new DreameMqttChannel({
      device: robot,
      region: this.cloud.region,
      getCredentials: async (forceRefresh) => {
        await this.guard(() => this.cloud.getAccessToken(forceRefresh));
        return this.mqttIdentity(robot);
      },
      onChanges: (changes) => this.onPush(robot, changes),
      onStatus: () => this.updateTransport(robot),
      mqtt: this.mqtt,
      logger: this.logger,
    });
    channel.bindDomain = robot.bindDomain;
    robot.channel = channel;
    try {
      await channel.start();
    } catch (err) {
      if (err instanceof DreameAuthError) {
        throw err;
      }
      this.logger.warn(`Could not open the real-time channel of "${robot.name}": ${err.message}`);
    }
    // Look again once the first connection had time to come up.
    clearTimeout(robot.channelCheck);
    robot.channelCheck = setTimeout(
      () => this.updateTransport(robot),
      this.timings.CHANNEL_GRACE_MS + 1000,
    );
    robot.channelCheck.unref?.();
  }

  updateTransport(robot) {
    this.publishTransport(robot).catch((err) =>
      this.logger.warn(`Could not publish the transport of "${robot.name}": ${err.message}`),
    );
  }

  /**
   * Property changes pushed by a robot.
   * @param {object} robot the robot
   * @param {Array<{ key: string, value: * }>} changes the changes
   */
  onPush(robot, changes) {
    let shortcutsChanged = false;
    for (const { key, value } of changes) {
      setProp(robot, key, value);
      if (key === '6.3' && typeof value === 'string' && value) {
        this.resolveMapWaiters(robot, { objectName: value, frame: null });
      }
      if (key === PROP.SHORTCUTS) {
        shortcutsChanged = true;
      }
    }
    if (!robot.capabilities) {
      // Pushed before the robot was probed: the probe publishes it all.
      return;
    }
    if (robot.reachable === false) {
      robot.reachable = true;
      this.updateTransport(robot);
    }
    if (shortcutsChanged) {
      const shortcuts = parseShortcuts(robot.props.get(PROP.SHORTCUTS));
      if (JSON.stringify(shortcuts) !== JSON.stringify(robot.shortcuts)) {
        robot.shortcuts = shortcuts;
        robot.capabilities.add(PROP.SHORTCUTS);
        this.saveRobot(robot);
        this.publishDevices().catch((err) => this.logger.warn(err.message));
      }
    }
    this.publishRobot(robot).catch((err) =>
      this.logger.warn(`Could not publish the states of "${robot.name}": ${err.message}`),
    );
  }

  waitForMapLocation(robot, ms) {
    return new Promise((resolve) => {
      const done = (location) => {
        clearTimeout(timer);
        resolve(location);
      };
      const timer = setTimeout(() => {
        robot.mapWaiters = robot.mapWaiters.filter((waiter) => waiter !== done);
        resolve(null);
      }, ms);
      robot.mapWaiters.push(done);
    });
  }

  resolveMapWaiters(robot, location) {
    const waiters = robot.mapWaiters;
    robot.mapWaiters = [];
    for (const waiter of waiters) {
      waiter(location);
    }
  }

  // --- Gladys ---------------------------------------------------------------------

  robotOf(device) {
    const did = didOf(this.gladys, device && device.external_id);
    const robot = did ? this.robots.get(did) : null;
    if (!robot || !robot.capabilities) {
      throw new Error(`Unknown robot: ${device && device.external_id}`);
    }
    return robot;
  }

  /**
   * The robot as created in Gladys, or null when the user has not added it.
   * @param {object} robot the robot
   * @returns {object|null} the Gladys device
   */
  createdDevice(robot) {
    const externalId = vacuumExternalIds(this.gladys, robot.did).device;
    return (this.gladys.devices || []).find((device) => device.external_id === externalId) || null;
  }

  /**
   * Gladys polls a robot: read its status, publish what changed.
   * @param {object} device the Gladys device
   */
  async poll(device) {
    await this.refresh(this.robotOf(device));
  }

  async refresh(robot) {
    const cloud = this.requireCloud();
    const keys = [
      ...STATUS_PROPERTIES,
      ...CONSUMABLES.map((consumable) => consumable.prop).filter((key) =>
        robot.capabilities.has(key),
      ),
    ];
    try {
      const props = await this.guard(() => cloud.getProperties(robot, keys));
      for (const [key, value] of props) {
        setProp(robot, key, value);
      }
      robot.reachable = true;
      robot.lastError = null;
    } catch (err) {
      if (!(err instanceof DreameAuthError)) {
        robot.reachable = false;
        robot.lastError = err.message;
        await this.publishTransport(robot);
      }
      throw err;
    }
    await this.publishTransport(robot);
    await this.publishRobot(robot);
  }

  scheduleRefresh(robot) {
    for (const timer of robot.refreshTimers) {
      clearTimeout(timer);
    }
    robot.refreshTimers = this.timings.REFRESH_AFTER_COMMAND_MS.map((delay) => {
      const timer = setTimeout(() => {
        this.refresh(robot).catch((err) => this.logger.debug(`Refresh failed: ${err.message}`));
      }, delay);
      timer.unref?.();
      return timer;
    });
  }

  /**
   * A command from Gladys.
   * @param {object} device the Gladys device
   * @param {object} feature the Gladys feature
   * @param {*} value the value
   */
  async setValue(device, feature, value) {
    const robot = this.robotOf(device);
    const cloud = this.requireCloud();
    const code = String(feature.external_id).split(':').pop();
    if (code === FEATURE_CODES.ROOM) {
      // Gladys stored the selection itself (no feedback): what was last
      // published no longer tells what the selector shows.
      robot.published.delete(vacuumExternalIds(this.gladys, robot.did).feature(FEATURE_CODES.ROOM));
      if (value === ROOM_SELECTION_NONE) {
        robot.roomCleaning = null;
        return;
      }
    }
    const command = buildCommand(code, value, robot.props, {
      paused: gladysStateOf(robot.props, robot.newNumbering) === VACUUM_CLEANER_STATE.PAUSED,
    });
    if (!command) {
      return;
    }
    if (command.kind === 'set') {
      await this.guard(() => cloud.setProperty(robot, command.key, command.value));
      setProp(robot, command.key, command.value);
    } else {
      await this.guard(() => cloud.action(robot, command.action, command.params));
    }
    if (code === FEATURE_CODES.ROOM) {
      robot.roomCleaning = { requestedAt: Date.now(), started: false };
    }
    if (robot.reachable === false) {
      robot.reachable = true;
      await this.publishTransport(robot);
    }
    await this.publishRobot(robot);
    this.scheduleRefresh(robot);
  }

  /**
   * A robot was added in Gladys: give it its states at once.
   * @param {object} device the Gladys device
   */
  async onDeviceCreated(device) {
    const did = didOf(this.gladys, device && device.external_id);
    const robot = did ? this.robots.get(did) : null;
    if (!robot) {
      return;
    }
    robot.published.clear();
    robot.transportKey = null;
    await this.publishTransport(robot);
    await this.publishRobot(robot);
  }

  /**
   * Publish the states of a robot that changed since the last publication.
   * @param {object} robot the robot
   */
  async publishRobot(robot) {
    const device = this.createdDevice(robot);
    if (!device) {
      return;
    }
    const ids = vacuumExternalIds(this.gladys, robot.did);
    const existing = new Set((device.features || []).map((feature) => feature.external_id));
    const states = buildStates(ids, robot.props, {
      newNumbering: robot.newNumbering,
      language: this.language,
    });
    if (existing.has(ids.feature(FEATURE_CODES.ROOM))) {
      const reset = this.roomSelectorReset(robot);
      if (reset) {
        states.push({ device_feature_external_id: ids.feature(FEATURE_CODES.ROOM), text: reset });
      }
    }
    const signature = (state) =>
      state.text !== undefined ? `text:${state.text}` : `state:${state.state}`;
    const changed = states.filter(
      (state) =>
        existing.has(state.device_feature_external_id) &&
        robot.published.get(state.device_feature_external_id) !== signature(state),
    );
    if (changed.length === 0) {
      return;
    }
    await this.gladys.publishStates(changed);
    for (const state of changed) {
      robot.published.set(state.device_feature_external_id, signature(state));
    }
  }

  /**
   * The room selector goes back to "—" once the room clean it started is over
   * (or never started), and once after a restart, so it never shows a stale
   * room.
   * @param {object} robot the robot
   * @returns {string|null} the value to publish, if any
   */
  roomSelectorReset(robot) {
    const track = robot.roomCleaning;
    if (isRoomCleaning(robot.props)) {
      robot.roomCleaning = { requestedAt: track ? track.requestedAt : Date.now(), started: true };
      robot.roomSelectorReady = true;
      return null;
    }
    if (
      track &&
      !track.started &&
      Date.now() - track.requestedAt < this.timings.ROOM_START_GRACE_MS
    ) {
      return null;
    }
    if (track || !robot.roomSelectorReady) {
      robot.roomCleaning = null;
      robot.roomSelectorReady = true;
      return ROOM_SELECTION_NONE;
    }
    return null;
  }

  /**
   * The transport badge of a robot, published when it changes.
   * @param {object} robot the robot
   */
  async publishTransport(robot) {
    if (!this.createdDevice(robot)) {
      return;
    }
    // The `online` flag of the device list only counts until the robot is asked.
    const unreachable =
      robot.reachable === false || (robot.reachable === null && robot.online === false);
    let entry;
    if (unreachable) {
      entry = { transport: 'unreachable' };
    } else if (robot.channel && robot.channel.isDown(this.timings.CHANNEL_GRACE_MS)) {
      entry = { transport: 'cloud', degraded: true, message: DEGRADED_MESSAGE };
    } else {
      entry = { transport: 'cloud' };
    }
    const key = JSON.stringify(entry);
    if (robot.transportKey === key) {
      return;
    }
    robot.transportKey = key;
    await this.gladys.publishTransports([
      { external_id: vacuumExternalIds(this.gladys, robot.did).device, ...entry },
    ]);
  }
}
