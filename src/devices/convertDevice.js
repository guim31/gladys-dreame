// -----------------------------------------------------------------------------
// A Dreame robot -> a Gladys discovered device.
//
// External ids (built with gladys.externalIds(), mandatory `ext:<selector>:`
// prefix):
//   device  -> ext:<selector>:vacuum:<did>
//   feature -> ext:<selector>:vacuum:<did>:<code>
// The did is the robot id of the Dreamehome cloud: stable, and enough to reach
// the robot (its IoT node and broker come with the device list).
// -----------------------------------------------------------------------------

import { POLL_FREQUENCY } from '../constants.js';
import { namedRooms } from '../dreame/map.js';
import { buildVacuumFeatures } from './vacuum.js';

export const VACUUM_SLUG = 'vacuum';

/**
 * @param {object} gladys the SDK
 * @param {string} did the robot id
 * @returns {object} `{ device, feature(code) }`
 */
export function vacuumExternalIds(gladys, did) {
  return gladys.externalIds(VACUUM_SLUG, String(did));
}

/**
 * The robot id of a device external id.
 * @param {object} gladys the SDK
 * @param {string} externalId `ext:<selector>:vacuum:<did>` (or a feature id)
 * @returns {string|null} the did, or null when the id is not one of ours
 */
export function didOf(gladys, externalId) {
  const prefix = gladys.externalId(`${VACUUM_SLUG}:`);
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const did = externalId.slice(prefix.length).split(':')[0];
  return did || null;
}

/**
 * @param {object} gladys the SDK
 * @param {object} robot the robot, as discovery learned it
 * @param {string} language `fr` or `en`
 * @returns {object} the Gladys discovered device
 */
export function convertDevice(gladys, robot, language) {
  const ids = vacuumExternalIds(gladys, robot.did);
  return {
    name: robot.name,
    external_id: ids.device,
    model: robot.displayModel,
    // The robot pushes its changes; the poll is the safety net.
    should_poll: true,
    poll_frequency: POLL_FREQUENCY,
    features: buildVacuumFeatures(
      ids,
      {
        capabilities: robot.capabilities,
        rooms: namedRooms(robot.rooms, language),
        shortcuts: robot.shortcuts,
        hasRoute: Boolean(robot.hasRoute),
        settingKeys: robot.settingKeys || new Set(),
        mopping: robot.mopping,
        caps: robot.caps || null,
      },
      language,
    ),
  };
}
