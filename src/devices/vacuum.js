// -----------------------------------------------------------------------------
// A Dreame robot seen from Gladys: its features, the states computed from its
// MIoT properties, and the command each feature sends.
//
// Features (only the ones the robot supports are published):
//   - state        vacuum-cleaner / state        <- 2.1 state (+ 2.2, 3.2, 4.1, 4.7, 4.17)
//   - run-mode     vacuum-cleaner / run-mode     -> start/resume (2.1) / stop (4.2)
//   - dock         vacuum-cleaner / dock         -> charge (3.1)
//   - pause        button / push                 -> pause (2.2), or resume (2.1) when paused
//   - suction      text / select                 <-> 4.4 suction level, the app's four
//   - clean-mode   vacuum-cleaner / clean-mode   -> 4.4, for the devices created before
//   - route        text / select                 <-> CleanRoute in the settings (4.50)
//   - battery      battery / integer             <- 3.1
//   - error        text / text                   <- 2.2, described
//   - room         text / select                 -> segment clean (4.1, kind 18)
//   - shortcut-<id> button / push                -> shortcut (4.1, kind 25)
//   - locate       button / push                 -> locate (7.1)
//   - consumable-<part> maintenance / life-remaining <- the percent left
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

import {
  ACTION,
  BATTERY_BOUNDS,
  CLEAN_MODE_TO_SUCTION,
  CONSUMABLES,
  CONSUMABLE_BOUNDS,
  DEFAULT_WATER_LEVEL,
  DREAME_CHARGING_STATUS,
  DREAME_MAPPING_STATES,
  DREAME_PAUSED_TASKS,
  DREAME_STATE,
  DREAME_STATE_TO_GLADYS,
  DREAME_STATUS,
  DREAME_TASK_COMPLETED,
  DREAME_TASK_DOCKING_PAUSED,
  DREAME_TASK_STATUS_VALUES,
  DREAME_WARNING_CODES,
  FEATURE_CODES,
  OLD_STATE_TO_NEW,
  PROP,
  ROOM_CLEAN_REPEATS,
  ROOM_SELECTION_NONE,
  ROUTES,
  ROUTE_SETTING,
  SUCTION_LEVELS,
  START_CUSTOM_PIID,
  SUCTION_TO_CLEAN_MODE,
  VACUUM_CLEANER_MODE,
  VACUUM_CLEANER_STATE,
} from '../constants.js';
import { parseSettings } from '../dreame/settings.js';
import { describeError, texts } from '../i18n.js';

// --- Features --------------------------------------------------------------------

/**
 * The cleaning route the robot is set to, when it has that setting.
 * @param {Map<string, *>} props the robot properties
 * @returns {object|null} the ROUTES entry, or null
 */
export function routeOf(props) {
  const settings = parseSettings(props.get(PROP.AUTO_SWITCH));
  const code = settings ? toNumber(settings.get(ROUTE_SETTING)) : null;
  return ROUTES.find((route) => route.code === code) || null;
}

/**
 * Build the Gladys features of a robot.
 * @param {object} ids external ids of the device (`{ device, feature(code) }`)
 * @param {object} robot what discovery learned
 * @param {Set<string>} robot.capabilities the `siid.piid` keys the robot answered
 * @param {Array} [robot.rooms] `[{ id, name }]`
 * @param {Array} [robot.shortcuts] `[{ id, name }]`
 * @param {boolean} [robot.hasRoute] whether it has the cleaning route setting
 * @param {string} language `fr` or `en`
 * @returns {Array} Gladys device features
 */
