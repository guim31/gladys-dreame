// -----------------------------------------------------------------------------
// The map of a robot as an image, for the dashboard widget: rooms in colors,
// walls, the charger and the robot, as a PNG no larger than the widget frame.
//
// Each grid cell is one byte whose meaning depends on the generation and on the
// state of the map (Home Assistant integration Tasshack/dreame-vacuum, MIT):
//   - v3 maps (the "map v2" models): room id in the 5 low bits (31 = floor
//     outside any room), wall flags in bits 5-6;
//   - "frame maps" (`fsm: 1` in the trailer): room id in the 6 high bits
//     (63 wall, 62 and 61 floor), else the 2 low bits (2 wall, 1 and 3 floor);
//   - a map being built (`ris` 0 or 1): 2 is a wall, 1 and 3 floor;
//   - a map whose rooms live in its saved copy (`ris` 2): wall or floor only;
//   - otherwise: room id in the 6 low bits, the high bit for a wall.
// The grid's rows go up (the world's y axis): the image flips them. Positions
// are in millimetres, the cell being `gridSize` millimetres wide.
//
// No image library: the palette PNG is written by hand (zlib does the work).
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const OUTSIDE = 0;
const WALL = 250;
const FLOOR = 251;
const MAX_ROOM = 63;

// The widget frame is 16:9 and at most ~800 px wide.
export const MAX_IMAGE = { WIDTH: 800, HEIGHT: 450 };
const MAX_SCALE = 8;
const MARGIN_CELLS = 3;
// Room colors, soft like the app's; neighbouring rooms never share one.
const ROOM_COLORS = [
  [126, 178, 240],
  [246, 196, 108],
  [143, 209, 158],
  [242, 160, 123],
  [185, 156, 240],
  [111, 211, 216],
];
const PALETTE = [
  [0, 0, 0], // 0 transparent (outside the home)
  [95, 108, 125], // 1 wall
  [205, 213, 224], // 2 floor outside any room
  ...ROOM_COLORS, // 3..8 rooms
  [255, 255, 255], // 9 robot
  [45, 55, 72], // 10 robot outline
  [47, 179, 68], // 11 charger
  [255, 255, 255], // 12 charger outline
];
const INDEX = {
  TRANSPARENT: 0,
  WALL: 1,
  FLOOR: 2,
  ROOM: 3,
  ROBOT: 9,
  ROBOT_EDGE: 10,
  CHARGER: 11,
  CHARGER_EDGE: 12,
};

/**
 * What a grid cell is: OUTSIDE, WALL, FLOOR, or a room id (1-63).
 * @param {number} pixel the cell byte
 * @param {string} format see pixelFormatOf()
 * @returns {number} the cell class
 */
export function cellOf(pixel, format) {
  if (pixel === 0) {
    return OUTSIDE;
  }
  if (format === 'v3') {
    const room = pixel & 0x1f;
    const wall = (pixel >> 5) & 0x03;
    if (room === 0) {
      return OUTSIDE;
    }
    if (room === 31) {
      return wall > 0 ? WALL : FLOOR;
    }
    // 3 marks a room's own edge, drawn with the room.
    return wall === 1 || wall === 2 ? WALL : room;
  }
  if (format === 'frame') {
    const room = pixel >> 2;
    if (room > 0 && room < 64) {
      if (room === 63) {
        return WALL;
      }
      return room >= 61 ? FLOOR : room;
    }
    return lowBits(pixel & 0x03);
  }
  if (format === 'building') {
    return lowBits(pixel & 0x3f);
  }
  if (format === 'plain') {
    return (pixel & 0x3f) === 2 ? WALL : FLOOR;
  }
  const room = pixel & 0x3f;
  if (pixel >> 7) {
    return WALL;
  }
  return room > 0 ? room : OUTSIDE;
}

function lowBits(value) {
  if (value === 2) {
    return WALL;
  }
  return value === 1 || value === 3 ? FLOOR : OUTSIDE;
}

