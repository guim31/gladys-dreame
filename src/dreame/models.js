// -----------------------------------------------------------------------------
// What the Dreame cloud does not say about a model, looked up in the table
// extracted from the Home Assistant integration (src/data/models.json, see
// tools/extract-models.py):
//   - the AES IV its map files are encrypted with;
//   - from which firmware it numbers its states the new way.
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