export function buildVacuumFeatures(
  ids,
  { capabilities, rooms = [], shortcuts = [], hasRoute = false },
  language,
) {
  const t = texts(language);
  const has = (key) => capabilities.has(key);
  const features = [];
  const add = (code, name, fields) =>
    features.push({ name, external_id: ids.feature(code), keep_history: false, ...fields });

  add(FEATURE_CODES.STATE, t.features.state, {
    category: DEVICE_FEATURE_CATEGORIES.VACUUM_CLEANER,
    type: DEVICE_FEATURE_TYPES.VACUUM_CLEANER.STATE,
    read_only: true,
    has_feedback: true,
    min: VACUUM_CLEANER_STATE.STOPPED,
    max: VACUUM_CLEANER_STATE.DOCKED,
  });
  add(FEATURE_CODES.RUN_MODE, t.features['run-mode'], {
    category: DEVICE_FEATURE_CATEGORIES.VACUUM_CLEANER,
    type: DEVICE_FEATURE_TYPES.VACUUM_CLEANER.RUN_MODE,
    read_only: false,
    has_feedback: true,
    min: VACUUM_CLEANER_MODE.IDLE,
    max: VACUUM_CLEANER_MODE.MAPPING,
  });
  add(FEATURE_CODES.DOCK, t.features.dock, {
    category: DEVICE_FEATURE_CATEGORIES.VACUUM_CLEANER,
    type: DEVICE_FEATURE_TYPES.VACUUM_CLEANER.DOCK,
    read_only: false,
    has_feedback: false,
    min: 0,
    max: 1,
  });
  add(FEATURE_CODES.PAUSE, t.features.pause, pushButton());
  if (has(PROP.SUCTION_LEVEL)) {
    add(FEATURE_CODES.SUCTION, t.features.suction, {
      category: DEVICE_FEATURE_CATEGORIES.TEXT,
      type: DEVICE_FEATURE_TYPES.TEXT.SELECT,
      read_only: false,
      has_feedback: true,
      min: 0,
      max: 0,
      supported_options: SUCTION_LEVELS.map((level, index) => ({
        value: level.value,
        label: t.suctions[level.value],
        sort_order: index,
      })),
    });
  }
  if (hasRoute) {
    add(FEATURE_CODES.ROUTE, t.features.route, {
      category: DEVICE_FEATURE_CATEGORIES.TEXT,
      type: DEVICE_FEATURE_TYPES.TEXT.SELECT,
      read_only: false,
      has_feedback: true,
      min: 0,
      max: 0,
      supported_options: ROUTES.map((route, index) => ({
        value: route.value,
        label: t.routes[route.value],
        sort_order: index,
      })),
    });
  }
  if (has(PROP.BATTERY)) {
    add(FEATURE_CODES.BATTERY, t.features.battery, {
      category: DEVICE_FEATURE_CATEGORIES.BATTERY,
      type: DEVICE_FEATURE_TYPES.BATTERY.INTEGER,
      read_only: true,
      has_feedback: true,
      keep_history: true,
      unit: DEVICE_FEATURE_UNITS.PERCENT,
      min: BATTERY_BOUNDS.MIN,
      max: BATTERY_BOUNDS.MAX,
    });
  }
  if (has(PROP.ERROR)) {
    add(FEATURE_CODES.ERROR, t.features.error, {
      category: DEVICE_FEATURE_CATEGORIES.TEXT,
      type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
      read_only: true,
      has_feedback: true,
      // NOT NULL in t_device_feature, even on a text feature.
      min: 0,
      max: 0,
    });
  }
  if (rooms.length > 0) {
    add(FEATURE_CODES.ROOM, t.features.room, {
      category: DEVICE_FEATURE_CATEGORIES.TEXT,
      type: DEVICE_FEATURE_TYPES.TEXT.SELECT,
      read_only: false,
      has_feedback: false,
      min: 0,
      max: 0,
      supported_options: [
        { value: ROOM_SELECTION_NONE, label: '—', sort_order: 0 },
        ...rooms.map((room, index) => ({
          value: String(room.id),
          label: room.name,
          sort_order: index + 1,
        })),
      ],
    });
  }
  for (const shortcut of shortcuts) {
    add(
      `${FEATURE_CODES.SHORTCUT_PREFIX}${shortcut.id}`,
      `${t.features.shortcut} - ${shortcut.name}`,
      pushButton(),
    );
  }
  add(FEATURE_CODES.LOCATE, t.features.locate, pushButton());
  for (const consumable of CONSUMABLES) {
    if (!has(consumable.prop)) {
      continue;
    }
    add(`${FEATURE_CODES.CONSUMABLE_PREFIX}${consumable.code}`, t.consumables[consumable.code], {
      category: DEVICE_FEATURE_CATEGORIES.MAINTENANCE,
      type: DEVICE_FEATURE_TYPES.MAINTENANCE.LIFE_REMAINING,
      read_only: true,
      has_feedback: true,
      keep_history: true,
      unit: DEVICE_FEATURE_UNITS.PERCENT,
      min: CONSUMABLE_BOUNDS.MIN,
      max: CONSUMABLE_BOUNDS.MAX,
    });
  }
  return features;
}

function pushButton() {
  return {
    category: DEVICE_FEATURE_CATEGORIES.BUTTON,
    type: DEVICE_FEATURE_TYPES.BUTTON.PUSH,
    read_only: false,
    has_feedback: false,
    min: 0,
    max: 1,
  };
}