/**
 * How the cells of a frame are encoded.
 * @param {object} frame a decoded frame (decodeMapFrame())
 * @param {boolean} mapV2 whether the model has the v3 maps
 * @returns {string} `v3`, `frame`, `building`, `plain` or `rooms`
 */
export function pixelFormatOf(frame, mapV2) {
  if (mapV2) {
    return 'v3';
  }
  if (frame.data.fsm === 1) {
    return 'frame';
  }
  if (frame.data.ris === 0 || frame.data.ris === 1) {
    return 'building';
  }
  return frame.data.ris === 2 ? 'plain' : 'rooms';
}

/**
 * Draw the map of a robot.
 * @param {object} map `{ frame, saved }` from fetchMap()
 * @param {object} [options] how to read it
 * @param {boolean} [options.mapV2] whether the model has the v3 maps
 * @returns {{ png: Buffer, key: string, width: number, height: number }|null}
 *   the image and its key (it changes with the bytes), null for an empty map
 */
export function renderMap({ frame, saved = null }, { mapV2 = false } = {}) {
  // The rooms are in the saved copy when the current frame carries none.
  const base = saved && !frame.data.seg_inf ? saved : frame;
  const { width, height, grid } = base;
  if (!(width > 0 && height > 0) || !grid || grid.length < width * height) {
    return null;
  }
  const format = pixelFormatOf(base, mapV2);
  // Cells in image order: row 0 is the top of the image (the world's max y).
  const cells = new Uint8Array(width * height);
  let minCol = width;
  let maxCol = -1;
  let minRow = height;
  let maxRow = -1;
  for (let y = 0; y < height; y += 1) {
    const row = height - 1 - y;
    for (let x = 0; x < width; x += 1) {
      const cell = cellOf(grid[y * width + x], format);
      cells[row * width + x] = cell;
      if (cell !== OUTSIDE) {
        minCol = Math.min(minCol, x);
        maxCol = Math.max(maxCol, x);
        minRow = Math.min(minRow, row);
        maxRow = Math.max(maxRow, row);
      }
    }
  }
  if (maxCol < 0) {
    return null;
  }
  minCol = Math.max(0, minCol - MARGIN_CELLS);
  minRow = Math.max(0, minRow - MARGIN_CELLS);
  maxCol = Math.min(width - 1, maxCol + MARGIN_CELLS);
  maxRow = Math.min(height - 1, maxRow + MARGIN_CELLS);
  const cropWidth = maxCol - minCol + 1;
  const cropHeight = maxRow - minRow + 1;
  const scale = Math.max(
    1,
    Math.min(
      MAX_SCALE,
      Math.floor(Math.min(MAX_IMAGE.WIDTH / cropWidth, MAX_IMAGE.HEIGHT / cropHeight)),
    ),
  );
  const imageWidth = cropWidth * scale;
  const imageHeight = cropHeight * scale;
  const colors = roomColors(cells, width, height);
  const pixels = new Uint8Array(imageWidth * imageHeight);
  for (let row = 0; row < cropHeight; row += 1) {
    for (let col = 0; col < cropWidth; col += 1) {
      const cell = cells[(minRow + row) * width + minCol + col];
      let index = INDEX.TRANSPARENT;
      if (cell === WALL) {
        index = INDEX.WALL;
      } else if (cell === FLOOR) {
        index = INDEX.FLOOR;
      } else if (cell !== OUTSIDE) {
        index = INDEX.ROOM + colors.get(cell);
      }
      if (index === INDEX.TRANSPARENT) {
        continue;
      }
      for (let dy = 0; dy < scale; dy += 1) {
        pixels.fill(
          index,
          (row * scale + dy) * imageWidth + col * scale,
          (row * scale + dy) * imageWidth + (col + 1) * scale,
        );
      }
    }
  }
  const toImage = (position) => ({
    x: ((position.x - base.left) / base.gridSize - minCol + 0.5) * scale,
    y: (height - 1 - (position.y - base.top) / base.gridSize - minRow + 0.5) * scale,
  });
  // A robot is about 35 cm wide: seven 5 cm cells; never smaller than a dot
  // one can spot on a large home.
  const radius = Math.max(7, Math.round((175 / (base.gridSize || 50)) * scale));
  const canvas = { pixels, width: imageWidth, height: imageHeight };
  const charger = frame.charger || base.charger;
  if (charger) {
    const at = toImage(charger);
    disc(canvas, at, Math.max(5, Math.round(radius * 0.7)), INDEX.CHARGER, INDEX.CHARGER_EDGE);
  }
  if (frame.robot) {
    const at = toImage(frame.robot);
    disc(canvas, at, radius, INDEX.ROBOT, INDEX.ROBOT_EDGE);
    disc(canvas, at, Math.max(1, Math.round(radius / 3)), INDEX.ROBOT_EDGE, INDEX.ROBOT_EDGE);
  }
  const png = encodePng(canvas, PALETTE);
  const key = `map-${createHash('sha1').update(png).digest('hex').slice(0, 16)}`;
  return { png, key, width: imageWidth, height: imageHeight };
}

