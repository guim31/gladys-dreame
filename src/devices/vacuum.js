// -----------------------------------------------------------------------------
// A Dreame robot seen from Gladys: its features, the states computed from its
// MIoT properties, and the command each feature sends.
//
// Features (only the ones the robot supports are published):
//   - state        vacuum-cleaner / state        <- 2.1 state (+ 2.2, 3.2, 4.1, 4.7, 4.17)
//   - run-mode     vacuum-cleaner / run-mode     -> start/resume (2.1) / stop (4.2)
//   - dock         vacuum-cleaner / dock         -> charge (3.1)
//   - pause        button / push                 -> pause (2.2), or resume (2.1) when paused
//   - cleaning-mode text / select                <-> 4.23 (+ 4.26), see dreame/mopping.js
//   - suction      text / select                 <-> 4.4 suction level, the app's four
//   - clean-mode   vacuum-cleaner / clean-mode   -> 4.4, for the devices created before
//   - max-suction  switch / binary               <-> SuctionMax in the settings (4.50)
//   - wetness      switch / dimmer               <-> 28.1 mop wetness, 1 to 32
//   - mop-wash-frequency text / select           <-> BackWashType in the settings (4.50)
//   - mop-wash-area switch / dimmer              <-> 4.23 byte 1, when washing by area
//   - mop-wash-time switch / dimmer              <-> 4.23 byte 1, when washing by time
//   - route        text / select                 <-> CleanRoute in the settings (4.50)
//   - battery      battery / integer             <- 3.1
//   - error        text / text                   <- 2.2, described
//   - room         text / select                 -> segment clean (4.1, kind 18)
//   - room-pick-<id> switch / binary             <-> the rooms picked, kept by the integration
//   - clean-rooms  button / push                 -> segment clean of the rooms picked
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
  CLEANING_MODES,
  MAX_SUCTION_SETTING,
  OLD_STATE_TO_NEW,
  WASH_FREQUENCIES,
  WASH_FREQUENCY_SETTING,
  WETNESS_BOUNDS,
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
import {
  cleaningModeOf,
  cleaningModeWrites,
  routeAllowed,
  sweepsOnly,
  washFrequencyOf,
  washLimits,
  washValueOf,
  washValueWrite,
} from '../dreame/mopping.js';
import { tracksConsumable } from '../dreame/models.js';
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
 * Whether the max suction boost is on.
 * @param {Map<string, *>} props the robot properties
 * @returns {number|null} 1 or 0, null when the robot has no such setting
 */
export function maxSuctionOf(props) {
  const settings = parseSettings(props.get(PROP.AUTO_SWITCH));
  if (!settings || !settings.has(MAX_SUCTION_SETTING)) {
    return null;
  }
  return toNumber(settings.get(MAX_SUCTION_SETTING)) > 0 ? 1 : 0;
}

/**
 * The washing frequency values to show on the two sliders: the robot's own
 * for the frequency it is set to, the last one known for the other.
 * @param {Map<string, *>} props the robot properties
 * @param {object} mopping moppingOf() of the robot
 * @param {object} [known] `{ area, time }` known so far
 * @returns {{ area: number|null, time: number|null }} the values
 */
export function washValuesOf(props, mopping, known = {}) {
  const result = { area: known.area ?? null, time: known.time ?? null };
  const wash = washValueOf(props);
  if (!mopping.washArea || !wash) {
    return result;
  }
  const frequency = mopping.washFrequency ? washFrequencyOf(props) : null;
  if (!mopping.washFrequency || (frequency && frequency.value === 'by-area')) {
    result.area = wash;
  } else if (frequency && frequency.value === 'by-time') {
    result.time = wash;
  }
  return result;
}

function selectOptions(entries, labels) {
  return entries.map((entry, index) => ({
    value: entry.value,
    label: labels[entry.value],
    sort_order: index,
  }));
}

