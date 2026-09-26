// -----------------------------------------------------------------------------
// The rooms of a robot, read from its map.
//
// Dreame keeps no room list anywhere else: the rooms (segments) live in the
// JSON trailer of the map frame the robot uploads. Getting there:
//   1. ask the robot for a full map frame (action 6.1); it answers with either
//      the frame itself or the name of the file it uploaded, possibly followed
//      by `,<key>` when the file is encrypted;
//   2. download the file through a signed URL;
//   3. decode: URL-safe base64 -> (AES-256-CBC, key = the first 32 hex
//      characters of sha256(<key>), IV = a per-model constant) -> zlib;
//   4. a 27-byte header (the grid width and height at bytes 19 and 21), the
//      grid itself (width x height bytes), then the JSON trailer, whose
//      `seg_inf` object describes every room: `{ "<id>": { type, index, name } }`,
//      `name` being base64 and only present for a room the user named.
// Same format as the one the Home Assistant integration decodes.
// -----------------------------------------------------------------------------

import { createDecipheriv, createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

import { texts } from '../i18n.js';

export const MAP_HEADER_SIZE = 27;

export class MapDecodeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MapDecodeError';
  }
}

/**
 * Split a map object name from its encryption key (`<name>,<key>`).
 * @param {string} objectName the object name the robot gave
 * @returns {{ name: string, key: string|null }} the parts
 */
export function splitObjectName(objectName) {
  const [name, key] = String(objectName || '').split(',');
  return { name, key: key || null };
}

/**
 * Decode a map frame.
 * @param {string} raw the frame, as downloaded or as sent by the robot
 * @param {object} [options] decryption material
 * @param {string} [options.key] the key that followed the object name
 * @param {string} [options.iv] the IV of the model (needed when encrypted)
 * @returns {{ mapId: number, frameId: number, frameType: number, width: number,
 *   height: number, data: object }} the frame header and its JSON trailer
 */
export function decodeMapFrame(raw, { key = null, iv = null } = {}) {
  let text = String(raw || '')
    .trim()
    .replace(/_/g, '/')
    .replace(/-/g, '+');
  let aesKey = key;
  if (text.includes(',')) {
    const [frame, inlineKey] = text.split(',');
    text = frame;
    aesKey = aesKey || inlineKey || null;
  }
  if (text.length < 3) {
    throw new MapDecodeError('empty map frame');
  }
  let buffer = Buffer.from(text, 'base64');
  if (aesKey) {
    if (!iv) {
      throw new MapDecodeError('encrypted map and no IV for this model');
    }
    try {
      const keyBytes = Buffer.from(
        createHash('sha256').update(aesKey, 'utf8').digest('hex').slice(0, 32),
        'utf8',
      );
      const decipher = createDecipheriv('aes-256-cbc', keyBytes, Buffer.from(iv, 'utf8'));
      // The padding is left in place: zlib stops at the end of its stream.
      decipher.setAutoPadding(false);
      buffer = Buffer.concat([decipher.update(buffer), decipher.final()]);
    } catch (err) {
      throw new MapDecodeError(`map decryption failed: ${err.message}`);
    }
  }
  let frame;
  try {
    frame = inflateSync(buffer);
  } catch (err) {
    throw new MapDecodeError(
      `map decompression failed (${aesKey ? 'wrong IV for this model?' : 'unexpected format'}): ${err.message}`,
    );
  }
  if (frame.length < MAP_HEADER_SIZE) {
    throw new MapDecodeError(`map frame too short (${frame.length} bytes)`);
  }
  const width = frame.readInt16LE(19);
  const height = frame.readInt16LE(21);
  const gridEnd = MAP_HEADER_SIZE + Math.max(0, width) * Math.max(0, height);
  let data = {};
  if (frame.length > gridEnd) {
    try {
      data = JSON.parse(frame.subarray(gridEnd).toString('utf8'));
    } catch (err) {
      throw new MapDecodeError(`map trailer is not JSON: ${err.message}`);
    }
  }
  return {
    mapId: frame.readInt16LE(0),
    frameId: frame.readInt16LE(2),
    frameType: frame.readInt8(4),
    width,
    height,
    data,
  };
}

/**
 * The rooms of a decoded map frame, as the robot describes them.
 * @param {object} frame the result of decodeMapFrame()
 * @returns {Array<{ id: number, type: number, index: number, customName: string|null }>}
 *   the rooms, by id
 */
export function roomsOf(frame) {
  const segments = (frame && frame.data && frame.data.seg_inf) || {};
  const rooms = [];
  for (const [key, info] of Object.entries(segments)) {
    const id = Number(key);
    if (!Number.isSafeInteger(id) || id <= 0) {
      continue;
    }
    let customName = null;
    if (info && typeof info.name === 'string' && info.name) {
      customName = Buffer.from(info.name, 'base64').toString('utf8').trim() || null;
    }
    rooms.push({
      id,
      type: Number.isInteger(info && info.type) ? info.type : 0,
      index: Number.isInteger(info && info.index) ? info.index : 0,
      customName,
    });
  }
  return rooms.sort((a, b) => a.id - b.id);
}

/**
 * The name the Dreamehome app shows for a room: its type when it has one
 * (numbered from the second room of that type), else the name the user gave,
 * else a generic "Room <id>".
 * @param {object} room a room from roomsOf()
 * @param {string} language `fr` or `en`
 * @returns {string} the room name
 */
export function roomName(room, language) {
  const t = texts(language);
  if (room.type > 0 && t.roomTypes[room.type]) {
    return room.index > 0 ? `${t.roomTypes[room.type]} ${room.index + 1}` : t.roomTypes[room.type];
  }
  if (room.customName) {
    return room.customName;
  }
  return `${t.roomTypes[0]} ${room.id}`;
}

/**
 * The rooms with their names, sorted by name for the room selector.
 * @param {Array} rooms rooms from roomsOf()
 * @param {string} language `fr` or `en`
 * @returns {Array<{ id: number, name: string }>} the named rooms
 */
export function namedRooms(rooms, language) {
  const collator = new Intl.Collator(language === 'en' ? 'en' : 'fr', { numeric: true });
  return rooms
    .map((room) => ({ id: room.id, name: roomName(room, language) }))
    .sort((a, b) => collator.compare(a.name, b.name) || a.id - b.id);
}

/**
 * Read the answer of the map request (action 6.1): the robot sends either the
 * frame itself or the file it uploaded, under several property ids depending
 * on its generation.
 * @param {object} result the action result (`out: [{ piid, value }]`)
 * @returns {{ objectName: string|null, frame: string|null }} what it pointed to
 */
export function mapLocationOf(result) {
  let objectName = null;
  let frame = null;
  for (const item of (result && result.out) || []) {
    const value = item && typeof item.value === 'string' ? item.value : '';
    if (!value) {
      continue;
    }
    if (item.piid === 3) {
      objectName = value;
    } else if (item.piid === 1) {
      frame = value;
    } else if (item.piid === 13 && !objectName && !frame) {
      // Older firmwares: "0,<frame>" or "1,<object name>[,<key>]".
      const [kind, ...rest] = value.split(',');
      if (kind === '0') {
        frame = rest.join(',');
      } else {
        objectName = rest.join(',');
      }
    }
  }
  return { objectName, frame };
}
