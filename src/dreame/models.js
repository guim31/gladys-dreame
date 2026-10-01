// -----------------------------------------------------------------------------
// What the Dreame cloud does not say about a model, looked up in the table
// extracted from the Home Assistant integration (src/data/models.json, see
// tools/extract-models.py):
//   - the AES IV its map files are encrypted with;
//   - from which firmware it numbers its states the new way;
//   - how it stores its mop settings, which wear parts it has (see
//     modelCapabilities()).
// Models are keyed by the last segment of the model id
// (`dreame.vacuum.r2228o` -> `r2228o`).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const TABLE = JSON.parse(readFileSync(new URL('../data/models.json', import.meta.url), 'utf8'));

const IV_BY_MODEL = new Map();
for (const [iv, models] of Object.entries(TABLE.mapIvs)) {
  for (const model of models) {
    IV_BY_MODEL.set(model, iv);
  }
}

// The IV most models share: the best guess for a model newer than the table.
const MOST_COMMON_IV = Object.entries(TABLE.mapIvs).sort((a, b) => b[1].length - a[1].length)[0][0];

const NEW_STATE_FIRMWARE = new Map();
for (const [firmware, models] of Object.entries(TABLE.newStateFromFirmware)) {
  for (const model of models) {
    NEW_STATE_FIRMWARE.set(model, Number(firmware));
  }
}

const KNOWN_MODELS = new Set(TABLE.known);

// flag -> model -> the firmware build it holds from.
const FLAGS = new Map();
for (const [flag, builds] of Object.entries(TABLE.capabilities)) {
  const byModel = new Map();
  for (const [build, models] of Object.entries(builds)) {
    for (const model of models) {
      byModel.set(model, Number(build));
    }
  }
  FLAGS.set(flag, byModel);
}

// value name -> model -> value.
const VALUES = new Map();
for (const [name, byValue] of Object.entries(TABLE.capabilityValues)) {
  const byModel = new Map();
  for (const [value, models] of Object.entries(byValue)) {
    for (const model of models) {
      byModel.set(model, Number(value));
    }
  }
  VALUES.set(name, byModel);
}

/**
 * @param {string} model a model id (`dreame.vacuum.r2228o`)
 * @returns {string} its last segment (`r2228o`)
 */
export function modelKey(model) {
  return String(model || '')
    .split('.')
    .pop();
}

/**
 * @param {string} model a model id
 * @returns {boolean} whether the model table knows it
 */
export function isKnownModel(model) {
  return KNOWN_MODELS.has(modelKey(model));
}

/**
 * The IV the maps of a model are encrypted with.
 * @param {string} model a model id
 * @returns {{ iv: string, guessed: boolean }} the IV, and whether it is a
 *   guess (model unknown to the table)
 */
export function mapIvFor(model) {
  const iv = IV_BY_MODEL.get(modelKey(model));
  return iv ? { iv, guessed: false } : { iv: MOST_COMMON_IV, guessed: true };
}

/**
 * The build number of a firmware version (`4.3.9_1114` -> 1114).
 * @param {string} firmware the firmware version
 * @returns {number|null} the build, or null when absent
 */
export function firmwareBuild(firmware) {
  const parts = String(firmware || '').split('_');
  if (parts.length !== 2) {
    return null;
  }
  const build = Number(parts[1]);
  return Number.isInteger(build) ? build : null;
}

/**
 * Whether a robot numbers its states the new way (values above 18 were
 * renumbered). Mirrors the Home Assistant integration: a known model decides
 * from its firmware build (1 when unknown); a model newer than the table is
 * assumed recent, hence new.
 * @param {string} model a model id
 * @param {string} [firmware] its firmware version
 * @returns {boolean} true for the new numbering
 */
export function usesNewStateNumbering(model, firmware) {
  const key = modelKey(model);
  if (!KNOWN_MODELS.has(key)) {
    return true;
  }
  const minimum = NEW_STATE_FIRMWARE.get(key);
  if (minimum === undefined) {
    return false;
  }
  return (firmwareBuild(firmware) || 1) >= minimum;
}

/**
 * What the table says of a model's mops and settings (see
 * tools/extract-models.py for the list): the flags its firmware has, and the
 * bounds of its mop washing frequency when they differ from the usual ones.
 * @param {string} model a model id
 * @param {string} [firmware] its firmware version
 * @returns {{ flags: Set<string>, values: object }|null} null for a model
 *   unknown to the table: nothing can be assumed about it
 */
export function modelCapabilities(model, firmware) {
  const key = modelKey(model);
  if (!KNOWN_MODELS.has(key)) {
    return null;
  }
  const build = firmwareBuild(firmware) || 1;
  const flags = new Set();
  for (const [flag, byModel] of FLAGS) {
    const minimum = byModel.get(key);
    if (minimum !== undefined && build >= minimum) {
      flags.add(flag);
    }
  }
  const values = {};
  for (const [name, byModel] of VALUES) {
    if (byModel.has(key)) {
      values[name] = byModel.get(key);
    }
  }
  return { flags, values };
}

/**
 * Whether a robot has a wear part (see CONSUMABLES): a model unknown to the
 * table keeps every part it answers for.
 * @param {{ flags: Set<string> }|null} caps modelCapabilities() of the robot
 * @param {{ needs?: string, unless?: string }} consumable the part
 * @returns {boolean} true when the part is the robot's
 */
export function tracksConsumable(caps, consumable) {
  if (!caps) {
    return true;
  }
  if (consumable.needs && !caps.flags.has(consumable.needs)) {
    return false;
  }
  return !(consumable.unless && caps.flags.has(consumable.unless));
}
