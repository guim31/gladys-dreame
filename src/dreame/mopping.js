// -----------------------------------------------------------------------------
// The mop settings of the app: cleaning mode, mop wetness and mop washing
// frequency. Their storage changed with the generations, and only the model
// table (dreame/models.js) says which one a robot uses:
//
//   - robots with a self-washing base (4.25) group three settings in 4.23:
//       byte 0  the cleaning mode (two bits when the mops lift, one otherwise)
//       byte 1  the washing frequency value: square metres (by area), minutes
//               (by time), 0 (after each room)
//       byte 2  the water level (0 when the robot has a wetness level instead)
//     so a write changes one byte and keeps the others;
//   - robots whose mops lift number their modes their own way: 2 is sweeping
//     and 0 sweeping + mopping, the reverse of the other robots.
//
// The cleaning mode is only offered for the robots whose mops lift: the others
// cannot sweep with their mops on, and whether they are on is not something
// the integration reads. Mirrors the Home Assistant integration
// Tasshack/dreame-vacuum (MIT).
// -----------------------------------------------------------------------------

import { CLEANING_MODES, PROP, WASH_FREQUENCIES, WASH_FREQUENCY_SETTING } from '../constants.js';
import { parseSettings } from './settings.js';

const SWEEPING = 0;
const MOPPING = 1;
const SWEEPING_AND_MOPPING = 2;
const MOPPING_AFTER_SWEEPING = 3;

// Cleaning mode <-> the value a robot with lifting mops stores.
const LIFTING_STORED = {
  [SWEEPING]: 2,
  [MOPPING]: 1,
  [SWEEPING_AND_MOPPING]: 0,
  [MOPPING_AFTER_SWEEPING]: 3,
};
const LIFTING_READ = Object.fromEntries(
  Object.entries(LIFTING_STORED).map(([mode, stored]) => [stored, Number(mode)]),
);

// Routes a sweeping robot cannot take (the intensive and deep ones only mean
// something to the mops), unless its firmware has the second route list.
const MOPPING_ONLY_ROUTES = new Set([2, 3]);

/**
 * What a robot can do with its mops, from the model table and what it answered.
 * @param {object|null} caps modelCapabilities() of the robot
 * @param {Set<string>} answered the properties the robot answered
 * @param {Set<string>} settingKeys the settings (4.50) it has
 * @returns {object} the mop settings the robot offers
 */
export function moppingOf(caps, answered, settingKeys) {
  const flag = (name) => Boolean(caps && caps.flags.has(name));
  const grouped = answered.has(PROP.SELF_WASH_BASE_STATUS) && answered.has(PROP.CLEANING_MODE);
  const lifting =
    flag('mopPadLifting') ||
    flag('mopPadLiftingPlus') ||
    (flag('mopPadUnmounting') && answered.has(PROP.SELF_WASH_BASE_STATUS));
  const frequency =
    grouped && flag('selfCleanFrequency') && settingKeys.has(WASH_FREQUENCY_SETTING);
  return {
    grouped,
    cleaningMode: Boolean(caps) && lifting && answered.has(PROP.CLEANING_MODE),
    afterSweeping: flag('moppingAfterSweeping'),
    custom: answered.has(PROP.CUSTOMIZED_CLEANING),
    wetness:
      flag('wetnessLevel') && !flag('onboardWetnessLevel') && answered.has(PROP.WETNESS_LEVEL),
    washArea: Boolean(caps) && grouped,
    washTime: frequency,
    washFrequency: frequency,
    routeV2: flag('cleaningRouteV2'),
    gen5: flag('gen5'),
    values: (caps && caps.values) || {},
    flags: caps ? caps.flags : new Set(),
  };
}

/**
 * @param {*} value the raw 4.23 value
 * @returns {{ mode: number, wash: number, water: number }|null} its bytes
 */
export function splitGroup(value) {
  const number = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isInteger(number)) {
    return null;
  }
  return { mode: number & 0xff, wash: (number >> 8) & 0xff, water: number >> 16 };
}

function joinGroup({ mode, wash, water }) {
  return (water << 16) | (wash << 8) | mode;
}

/**
 * The cleaning mode the robot is set to.
 * @param {Map<string, *>} props the robot properties
 * @param {object} mopping moppingOf() of the robot
 * @returns {string|null} a CLEANING_MODES value, or null when unknown
 */
export function cleaningModeOf(props, mopping) {
  if (!mopping.cleaningMode) {
    return null;
  }
  if (mopping.custom && Number(props.get(PROP.CUSTOMIZED_CLEANING)) === 1) {
    return 'custom';
  }
  const raw = props.get(PROP.CLEANING_MODE);
  const group = mopping.grouped ? splitGroup(raw) : null;
  if (mopping.grouped && !group) {
    return null;
  }
  const stored = group ? group.mode & 0x03 : Number(raw);
  const code = LIFTING_READ[stored];
  const mode = CLEANING_MODES.find((candidate) => candidate.code === code);
  return mode ? mode.value : null;
}

/**
 * The writes that set a cleaning mode.
 * @param {string} value a CLEANING_MODES value
 * @param {Map<string, *>} props the robot properties
 * @param {object} mopping moppingOf() of the robot
 * @returns {Array<{ key: string, value: * }>} the properties to write, in order
 * @throws {Error} with a message for the user when it cannot be set
 */
