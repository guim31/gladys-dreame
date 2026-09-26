// -----------------------------------------------------------------------------
// Fetch the rooms of a robot: ask for a full map frame, find where the robot
// put it, download and decode it (see map.js for the format).
//
// Where the frame lands varies with the firmware, so three places are tried in
// turn, as the Home Assistant integration does:
//   1. the answer of the map request itself (`out`);
//   2. the object name (6.3) pushed right after on the real-time channel;
//   3. the object name the cloud derives for the robot's current map,
//      `<model>/<masterUid>/<did>/0`.
// Every step is written to `trace`, which the diagnostic action shows as is.
// -----------------------------------------------------------------------------

import { ACTION, MAP_PIID } from '../constants.js';
import { MapDecodeError, decodeMapFrame, mapLocationOf, roomsOf, splitObjectName } from './map.js';
import { mapIvFor } from './models.js';

export const MAP_REQUEST = { req_type: 1, frame_type: 'I', force_type: 1 };
// Frame type of a full map ('I'); the partial frames ('P') pushed while the
// robot cleans carry no room list.
export const FULL_FRAME = 73;
export const MAP_PUSH_WAIT_MS = Number(process.env.DREAME_MAP_PUSH_WAIT_MS) || 10 * 1000;

/**
 * @param {object} cloud the DreameCloud
 * @param {object} robot the robot (`did`, `model`, `masterUid`, `bindDomain`)
 * @param {object} [options] how to wait and what to report
 * @param {Function} [options.waitForPush] `(ms) => Promise<{ objectName }|null>`,
 *   resolved by the real-time channel when the robot pushes its map file name
 * @param {Array<string>} [options.trace] receives one line per step
 * @returns {Promise<Array>} the rooms (roomsOf())
 */
export async function fetchRooms(cloud, robot, { waitForPush = null, trace = [] } = {}) {
  let location = { objectName: null, frame: null };
  try {
    const result = await cloud.action(robot, ACTION.REQUEST_MAP, [
      { piid: MAP_PIID.FRAME_INFO, value: JSON.stringify(MAP_REQUEST) },
    ]);
    location = mapLocationOf(result);
    trace.push(`map request accepted, location in the answer: ${describe(location)}`);
  } catch (err) {
    trace.push(`map request failed: ${err.message}`);
  }
  if (!location.objectName && !location.frame && waitForPush) {
    location = (await waitForPush(MAP_PUSH_WAIT_MS)) || location;
    trace.push(`location pushed on the real-time channel: ${describe(location)}`);
  }
  if (!location.objectName && !location.frame) {
    location.objectName = `${robot.model}/${robot.masterUid}/${robot.did}/0`;
    trace.push('falling back to the current-map object of the robot');
  }

  let raw = location.frame;
  let key = null;
  if (!raw) {
    const parts = splitObjectName(location.objectName);
    key = parts.key;
    const url = await cloud.getFileUrl(robot, parts.name);
    raw = await cloud.download(url);
    trace.push(`map file downloaded (${raw.length} characters${key ? ', encrypted' : ''})`);
  }
  const { iv, guessed } = mapIvFor(robot.model);
  let frame;
  try {
    frame = decodeMapFrame(raw, { key, iv });
  } catch (err) {
    if (err instanceof MapDecodeError && guessed) {
      throw new MapDecodeError(`${err.message} (model unknown to the map table)`);
    }
    throw err;
  }
  if (frame.frameType !== FULL_FRAME) {
    throw new MapDecodeError(`not a full map frame (type ${frame.frameType})`);
  }
  const rooms = roomsOf(frame);
  trace.push(`map decoded: ${frame.width}x${frame.height}, ${rooms.length} room(s)`);
  return rooms;
}

function describe({ objectName, frame }) {
  if (objectName) {
    return objectName.includes(',') ? 'file name (encrypted)' : 'file name';
  }
  return frame ? 'inline frame' : 'none';
}