// --- States ----------------------------------------------------------------------

/**
 * The STATE property in the current numbering.
 * @param {*} value the raw 2.1 value
 * @param {boolean} newNumbering whether the robot already numbers the new way
 * @returns {number|null} the state, or null when absent
 */
export function normalizeState(value, newNumbering) {
  const state = toNumber(value);
  if (state === null) {
    return null;
  }
  if (!newNumbering && state > 18 && OLD_STATE_TO_NEW[state] !== undefined) {
    return OLD_STATE_TO_NEW[state];
  }
  return state;
}

/**
 * Whether the robot has a task under way (running or paused), as the app
 * decides it.
 * @param {Map<string, *>} props the robot properties
 * @returns {boolean} true when a task is under way
 */
export function hasTask(props) {
  const taskStatus = toNumber(props.get(PROP.TASK_STATUS));
  const status = toNumber(props.get(PROP.STATUS));
  const cleaningPaused = toNumber(props.get(PROP.CLEANING_PAUSED));
  return (
    (taskStatus !== null &&
      taskStatus !== DREAME_TASK_COMPLETED &&
      taskStatus !== DREAME_TASK_DOCKING_PAUSED) ||
    (cleaningPaused !== null && cleaningPaused > 0) ||
    (status !== null && DREAME_TASK_STATUS_VALUES.has(status))
  );
}

/**
 * Whether the task under way is paused (by the user, or waiting for a charge).
 * @param {Map<string, *>} props the robot properties
 * @returns {boolean} true when paused
 */
export function isTaskPaused(props) {
  const taskStatus = toNumber(props.get(PROP.TASK_STATUS));
  const cleaningPaused = toNumber(props.get(PROP.CLEANING_PAUSED));
  return (
    (taskStatus !== null && DREAME_PAUSED_TASKS.has(taskStatus)) ||
    (cleaningPaused !== null && cleaningPaused > 0)
  );
}

/**
 * The Gladys state of the robot.
 * @param {Map<string, *>} props the robot properties
 * @param {boolean} newNumbering whether the robot numbers its states the new way
 * @returns {number|null} a VACUUM_CLEANER_STATE value, or null when unknown
 */
export function gladysStateOf(props, newNumbering) {
  const error = toNumber(props.get(PROP.ERROR));
  if (error !== null && error > 0 && !DREAME_WARNING_CODES.has(error)) {
    return VACUUM_CLEANER_STATE.ERROR;
  }
  const state = normalizeState(props.get(PROP.STATE), newNumbering);
  if (state === null) {
    return null;
  }
  if (state === DREAME_STATE.IDLE) {
    // Idle means three different things: a task stopped midway (paused),
    // sitting on the charger, or stopped away from it.
    if (hasTask(props)) {
      return VACUUM_CLEANER_STATE.PAUSED;
    }
    const charging = toNumber(props.get(PROP.CHARGING_STATUS));
    if (charging === DREAME_CHARGING_STATUS.CHARGING) {
      return VACUUM_CLEANER_STATE.CHARGING;
    }
    if (charging === DREAME_CHARGING_STATUS.CHARGING_COMPLETED) {
      return VACUUM_CLEANER_STATE.DOCKED;
    }
    return VACUUM_CLEANER_STATE.STOPPED;
  }
  const mapped = DREAME_STATE_TO_GLADYS[state];
  return mapped === undefined ? null : mapped;
}

/**
 * The Gladys run mode: Cleaning while a task actively runs, Mapping while the
 * robot builds a map, Idle otherwise — a paused task included, so choosing
 * Cleaning again resumes it.
 * @param {Map<string, *>} props the robot properties
 * @param {number|null} gladysState the state from gladysStateOf()
 * @param {boolean} newNumbering whether the robot numbers its states the new way
 * @returns {number|null} a VACUUM_CLEANER_MODE value, or null when unknown
 */
export function runModeOf(props, gladysState, newNumbering) {
  if (gladysState === null) {
    return null;
  }
  const state = normalizeState(props.get(PROP.STATE), newNumbering);
  const status = toNumber(props.get(PROP.STATUS));
  const active =
    gladysState !== VACUUM_CLEANER_STATE.PAUSED && gladysState !== VACUUM_CLEANER_STATE.ERROR;
  if (active && (DREAME_MAPPING_STATES.has(state) || status === DREAME_STATUS.FAST_MAPPING)) {
    return VACUUM_CLEANER_MODE.MAPPING;
  }
  if (active && hasTask(props) && !isTaskPaused(props)) {
    return VACUUM_CLEANER_MODE.CLEANING;
  }
  return VACUUM_CLEANER_MODE.IDLE;
}

