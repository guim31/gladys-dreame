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
//     unreachable when the robot does not answer;
//   - the dashboard widgets: their content (widgets.js), their buttons, the map
//     image, re-read while a dashboard shows it (never otherwise), and a nudge
//     to Gladys when what they show changes.
// -----------------------------------------------------------------------------

import * as mqttLibrary from 'mqtt';

import {
  CONSUMABLES,
  DISCOVERY_PROPERTIES,
  FEATURE_CODES,
  PROP,
  ROOM_SELECTION_NONE,
  ROUTE_SETTING,
  STATUS_PROPERTIES,
  VACUUM_CLEANER_STATE,
} from './constants.js';
import { convertDevice, didOf, vacuumExternalIds } from './devices/convertDevice.js';
import {
  buildCommand,
  buildRoomsClean,
  buildStates,
  gladysStateOf,
  isRoomCleaning,
  washValuesOf,
} from './devices/vacuum.js';
import { AUTH_FAILURE, DreameApiError, DreameAuthError, DreameCloud } from './dreame/cloud.js';
import { modelCapabilities, usesNewStateNumbering } from './dreame/models.js';
import { moppingOf } from './dreame/mopping.js';
import { DreameMqttChannel } from './dreame/mqtt.js';
import { renderMap } from './dreame/render.js';
import { fetchMap } from './dreame/rooms.js';
import { mergeSettings, parseSettings } from './dreame/settings.js';
import { parseShortcuts } from './dreame/shortcuts.js';
import { texts } from './i18n.js';
import { MESSAGES } from './messages.js';
import {
  WIDGET,
  maintenanceContent,
  messageContent,
  quickContent,
  robotContent,
  settingContent,
  widgetCommand,
  widgetLanguage,
  widgetMessage,
} from './widgets.js';
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
  // The map of the robot widget is re-read when a dashboard asks for it and it
  // is older than this: often while the robot moves, rarely otherwise.
  MAP_MAX_AGE_ACTIVE_MS: 50 * 1000,
  MAP_MAX_AGE_IDLE_MS: 30 * 60 * 1000,
  // Gladys takes one widget nudge per 10 s: the last change of a burst is sent
  // at the end of the window instead of being dropped.
  WIDGET_NUDGE_MS: 10 * 1000,
};