export function cleaningModeWrites(value, props, mopping) {
  const mode = CLEANING_MODES.find((candidate) => candidate.value === value);
  if (!mode) {
    throw new Error(`Unknown cleaning mode "${value}"`);
  }
  if (mode.value === 'custom') {
    if (!mopping.custom) {
      throw new Error('This robot has no room-by-room settings');
    }
    return [{ key: PROP.CUSTOMIZED_CLEANING, value: 1 }];
  }
  if (mode.code === MOPPING_AFTER_SWEEPING && !mopping.afterSweeping) {
    throw new Error('This robot cannot mop after sweeping');
  }
  const writes = [];
  if (mopping.custom && Number(props.get(PROP.CUSTOMIZED_CLEANING)) === 1) {
    // As in the app: picking a mode leaves the room-by-room settings.
    writes.push({ key: PROP.CUSTOMIZED_CLEANING, value: 0 });
  }
  const stored = LIFTING_STORED[mode.code];
  if (mopping.grouped) {
    const group = splitGroup(props.get(PROP.CLEANING_MODE));
    if (!group) {
      throw new Error('The cleaning mode of the robot is not known yet');
    }
    // Only the mode bits change: the bytes after are the washing frequency
    // and the water level, set elsewhere.
    writes.push({ key: PROP.CLEANING_MODE, value: joinGroup({ ...group, mode: stored }) });
  } else {
    writes.push({ key: PROP.CLEANING_MODE, value: stored });
  }
  return writes;
}

/**
 * Whether the robot sweeps in this mode (the mopping-only routes then do not
 * apply).
 * @param {string|null} value a CLEANING_MODES value
 * @returns {boolean} true for the sweeping modes
 */
export function sweepsOnly(value) {
  return value === 'sweeping' || value === 'sweeping-and-mopping';
}

/**
 * Whether a cleaning route can be chosen in the current mode.
 * @param {number} route a ROUTES code
 * @param {string|null} mode the current CLEANING_MODES value
 * @param {object} mopping moppingOf() of the robot
 * @returns {boolean} false for a mopping-only route while sweeping
 */
export function routeAllowed(route, mode, mopping) {
  return mopping.routeV2 || !sweepsOnly(mode) || !MOPPING_ONLY_ROUTES.has(route);
}

/**
 * The mop washing frequency the robot is set to.
 * @param {Map<string, *>} props the robot properties
 * @returns {object|null} the WASH_FREQUENCIES entry, or null
 */
export function washFrequencyOf(props) {
  const settings = parseSettings(props.get(PROP.AUTO_SWITCH));
  const code = settings ? Number(settings.get(WASH_FREQUENCY_SETTING)) : null;
  return WASH_FREQUENCIES.find((frequency) => frequency.code === code) || null;
}

/**
 * The bounds of the washing frequency values. They depend on the model and on
 * the wetness: the wetter the mops, the sooner they are washed.
 * @param {object} mopping moppingOf() of the robot
 * @param {number|null} wetness the current wetness (null: the widest bounds)
 * @returns {{ area: object, time: object }} `{ min, max, default }` each,
 *   square metres and minutes
 */
export function washLimits(mopping, wetness) {
  const v = mopping.values;
  const flag = (name) => mopping.flags.has(name);
  const fixedArea = v.selfCleanAreaFixedDefault || 0;
  const fixedTime = v.selfCleanTimeFixedDefault || 0;
  const time = {
    min: v.selfCleanTimeMin ?? 10,
    max: v.selfCleanTimeMax ?? 50,
    default: fixedTime || (v.selfCleanTimeDefault ?? 25),
  };
  const usualArea = (v.selfCleanAreaMin ?? 10) === 10;
  const area = usualArea
    ? { min: flag('smallWaterTank') ? 8 : 10, max: flag('cleaningRoute') ? 35 : 30, default: 20 }
    : {
        min: v.selfCleanAreaMin,
        max: v.selfCleanAreaMax ?? 35,
        default: v.selfCleanAreaDefault ?? 20,
      };
  if (flag('wetnessLevel') && wetness !== null && wetness !== undefined) {
    if (flag('smallWaterTank')) {
      Object.assign(area, wetness > 22 ? { max: 15, default: 12 } : { max: 25, default: 15 });
      Object.assign(
        time,
        wetness > 22 ? { min: 10, max: 20, default: 15 } : { min: 10, max: 40, default: 20 },
      );
    } else if (wetness > 26) {
      Object.assign(time, {
        min: 10,
        max: fixedTime > 20 ? fixedTime : 20,
        default: fixedTime || 20,
      });
      if (usualArea || flag('selfCleanFrequency')) {
        area.max = fixedArea > 20 ? fixedArea : 20;
        area.default = Math.min(fixedArea || area.default, area.max);
      }
    }
  }
  return { area, time };
}

/**
 * The writes that set the washing frequency value (byte 1 of 4.23).
 * @param {Map<string, *>} props the robot properties
 * @param {number} wash the value, already within bounds
 * @returns {{ key: string, value: number }} the write
 */
export function washValueWrite(props, wash) {
  const group = splitGroup(props.get(PROP.CLEANING_MODE));
  if (!group) {
    throw new Error('The mop settings of the robot are not known yet');
  }
  return { key: PROP.CLEANING_MODE, value: joinGroup({ ...group, wash }) };
}

/**
 * The washing frequency value the robot is set to.
 * @param {Map<string, *>} props the robot properties
 * @returns {number|null} square metres or minutes, 0 after each room
 */
export function washValueOf(props) {
  const group = splitGroup(props.get(PROP.CLEANING_MODE));
  return group ? group.wash : null;
}