/**
 * Compute the Gladys states of a robot from its properties.
 * @param {object} ids external ids of the device
 * @param {Map<string, *>} props the robot properties
 * @param {object} context how to read them
 * @param {boolean} context.newNumbering whether the robot numbers its states the new way
 * @param {string} context.language `fr` or `en`
 * @returns {Array} states for gladys.publishStates()
 */
export function buildStates(ids, props, { newNumbering, language }) {
  const states = [];
  const push = (code, state) =>
    states.push({ device_feature_external_id: ids.feature(code), state });

  const gladysState = gladysStateOf(props, newNumbering);
  if (gladysState !== null) {
    push(FEATURE_CODES.STATE, gladysState);
    push(FEATURE_CODES.RUN_MODE, runModeOf(props, gladysState, newNumbering));
  }
  const suction = toNumber(props.get(PROP.SUCTION_LEVEL));
  const level = SUCTION_LEVELS.find((candidate) => candidate.code === suction);
  if (level) {
    states.push({
      device_feature_external_id: ids.feature(FEATURE_CODES.SUCTION),
      text: level.value,
    });
  }
  // Devices created before the suction select still carry the clean mode.
  const cleanMode = SUCTION_TO_CLEAN_MODE[suction];
  if (cleanMode !== undefined) {
    push(FEATURE_CODES.CLEAN_MODE, cleanMode);
  }
  const route = routeOf(props);
  if (route) {
    states.push({
      device_feature_external_id: ids.feature(FEATURE_CODES.ROUTE),
      text: route.value,
    });
  }
  const battery = toNumber(props.get(PROP.BATTERY));
  if (battery !== null) {
    push(FEATURE_CODES.BATTERY, clamp(battery, BATTERY_BOUNDS));
  }
  const error = toNumber(props.get(PROP.ERROR));
  if (error !== null) {
    states.push({
      device_feature_external_id: ids.feature(FEATURE_CODES.ERROR),
      text: describeError(error, language),
    });
  }
  for (const consumable of CONSUMABLES) {
    const left = toNumber(props.get(consumable.prop));
    if (left !== null) {
      push(`${FEATURE_CODES.CONSUMABLE_PREFIX}${consumable.code}`, clamp(left, CONSUMABLE_BOUNDS));
    }
  }
  return states;
}

/**
 * Whether the robot is cleaning rooms (a segment clean), to know when the room
 * selector can be reset.
 * @param {Map<string, *>} props the robot properties
 * @returns {boolean} true during a room clean, paused or not
 */
export function isRoomCleaning(props) {
  return toNumber(props.get(PROP.STATUS)) === DREAME_STATUS.SEGMENT_CLEANING && hasTask(props);
}

// --- Commands --------------------------------------------------------------------

export class UnsupportedCommandError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnsupportedCommandError';
  }
}

/**
 * The water level to send with a room clean: the one the robot is set to.
 * Self-washing stations keep it in the third byte of the cleaning mode (4.23),
 * the other robots in 4.5.
 * @param {Map<string, *>} props the robot properties
 * @returns {number} 1 (low) to 3 (high)
 */
export function waterLevelOf(props) {
  const valid = (level) => (level >= 1 && level <= 3 ? level : null);
  const mode = toNumber(props.get(PROP.CLEANING_MODE));
  if (props.has(PROP.SELF_WASH_BASE_STATUS) && mode !== null && valid(mode >> 16)) {
    return mode >> 16;
  }
  return valid(toNumber(props.get(PROP.WATER_VOLUME))) || DEFAULT_WATER_LEVEL;
}

/**
 * The robot command a feature value stands for.
 * @param {string} code the feature code (last segment of its external id)
 * @param {*} value the value Gladys sent
 * @param {Map<string, *>} props the robot properties (for room cleans)
 * @param {object} [context] what the robot is doing
 * @param {boolean} [context.paused] whether its task is paused
 * @returns {object|null} `{ kind: 'action', action, params }`,
 *   `{ kind: 'set', key, value }`, or null when there is nothing to do
 * @throws {UnsupportedCommandError} when the value cannot be honoured
 */