/**
 * One color per room, neighbouring rooms (a wall apart at most) never sharing
 * one, as the app does.
 * @param {Uint8Array} cells the cell classes, in image order
 * @param {number} width the grid width
 * @param {number} height the grid height
 * @returns {Map<number, number>} room id -> index in ROOM_COLORS
 */
export function roomColors(cells, width, height) {
  const neighbours = new Map();
  const link = (a, b) => {
    if (!neighbours.has(a)) {
      neighbours.set(a, new Set());
    }
    if (!neighbours.has(b)) {
      neighbours.set(b, new Set());
    }
    neighbours.get(a).add(b);
    neighbours.get(b).add(a);
  };
  const isRoom = (cell) => cell > 0 && cell <= MAX_ROOM;
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const cell = cells[row * width + col];
      if (!isRoom(cell)) {
        continue;
      }
      if (!neighbours.has(cell)) {
        neighbours.set(cell, new Set());
      }
      for (let d = 1; d <= 3; d += 1) {
        const right = col + d < width ? cells[row * width + col + d] : OUTSIDE;
        const below = row + d < height ? cells[(row + d) * width + col] : OUTSIDE;
        for (const other of [right, below]) {
          if (isRoom(other) && other !== cell) {
            link(cell, other);
          }
        }
      }
    }
  }
  const colors = new Map();
  for (const room of [...neighbours.keys()].sort((a, b) => a - b)) {
    const taken = new Set([...neighbours.get(room)].map((other) => colors.get(other)));
    let color = 0;
    while (taken.has(color) && color < ROOM_COLORS.length - 1) {
      color += 1;
    }
    colors.set(room, taken.has(color) ? room % ROOM_COLORS.length : color);
  }
  return colors;
}

function disc({ pixels, width, height }, center, radius, fill, edge) {
  const outer = radius * radius;
  const inner = Math.max(0, radius - 1.5) ** 2;
  for (let y = Math.floor(center.y - radius); y <= Math.ceil(center.y + radius); y += 1) {
    for (let x = Math.floor(center.x - radius); x <= Math.ceil(center.x + radius); x += 1) {
      if (x < 0 || y < 0 || x >= width || y >= height) {
        continue;
      }
      const distance = (x + 0.5 - center.x) ** 2 + (y + 0.5 - center.y) ** 2;
      if (distance <= outer) {
        pixels[y * width + x] = distance >= inner ? edge : fill;
      }
    }
  }
}

// --- PNG ---------------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * An 8-bit palette PNG, the first palette entry transparent.
 * @param {object} canvas `{ pixels, width, height }`, one palette index per pixel
 * @param {Array<Array<number>>} palette `[r, g, b]` entries
 * @returns {Buffer} the PNG file
 */
export function encodePng({ pixels, width, height }, palette) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(3, 9); // palette
  const rows = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    // Filter byte 0 (none), then the row.
    rows.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('PLTE', Buffer.from(palette.flat())),
    chunk('tRNS', Buffer.from([0])),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
