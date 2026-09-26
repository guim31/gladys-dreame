// -----------------------------------------------------------------------------
// Build a Dreame map frame the way a robot uploads it: a 27-byte header, the
// grid, the JSON trailer, zlib, optionally AES-256-CBC, then URL-safe base64.
// The encryption mirrors the one the decoder undoes (key = the first 32 hex
// characters of sha256(<key>), IV = the model constant), with PKCS#7 padding
// as a robot adds it.
// -----------------------------------------------------------------------------

import { createCipheriv, createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

/**
 * @param {object} [options] the frame
 * @param {number} [options.frameType] 73 ('I', full) or 80 ('P', partial)
 * @param {number} [options.width] grid width
 * @param {number} [options.height] grid height
 * @param {object} [options.data] the JSON trailer
 * @param {string} [options.key] encrypt with this key
 * @param {string} [options.iv] and this IV
 * @returns {string} the frame as the robot uploads it
 */
export function buildMapFrame({
  frameType = 73,
  width = 6,
  height = 4,
  data = {},
  key = null,
  iv = null,
} = {}) {
  const header = Buffer.alloc(27);
  header.writeInt16LE(3, 0); // map id
  header.writeInt16LE(1, 2); // frame id
  header.writeInt8(frameType, 4);
  header.writeInt16LE(50, 17); // grid size
  header.writeInt16LE(width, 19);
  header.writeInt16LE(height, 21);
  const grid = Buffer.alloc(width * height, 1);
  let payload = deflateSync(Buffer.concat([header, grid, Buffer.from(JSON.stringify(data))]));
  if (key) {
    const keyBytes = Buffer.from(
      createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 32),
      'utf8',
    );
    const cipher = createCipheriv('aes-256-cbc', keyBytes, Buffer.from(iv, 'utf8'));
    payload = Buffer.concat([cipher.update(payload), cipher.final()]);
  }
  return payload.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * A `seg_inf` entry.
 * @param {object} room the room
 * @param {number} [room.type] the room type (0 = custom)
 * @param {number} [room.index] rank among the rooms of that type
 * @param {string} [room.name] a custom name
 * @returns {object} the entry
 */
export function segment({ type = 0, index = 0, name = null } = {}) {
  const entry = { type, index, nei_id: [] };
  if (name) {
    entry.name = Buffer.from(name, 'utf8').toString('base64');
  }
  return entry;
}