/**
 * Build the Gladys features of a robot.
 * @param {object} ids external ids of the device (`{ device, feature(code) }`)
 * @param {object} robot what discovery learned
 * @param {Set<string>} robot.capabilities the `siid.piid` keys the robot answered
 * @param {Array} [robot.rooms] `[{ id, name }]`
 * @param {Array} [robot.shortcuts] `[{ id, name }]`
 * @param {boolean} [robot.hasRoute] whether it has the cleaning route setting
 * @param {Set<string>} [robot.settingKeys] the settings (4.50) it has
 * @param {object} [robot.mopping] moppingOf() of the robot
 * @param {object|null} [robot.caps] modelCapabilities() of the robot (the wear
 *   parts it really has)
 * @param {string} language `fr` or `en`
 * @returns {Array} Gladys device features
 */
export function buildVacuumFeatures(
  ids,
  {
    capabilities,
    rooms = [],
    shortcuts = [],
    hasRoute = false,
    settingKeys = new Set(),
    mopping = null,
    caps = null,
  },
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
  if (mopping && mopping.cleaningMode) {
    const modes = CLEANING_MODES.filter(
      (mode) =>
        (mode.value !== 'mopping-after-sweeping' || mopping.afterSweeping) &&
        (mode.value !== 'custom' || mopping.custom),
    );
    add(FEATURE_CODES.CLEANING_MODE, t.features['cleaning-mode'], {
      ...textSelect(),
      supported_options: selectOptions(modes, t.cleaningModes),
    });
  }
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
  if (settingKeys.has(MAX_SUCTION_SETTING)) {
    add(FEATURE_CODES.MAX_SUCTION, t.features['max-suction'], switchBinary());
  }
  if (mopping && mopping.wetness) {
    add(FEATURE_CODES.WETNESS, t.features.wetness, {
      ...slider(),
      min: WETNESS_BOUNDS.MIN,
      max: WETNESS_BOUNDS.MAX,
    });
  }
  if (mopping && mopping.washFrequency) {
    add(FEATURE_CODES.WASH_FREQUENCY, t.features['mop-wash-frequency'], {
      ...textSelect(),
      supported_options: selectOptions(WASH_FREQUENCIES, t.washFrequencies),
    });
  }
  if (mopping && (mopping.washArea || mopping.washTime)) {
    // The widest bounds: the current ones depend on the wetness, and are
    // enforced when a value is set.
    const limits = washLimits(mopping, null);
    if (mopping.washArea) {
      add(FEATURE_CODES.WASH_AREA, t.features['mop-wash-area'], {
        ...slider(),
        unit: DEVICE_FEATURE_UNITS.SQUARE_METER,
        min: limits.area.min,
        max: limits.area.max,
      });
    }
    if (mopping.washTime) {
      add(FEATURE_CODES.WASH_TIME, t.features['mop-wash-time'], {
        ...slider(),
        unit: DEVICE_FEATURE_UNITS.MINUTES,
        min: limits.time.min,
        max: limits.time.max,
      });
    }
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
    // Several rooms at once: switch the rooms on, then press the button.
    for (const room of rooms) {
      add(
        `${FEATURE_CODES.ROOM_PICK_PREFIX}${room.id}`,
        `${t.features['room-pick']} - ${room.name}`,
        switchBinary(),
      );
    }
    add(FEATURE_CODES.CLEAN_ROOMS, t.features['clean-rooms'], pushButton());
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
    if (!has(consumable.prop) || !tracksConsumable(caps, consumable)) {
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

function textSelect() {
  return {
    category: DEVICE_FEATURE_CATEGORIES.TEXT,
    type: DEVICE_FEATURE_TYPES.TEXT.SELECT,
    read_only: false,
    has_feedback: true,
    min: 0,
    max: 0,
  };
}

function switchBinary() {
  return {
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
    read_only: false,
    has_feedback: true,
    min: 0,
    max: 1,
  };
}

// A slider: the only settable number the Gladys dashboard draws.
function slider() {
  return {
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.DIMMER,
    read_only: false,
    has_feedback: true,
  };
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
 * @param {object} [context.mopping] moppingOf() of the robot
 * @param {object} [context.washValues] washValuesOf() of the robot
 * @param {Array} [context.rooms] `[{ id }]`, for the room switches
 * @param {Set<string>} [context.picks] the ids of the rooms picked
 * @returns {Array} states for gladys.publishStates()
 */
export function buildStates(
  ids,
  props,
  { newNumbering, language, mopping = null, washValues = null, rooms = [], picks = new Set() },
) {
  const states = [];
  const push = (code, state) =>
    states.push({ device_feature_external_id: ids.feature(code), state });
  const pushText = (code, text) =>
    states.push({ device_feature_external_id: ids.feature(code), text });

  const gladysState = gladysStateOf(props, newNumbering);
  if (gladysState !== null) {
    push(FEATURE_CODES.STATE, gladysState);
    push(FEATURE_CODES.RUN_MODE, runModeOf(props, gladysState, newNumbering));
  }
  const suction = toNumber(props.get(PROP.SUCTION_LEVEL));
  const level = SUCTION_LEVELS.find((candidate) => candidate.code === suction);
  if (level) {
    pushText(FEATURE_CODES.SUCTION, level.value);
  }
  // Devices created before the suction select still carry the clean mode.
  const cleanMode = SUCTION_TO_CLEAN_MODE[suction];
  if (cleanMode !== undefined) {
    push(FEATURE_CODES.CLEAN_MODE, cleanMode);
  }
  const route = routeOf(props);
  if (route) {
    pushText(FEATURE_CODES.ROUTE, route.value);
  }
  const maxSuction = maxSuctionOf(props);
  if (maxSuction !== null) {
    push(FEATURE_CODES.MAX_SUCTION, maxSuction);
  }
  if (mopping) {
    const mode = cleaningModeOf(props, mopping);
    if (mode) {
      pushText(FEATURE_CODES.CLEANING_MODE, mode);
    }
    const wetness = toNumber(props.get(PROP.WETNESS_LEVEL));
    if (mopping.wetness && wetness !== null) {
      push(FEATURE_CODES.WETNESS, wetness);
    }
    const frequency = mopping.washFrequency ? washFrequencyOf(props) : null;
    if (frequency) {
      pushText(FEATURE_CODES.WASH_FREQUENCY, frequency.value);
    }
    if (washValues && mopping.washArea && washValues.area) {
      push(FEATURE_CODES.WASH_AREA, washValues.area);
    }
    if (washValues && mopping.washTime && washValues.time) {
      push(FEATURE_CODES.WASH_TIME, washValues.time);
    }
  }
  for (const room of rooms) {
    push(`${FEATURE_CODES.ROOM_PICK_PREFIX}${room.id}`, picks.has(String(room.id)) ? 1 : 0);
  }
  const battery = toNumber(props.get(PROP.BATTERY));
  if (battery !== null) {
    push(FEATURE_CODES.BATTERY, clamp(battery, BATTERY_BOUNDS));
  }
  const error = toNumber(props.get(PROP.ERROR));
  if (error !== null) {
    pushText(FEATURE_CODES.ERROR, describeError(error, language));
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
 * A room clean: the rooms with the suction and water the robot is set to.
 * @param {Array<number>} rooms the room ids, in cleaning order
 * @param {Map<string, *>} props the robot properties
 * @param {boolean} fixedIndex whether each entry carries 1 as its index (the
 *   robots with room-by-room settings, and the fifth generation, stop
 *   otherwise), rather than its position
 * @returns {object} the START_CUSTOM action
 */
function roomClean(rooms, props, fixedIndex) {
  const suction = toNumber(props.get(PROP.SUCTION_LEVEL));
  const selects = rooms.map((room, index) => [
    room,
    ROOM_CLEAN_REPEATS,
    suction === null ? 1 : suction,
    waterLevelOf(props),
    fixedIndex ? 1 : index + 1,
  ]);
  return {
    kind: 'action',
    action: ACTION.START_CUSTOM,
    params: [
      { piid: START_CUSTOM_PIID.STATUS, value: DREAME_STATUS.SEGMENT_CLEANING },
      { piid: START_CUSTOM_PIID.PARAMETERS, value: JSON.stringify({ selects }) },
    ],
  };
}

/**
 * A clean of several rooms, outside the rooms picked (a widget button).
 * @param {Array<number>} rooms the room ids
 * @param {Map<string, *>} props the robot properties
 * @param {object|null} mopping moppingOf() of the robot
 * @returns {object} the START_CUSTOM action
 */
export function buildRoomsClean(rooms, props, mopping) {
  const ids = rooms.map(Number).filter((room) => Number.isSafeInteger(room) && room > 0);
  if (ids.length === 0) {
    throw new UnsupportedCommandError('No room to clean');
  }
  return roomClean(ids, props, Boolean(mopping && (mopping.custom || mopping.gen5)));
}

function settingWrite(key, value) {
  return { key: PROP.AUTO_SWITCH, value: JSON.stringify({ k: key, v: value }) };
}

function within(value, { min, max }) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * The robot command a feature value stands for.
 * @param {string} code the feature code (last segment of its external id)
 * @param {*} value the value Gladys sent
 * @param {Map<string, *>} props the robot properties (for room cleans)
 * @param {object} [context] what the robot is doing
 * @param {boolean} [context.paused] whether its task is paused
 * @param {object} [context.mopping] moppingOf() of the robot
 * @param {object} [context.washValues] washValuesOf() of the robot
 * @param {Array} [context.rooms] `[{ id }]`, in the order of the app
 * @param {Set<string>} [context.picks] the ids of the rooms picked
 * @returns {object|null} `{ kind: 'action', action, params }`,
 *   `{ kind: 'set', key, value }`, `{ kind: 'writes', writes }` (several
 *   properties, in order), `{ kind: 'pick', room, on }`, or null when there is
 *   nothing to do; `remember` (`{ area }` or `{ time }`) comes with a washing
 *   frequency value to keep
 * @throws {UnsupportedCommandError} when the value cannot be honoured
 */
export function buildCommand(
  code,
  value,
  props,
  { paused = false, mopping = null, washValues = {}, rooms = [], picks = new Set() } = {},
) {
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
    const writes = [];
    if (maxSuctionOf(props) === 1) {
      // As in the app: a level chosen ends the max suction boost.
      writes.push(settingWrite(MAX_SUCTION_SETTING, 0));
    }
    writes.push({ key: PROP.SUCTION_LEVEL, value: level.code });
    return { kind: 'writes', writes };
  }
  if (code === FEATURE_CODES.MAX_SUCTION) {
    return { kind: 'writes', writes: [settingWrite(MAX_SUCTION_SETTING, number > 0 ? 1 : 0)] };
  }
  if (code === FEATURE_CODES.ROUTE) {
    const route = ROUTES.find((candidate) => candidate.value === value);
    if (!route) {
      throw new UnsupportedCommandError(`Unknown cleaning route "${value}"`);
    }
    if (mopping && !routeAllowed(route.code, cleaningModeOf(props, mopping), mopping)) {
      throw new UnsupportedCommandError(
        `The "${value}" route only exists when mopping: choose a mopping cleaning mode first`,
      );
    }
    return { kind: 'writes', writes: [settingWrite(ROUTE_SETTING, route.code)] };
  }
  if (code === FEATURE_CODES.CLEANING_MODE) {
    if (!mopping || !mopping.cleaningMode) {
      throw new UnsupportedCommandError('The cleaning mode of this robot cannot be set');
    }
    let writes;
    try {
      writes = cleaningModeWrites(value, props, mopping);
    } catch (err) {
      throw new UnsupportedCommandError(err.message);
    }
    const route = routeOf(props);
    if (route && sweepsOnly(value) && !routeAllowed(route.code, value, mopping)) {
      // As in the app: a sweeping mode falls back on the standard route.
      writes.push(settingWrite(ROUTE_SETTING, ROUTES.find((r) => r.value === 'standard').code));
    }
    return { kind: 'writes', writes };
  }
  if (code === FEATURE_CODES.WETNESS) {
    if (!mopping || !mopping.wetness || number === null) {
      throw new UnsupportedCommandError('The mop wetness of this robot cannot be set');
    }
    const wetness = within(number, { min: WETNESS_BOUNDS.MIN, max: WETNESS_BOUNDS.MAX });
    const writes = [{ key: PROP.WETNESS_LEVEL, value: wetness }];
    // Wetter mops are washed sooner: bring the washing frequency within the
    // new bounds, as the app does.
    const wash = washValueOf(props);
    const frequency = mopping.washFrequency ? washFrequencyOf(props) : null;
    if (mopping.washArea && wash) {
      const limits = washLimits(mopping, wetness);
      const bounds = frequency && frequency.value === 'by-time' ? limits.time : limits.area;
      if (wash > bounds.max) {
        writes.push(washValueWrite(props, bounds.max));
      }
    }
    return { kind: 'writes', writes };
  }
  if (code === FEATURE_CODES.WASH_FREQUENCY) {
    if (!mopping || !mopping.washFrequency) {
      throw new UnsupportedCommandError('The mop washing frequency of this robot cannot be set');
    }
    const frequency = WASH_FREQUENCIES.find((candidate) => candidate.value === value);
    if (!frequency) {
      throw new UnsupportedCommandError(`Unknown mop washing frequency "${value}"`);
    }
    const limits = washLimits(mopping, toNumber(props.get(PROP.WETNESS_LEVEL)));
    let wash = 0;
    if (frequency.value === 'by-area') {
      wash = within(washValues.area || limits.area.default, limits.area);
    } else if (frequency.value === 'by-time') {
      wash = within(washValues.time || limits.time.default, limits.time);
    }
    return {
      kind: 'writes',
      writes: [settingWrite(WASH_FREQUENCY_SETTING, frequency.code), washValueWrite(props, wash)],
    };
  }
  if (code === FEATURE_CODES.WASH_AREA || code === FEATURE_CODES.WASH_TIME) {
    const byArea = code === FEATURE_CODES.WASH_AREA;
    if (!mopping || !(byArea ? mopping.washArea : mopping.washTime) || number === null) {
      throw new UnsupportedCommandError('The mop washing frequency of this robot cannot be set');
    }
    const limits = washLimits(mopping, toNumber(props.get(PROP.WETNESS_LEVEL)));
    const wash = within(number, byArea ? limits.area : limits.time);
    const remember = byArea ? { area: wash } : { time: wash };
    const frequency = mopping.washFrequency ? washFrequencyOf(props) : null;
    const current = byArea
      ? !mopping.washFrequency || (frequency && frequency.value === 'by-area')
      : frequency && frequency.value === 'by-time';
    // The robot holds one value, the one of its current frequency: the other
    // is kept for when that frequency is chosen.
    return { kind: 'writes', writes: current ? [washValueWrite(props, wash)] : [], remember };
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
    return roomClean([room], props, true);
  }
  if (code.startsWith(FEATURE_CODES.ROOM_PICK_PREFIX)) {
    const room = toNumber(code.slice(FEATURE_CODES.ROOM_PICK_PREFIX.length));
    if (!Number.isSafeInteger(room) || room <= 0) {
      throw new UnsupportedCommandError(`Unknown room "${code}"`);
    }
    return { kind: 'pick', room: String(room), on: number > 0 };
  }
  if (code === FEATURE_CODES.CLEAN_ROOMS) {
    if (number !== 1) {
      return null;
    }
    const chosen = rooms
      .map((room) => toNumber(room.id))
      .filter((room) => Number.isSafeInteger(room) && picks.has(String(room)));
    if (chosen.length === 0) {
      throw new UnsupportedCommandError('No room picked: switch on the rooms to clean first');
    }
    const fixedIndex = Boolean(mopping && (mopping.custom || mopping.gen5));
    return roomClean(chosen, props, fixedIndex);
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