export function buildCommand(code, value, props, { paused = false } = {}) {
  const number = toNumber(value);
  if (code === FEATURE_CODES.RUN_MODE) {
    if (number === VACUUM_CLEANER_MODE.CLEANING) {
      // Starts a full clean, or resumes the paused task.
      return { kind: 'action', action: ACTION.START, params: [] };
    }
    if (number === VACUUM_CLEANER_MODE.IDLE) {
      return { kind: 'action', action: ACTION.STOP, params: [] };
    }
    throw new UnsupportedCommandError(
      'Mapping cannot be started from Gladys: use the Dreamehome app to map the home',
    );
  }
  if (code === FEATURE_CODES.CLEAN_MODE) {
    const suction = CLEAN_MODE_TO_SUCTION[number];
    if (suction === undefined) {
      throw new UnsupportedCommandError(
        'Dreame robots offer four suction levels: Quiet, Auto (standard), Deep Clean (strong) and Vacuum (turbo)',
      );
    }
    return { kind: 'set', key: PROP.SUCTION_LEVEL, value: suction };
  }
  // Push buttons only act on a press; a release (0) is ignored.
  if (code === FEATURE_CODES.DOCK) {
    return number === 1 ? { kind: 'action', action: ACTION.CHARGE, params: [] } : null;
  }
  if (code === FEATURE_CODES.PAUSE) {
    if (number !== 1) {
      return null;
    }
    // One button both ways, as on the robot: a second press resumes.
    return { kind: 'action', action: paused ? ACTION.START : ACTION.PAUSE, params: [] };
  }
  if (code === FEATURE_CODES.SUCTION) {
    const level = SUCTION_LEVELS.find((candidate) => candidate.value === value);
    if (!level) {
      throw new UnsupportedCommandError(`Unknown suction level "${value}"`);
    }
    return { kind: 'set', key: PROP.SUCTION_LEVEL, value: level.code };
  }
  if (code === FEATURE_CODES.ROUTE) {
    const route = ROUTES.find((candidate) => candidate.value === value);
    if (!route) {
      throw new UnsupportedCommandError(`Unknown cleaning route "${value}"`);
    }
    return {
      kind: 'set',
      key: PROP.AUTO_SWITCH,
      value: JSON.stringify({ k: ROUTE_SETTING, v: route.code }),
    };
  }
  if (code === FEATURE_CODES.LOCATE) {
    return number === 1 ? { kind: 'action', action: ACTION.LOCATE, params: [] } : null;
  }
  if (code === FEATURE_CODES.ROOM) {
    if (value === ROOM_SELECTION_NONE) {
      return null;
    }
    const room = toNumber(value);
    if (!Number.isSafeInteger(room) || room <= 0) {
      throw new UnsupportedCommandError(`Unknown room "${value}"`);
    }
    const suction = toNumber(props.get(PROP.SUCTION_LEVEL));
    const selects = [
      [room, ROOM_CLEAN_REPEATS, suction === null ? 1 : suction, waterLevelOf(props), 1],
    ];
    return {
      kind: 'action',
      action: ACTION.START_CUSTOM,
      params: [
        { piid: START_CUSTOM_PIID.STATUS, value: DREAME_STATUS.SEGMENT_CLEANING },
        { piid: START_CUSTOM_PIID.PARAMETERS, value: JSON.stringify({ selects }) },
      ],
    };
  }
  if (code.startsWith(FEATURE_CODES.SHORTCUT_PREFIX)) {
    if (number !== 1) {
      return null;
    }
    const id = toNumber(code.slice(FEATURE_CODES.SHORTCUT_PREFIX.length));
    if (!Number.isSafeInteger(id) || id < 0) {
      throw new UnsupportedCommandError(`Unknown shortcut "${code}"`);
    }
    return {
      kind: 'action',
      action: ACTION.START_CUSTOM,
      params: [
        { piid: START_CUSTOM_PIID.STATUS, value: DREAME_STATUS.SHORTCUT },
        { piid: START_CUSTOM_PIID.PARAMETERS, value: String(id) },
      ],
    };
  }
  throw new UnsupportedCommandError(`Feature "${code}" cannot be controlled`);
}

// --- Helpers -------------------------------------------------------------------------

function toNumber(value) {
  if (typeof value === 'boolean') {
    // MIoT flags may come as booleans (4.17 "paused for a charge" on some models).
    return value ? 1 : 0;
  }
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, { MIN, MAX }) {
  return Math.round(Math.min(MAX, Math.max(MIN, value)));
}