// Map images kept for the dashboards (a few per robot: the current one, and
// the ones still in a dashboard's cache).
const MAX_IMAGES = 20;

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
    this.images = new Map();
    this.nudges = new Map();
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
    for (const nudge of this.nudges.values()) {
      clearTimeout(nudge.timer);
    }
    this.nudges.clear();
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
        settingKeys: null,
        mopping: null,
        picks: null,
        washValues: null,
        map: null,
        mapImage: undefined,
        mapTriedAt: 0,
        mapFetching: null,
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
    robot.caps = modelCapabilities(robot.model, robot.firmware);
    const cached = this.store.get(did);
    // What the user set in Gladys only: the rooms picked, and the washing
    // frequency value of the frequency the robot is not set to.
    robot.picks = robot.picks || new Set((cached && cached.picks) || []);
    robot.washValues = robot.washValues || { ...((cached && cached.washValues) || {}) };
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
      const settings = parseSettings(robot.props.get(PROP.AUTO_SWITCH));
      robot.settingKeys = new Set(settings ? settings.keys() : []);
    } else if (!robot.settingKeys) {
      robot.settingKeys = new Set(
        (cached && cached.settingKeys) || (cached && cached.hasRoute ? [ROUTE_SETTING] : []),
      );
    }
    robot.hasRoute = robot.settingKeys.has(ROUTE_SETTING);
    robot.mopping = moppingOf(robot.caps, robot.capabilities, robot.settingKeys);
    if (robot.props.has(PROP.SHORTCUTS)) {
      robot.shortcuts = parseShortcuts(robot.props.get(PROP.SHORTCUTS));
    } else if (cached && robot.shortcuts.length === 0) {
      robot.shortcuts = cached.shortcuts || [];
    }
    let roomsRead = false;
    if (robot.reachable) {
      const trace = [];
      try {
        robot.mapTriedAt = Date.now();
        const map = await this.guard(() =>
          fetchMap(this.cloud, robot, {
            waitForPush: (ms) => this.waitForMapLocation(robot, ms),
            trace,
          }),
        );
        robot.rooms = map.rooms;
        this.keepMap(robot, map);
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
    // A room gone from the map is no longer picked.
    const roomIds = new Set(robot.rooms.map((room) => String(room.id)));
    robot.picks = new Set([...robot.picks].filter((room) => roomIds.has(room)));
    this.saveRobot(robot);
  }

  saveRobot(robot) {
    this.store.set(robot.did, {
      capabilities: [...robot.capabilities],
      rooms: robot.rooms,
      shortcuts: robot.shortcuts,
      hasRoute: Boolean(robot.hasRoute),
      settingKeys: [...(robot.settingKeys || [])],
      picks: [...(robot.picks || [])],
      washValues: robot.washValues || {},
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
    this.applyProps(
      robot,
      changes.map(({ key, value }) => [key, value]),
    );
    for (const { key, value } of changes) {
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
      this.applyProps(robot, props);
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
    const code = String(feature.external_id).split(':').pop();
    await this.runCommand(robot, code, value);
  }

  /**
   * Send what a feature value stands for (from Gladys or a widget button).
   * @param {object} robot the robot
   * @param {string} code the feature code
   * @param {*} value the value
   */
  async runCommand(robot, code, value) {
    this.requireCloud();
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
      mopping: robot.mopping,
      washValues: robot.washValues,
      rooms: robot.rooms,
      picks: robot.picks,
    });
    await this.execute(robot, code, command);
  }

  /**
   * Send a command built by buildCommand() (or a clean of rooms).
   * @param {object} robot the robot
   * @param {string} code the feature it came from
   * @param {object|null} command the command
   */
  async execute(robot, code, command) {
    const cloud = this.requireCloud();
    if (!command) {
      return;
    }
    if (command.kind === 'pick') {
      // Kept by the integration: the robot has no such setting.
      if (command.on) {
        robot.picks.add(command.room);
      } else {
        robot.picks.delete(command.room);
      }
      this.saveRobot(robot);
      this.nudge(WIDGET.QUICK_CLEAN);
      await this.publishRobot(robot);
      return;
    }
    if (command.kind === 'set') {
      await this.guard(() => cloud.setProperty(robot, command.key, command.value));
      this.applyProps(robot, [[command.key, command.value]]);
    } else if (command.kind === 'writes') {
      // One at a time and in order, as the app writes them.
      for (const write of command.writes) {
        await this.guard(() => cloud.setProperty(robot, write.key, write.value));
        this.applyProps(robot, [[write.key, write.value]]);
      }
    } else {
      await this.guard(() => cloud.action(robot, command.action, command.params));
    }
    if (command.remember) {
      robot.washValues = { ...robot.washValues, ...command.remember };
      this.saveRobot(robot);
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
    if (robot.mopping) {
      const washValues = washValuesOf(robot.props, robot.mopping, robot.washValues);
      if (JSON.stringify(washValues) !== JSON.stringify(robot.washValues)) {
        robot.washValues = washValues;
        this.saveRobot(robot);
      }
    }
    const states = buildStates(ids, robot.props, {
      newNumbering: robot.newNumbering,
      language: this.language,
      mopping: robot.mopping,
      washValues: robot.washValues,
      rooms: robot.rooms,
      picks: robot.picks,
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
   * Record property values of a robot, and nudge the widgets that show the
   * ones that changed — whether or not the robot was added to Gladys.
   * @param {object} robot the robot
   * @param {Iterable<Array>} entries `[key, value]` pairs
   */
  applyProps(robot, entries) {
    const changed = [];
    for (const [key, value] of entries) {
      const before = JSON.stringify(robot.props.get(key));
      setProp(robot, key, value);
      if (JSON.stringify(robot.props.get(key)) !== before) {
        changed.push(key);
      }
    }
    if (changed.length > 0 && robot.capabilities) {
      this.nudgeWidgets(changed);
    }
  }

  // --- Dashboard widgets -------------------------------------------------------

  /**
   * The robot a widget shows: the one picked in its settings, else the first.
   * @param {object} [settings] the widget settings (`robot`: a device external id)
   * @returns {object|null} the robot
   */
  widgetRobot(settings) {
    const did = settings && settings.robot ? didOf(this.gladys, settings.robot) : null;
    const known = [...this.robots.values()].filter((robot) => robot.capabilities);
    return (did && known.find((robot) => robot.did === did)) || known[0] || null;
  }

  viewOf(robot) {
    const device = this.createdDevice(robot);
    const image = this.mapImageOf(robot);
    return {
      did: robot.did,
      name: (device && device.name) || robot.name,
      props: robot.props,
      newNumbering: robot.newNumbering,
      mopping: robot.mopping,
      caps: robot.caps || null,
      ids: vacuumExternalIds(this.gladys, robot.did),
      features: device
        ? new Set((device.features || []).map((feature) => feature.external_id))
        : null,
      mapKey: image ? image.key : null,
      rooms: robot.rooms,
      shortcuts: robot.shortcuts,
      picks: robot.picks,
    };
  }

  /**
   * The content of a widget.
   * @param {string} key the widget key
   * @param {object} request `{ settings, language }` from Gladys
   * @returns {object} the content
   */
  widgetContent(key, { settings, language } = {}) {
    const lang = widgetLanguage(language);
    const robot = this.widgetRobot(settings);
    if (!robot) {
      return messageContent(texts(lang).widget.noRobot);
    }
    if (key === WIDGET.ROBOT) {
      this.ensureFreshMap(robot);
      return robotContent(this.viewOf(robot), lang);
    }
    if (key === WIDGET.QUICK_CLEAN) {
      return quickContent(this.viewOf(robot), settings || {}, lang);
    }
    if (key === WIDGET.ROBOT_SETTING) {
      return settingContent(this.viewOf(robot), settings || {}, lang);
    }
    if (key === WIDGET.MAINTENANCE) {
      return maintenanceContent(this.viewOf(robot), lang);
    }
    throw new Error(`Unknown widget: ${key}`);
  }

  /**
   * A widget button was pressed.
   * @param {string} actionKey the key of the button
   * @param {object} params what the content declared with it (`did`, and what
   *   the button does, see widgetCommand())
   * @returns {Promise<object>} the message shown, in both languages
   */
  async widgetAction(actionKey, params = {}) {
    const command = widgetCommand(actionKey, params);
    const robot = this.robots.get(String(params.did));
    if (!command || !robot || !robot.capabilities) {
      throw new Error(`Unknown widget action: ${actionKey}`);
    }
    if (command.rooms) {
      await this.execute(
        robot,
        FEATURE_CODES.CLEAN_ROOMS,
        buildRoomsClean(command.rooms, robot.props, robot.mopping),
      );
    } else {
      await this.runCommand(robot, command.code, command.value);
    }
    return {
      en: widgetMessage(actionKey, params, robot, 'en'),
      fr: widgetMessage(actionKey, params, robot, 'fr'),
    };
  }

  /**
   * The bytes of a widget image.
   * @param {string} key the image key
   * @returns {string} the image, raw base64
   */
  widgetImage(key) {
    const image = this.images.get(key);
    if (!image) {
      throw new Error(`Unknown image: ${key}`);
    }
    return image;
  }

  keepMap(robot, map) {
    robot.map = { frame: map.frame, saved: map.saved };
    // Drawn when a widget asks for it.
    robot.mapImage = undefined;
  }

  /**
   * The map of a robot as an image, drawn once per map read.
   * @param {object} robot the robot
   * @returns {{ key: string }|null} the image, null when there is none
   */
  mapImageOf(robot) {
    if (!robot.map) {
      return null;
    }
    if (robot.mapImage === undefined) {
      robot.mapImage = null;
      try {
        const image = renderMap(robot.map, {
          mapV2: Boolean(robot.caps && robot.caps.flags.has('mapV2')),
        });
        if (image) {
          robot.mapImage = { key: image.key };
          this.images.delete(image.key);
          this.images.set(image.key, image.png.toString('base64'));
          while (this.images.size > MAX_IMAGES) {
            this.images.delete(this.images.keys().next().value);
          }
        }
      } catch (err) {
        this.logger.warn(`Could not draw the map of "${robot.name}": ${err.message}`);
      }
    }
    return robot.mapImage;
  }

  /**
   * Re-read the map of a robot in the background when a dashboard shows it
   * and it is getting old; the widget is nudged when the image changed.
   * @param {object} robot the robot
   */
  ensureFreshMap(robot) {
    const state = gladysStateOf(robot.props, robot.newNumbering);
    const moving =
      state === VACUUM_CLEANER_STATE.RUNNING || state === VACUUM_CLEANER_STATE.RETURNING_TO_DOCK;
    const maxAge = moving ? this.timings.MAP_MAX_AGE_ACTIVE_MS : this.timings.MAP_MAX_AGE_IDLE_MS;
    if (
      robot.mapFetching ||
      robot.reachable === false ||
      !this.cloud ||
      this.authFailure ||
      Date.now() - robot.mapTriedAt < maxAge
    ) {
      return;
    }
    robot.mapTriedAt = Date.now();
    const before = robot.mapImage ? robot.mapImage.key : null;
    robot.mapFetching = this.guard(() =>
      fetchMap(this.cloud, robot, { waitForPush: (ms) => this.waitForMapLocation(robot, ms) }),
    )
      .then((map) => {
        this.keepMap(robot, map);
        const image = this.mapImageOf(robot);
        if (image && image.key !== before) {
          this.nudge(WIDGET.ROBOT);
        }
      })
      .catch((err) =>
        this.logger.debug(`Could not re-read the map of "${robot.name}": ${err.message}`),
      )
      .finally(() => {
        robot.mapFetching = null;
      });
  }

  /**
   * Properties changed: nudge the widgets that show them.
   * @param {Array<string>} keys the `siid.piid` keys that changed
   */
  nudgeWidgets(keys) {
    const wearKeys = new Set(CONSUMABLES.map((consumable) => consumable.prop));
    if (keys.some((key) => !wearKeys.has(key))) {
      this.nudge(WIDGET.ROBOT);
      this.nudge(WIDGET.QUICK_CLEAN);
      this.nudge(WIDGET.ROBOT_SETTING);
    }
    if (keys.some((key) => wearKeys.has(key))) {
      this.nudge(WIDGET.MAINTENANCE);
      this.nudge(WIDGET.ROBOT);
    }
  }

  /**
   * Ask Gladys to re-pull a widget: at once, or at the end of the current
   * window when one was just sent (Gladys drops the nudges in between).
   * @param {string} key the widget key
   */
  nudge(key) {
    if (typeof this.gladys.requestWidgetRefresh !== 'function') {
      return;
    }
    const entry = this.nudges.get(key) || { last: 0, timer: null };
    this.nudges.set(key, entry);
    if (entry.timer) {
      return;
    }
    const send = () => {
      entry.timer = null;
      entry.last = Date.now();
      try {
        this.gladys.requestWidgetRefresh(key);
      } catch (err) {
        this.logger.debug(`Widget nudge failed: ${err.message}`);
      }
    };
    const wait = entry.last + this.timings.WIDGET_NUDGE_MS - Date.now();
    if (wait <= 0) {
      send();
    } else {
      entry.timer = setTimeout(send, wait);
      entry.timer.unref?.();
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
