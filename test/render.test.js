import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { validateWidgetImage } from '@gladysassistant/integration-sdk';

import { MAX_PATH_POINTS, decodeMapFrame, pathOf } from '../src/dreame/map.js';
import { MAX_IMAGE, cellOf, pixelFormatOf, renderMap, roomColors } from '../src/dreame/render.js';
import { buildMapFrame, roomGrid } from './helpers/mapFrame.js';

/**
 * Read back a palette PNG written by renderMap().
 * @param {Buffer} png the file
 * @returns {{ width: number, height: number, rgba: Function }} the image
 */
function readPng(png) {
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let offset = 8;
  let width;
  let height;
  let palette;
  let alpha = Buffer.alloc(0);
  const idat = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      alpha = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    offset += 12 + length;
  }
  const rows = inflateSync(Buffer.concat(idat));
  return {
    width,
    height,
    rgba(x, y) {
      const index = rows[y * (width + 1) + 1 + x];
      return [
        ...palette.subarray(index * 3, index * 3 + 3),
        index < alpha.length ? alpha[index] : 255,
      ];
    },
  };
}

// Two rooms side by side, the first one at the bottom-left of the world; the
// charger in room 1, the robot in room 2 (cells of 50 mm).
const frame = decodeMapFrame(
  buildMapFrame({
    width: 30,
    height: 20,
    grid: roomGrid(30, 20, { 1: [2, 2, 12, 8], 2: [13, 2, 27, 17] }),
    charger: { x: 350, y: 250, angle: 0 },
    robot: { x: 1000, y: 700, angle: 0 },
    data: { seg_inf: { 1: {}, 2: {} } },
  }),
);

test('each generation encodes its cells its own way', () => {
  assert.equal(cellOf(0x05, 'rooms'), 5);
  assert.equal(cellOf(0x85, 'rooms'), 250); // wall
  assert.equal(cellOf(0x03 | (0 << 5), 'v3'), 3);
  assert.equal(cellOf(0x03 | (1 << 5), 'v3'), 250);
  assert.equal(cellOf(0x03 | (3 << 5), 'v3'), 3); // a room's own edge
  assert.equal(cellOf(31, 'v3'), 251); // floor outside the rooms
  assert.equal(cellOf(7 << 2, 'frame'), 7);
  assert.equal(cellOf(63 << 2, 'frame'), 250);
  assert.equal(cellOf(2, 'frame'), 250);
  assert.equal(cellOf(1, 'building'), 251);
  assert.equal(cellOf(2, 'building'), 250);
  assert.equal(cellOf(5, 'plain'), 251);
  assert.equal(cellOf(0, 'rooms'), 0);
  assert.equal(pixelFormatOf({ data: { fsm: 1 } }, false), 'frame');
  assert.equal(pixelFormatOf({ data: { ris: 1 } }, false), 'building');
  assert.equal(pixelFormatOf({ data: { ris: 2 } }, false), 'plain');
  assert.equal(pixelFormatOf({ data: {} }, true), 'v3');
  assert.equal(pixelFormatOf({ data: {} }, false), 'rooms');
});

// The whole 30 x 20 grid stays once cropped (rooms from 2 to 27, 3 cells of
// margin), scaled 8 times: the center of cell (x, y) is at pixel
// ((x + 0.5) * 8, (19 - y + 0.5) * 8), the image going down as y goes up.
const center = (png, x, y) => png.rgba(Math.floor((x + 0.5) * 8), Math.floor((19 - y + 0.5) * 8));

test('the map is a PNG the widget accepts, cropped, scaled and flipped', () => {
  const image = renderMap({ frame, saved: null });
  assert.deepEqual(validateWidgetImage(image.png.toString('base64')), []);
  assert.match(image.key, /^map-[0-9a-f]{16}$/);
  const png = readPng(image.png);
  assert.deepEqual([png.width, png.height], [240, 160]);
  assert.deepEqual([image.width, image.height], [240, 160]);
  assert.ok(png.width <= MAX_IMAGE.WIDTH && png.height <= MAX_IMAGE.HEIGHT);
  // Outside the home: transparent.
  assert.equal(center(png, 0, 0)[3], 0);
  // Above room 1 (it stops at y = 8), room 2 still goes on: the flip.
  assert.equal(center(png, 6, 15)[3], 0);
  const room1 = center(png, 4, 3);
  const room2 = center(png, 24, 16);
  assert.equal(room1[3], 255);
  assert.equal(room2[3], 255);
  assert.notDeepEqual(room1.slice(0, 3), room2.slice(0, 3), 'neighbouring rooms, different colors');
  // The wall around room 1.
  assert.notDeepEqual(center(png, 2, 5).slice(0, 3), room1.slice(0, 3));
  // Same bytes, same key; the robot moved, another key.
  assert.equal(renderMap({ frame }).key, image.key);
  const moved = decodeMapFrame(
    buildMapFrame({
      width: 30,
      height: 20,
      grid: roomGrid(30, 20, { 1: [2, 2, 12, 8], 2: [13, 2, 27, 17] }),
      robot: { x: 1100, y: 700, angle: 0 },
      data: { seg_inf: {} },
    }),
  );
  assert.notEqual(renderMap({ frame: moved }).key, image.key);
});

test('the robot and the charger are drawn where they are', () => {
  const plain = decodeMapFrame(
    buildMapFrame({
      width: 30,
      height: 20,
      grid: roomGrid(30, 20, { 1: [2, 2, 12, 8], 2: [13, 2, 27, 17] }),
      data: { seg_inf: {} },
    }),
  );
  const drawn = readPng(renderMap({ frame }).png);
  const bare = readPng(renderMap({ frame: plain }).png);
  // The robot at (1000, 700) mm is cell (20, 14); the charger at (350, 250) mm
  // is cell (7, 5).
  assert.notDeepEqual(center(drawn, 20, 14), center(bare, 20, 14));
  assert.notDeepEqual(center(drawn, 7, 5), center(bare, 7, 5));
  // Away from both, nothing changes.
  assert.deepEqual(center(drawn, 25, 4), center(bare, 25, 4));
});

test('rooms read from the saved map when the current one has none', () => {
  const current = decodeMapFrame(
    buildMapFrame({ width: 30, height: 20, grid: Buffer.alloc(600, 1), data: { ris: 2 } }),
  );
  assert.ok(renderMap({ frame: current, saved: frame }));
  assert.equal(
    renderMap({ frame: current, saved: frame }).key !== renderMap({ frame: current }).key,
    true,
  );
  const empty = decodeMapFrame(buildMapFrame({ width: 4, height: 4, grid: Buffer.alloc(16, 0) }));
  assert.equal(renderMap({ frame: empty }), null);
});

test('neighbouring rooms never share a color', () => {
  // Three rooms in a row, each touching the next through a wall.
  const cells = new Uint8Array([1, 1, 250, 2, 2, 250, 3, 3]);
  const colors = roomColors(cells, 8, 1);
  assert.notEqual(colors.get(1), colors.get(2));
  assert.notEqual(colors.get(2), colors.get(3));
});

test('a robot on its base is ringed in green, the base being under it', () => {
  const at = { x: 1000, y: 700, angle: 0 };
  const onBase = decodeMapFrame(
    buildMapFrame({
      width: 30,
      height: 20,
      grid: roomGrid(30, 20, { 1: [2, 2, 12, 8], 2: [13, 2, 27, 17] }),
      robot: at,
      charger: at,
      data: { seg_inf: {} },
    }),
  );
  const png = readPng(renderMap({ frame: onBase }).png);
  // The robot is 28 px wide in radius at this scale: the ring is right outside.
  const ringX = Math.floor((20 + 0.5) * 8) + 30;
  const ringY = Math.floor((19 - 14 + 0.5) * 8);
  assert.deepEqual(png.rgba(ringX, ringY), [47, 179, 68, 255]);
  // Inside, the robot itself.
  assert.deepEqual(png.rgba(Math.floor((20 + 0.5) * 8) + 10, ringY), [255, 255, 255, 255]);
});

// --- The path of the robot -----------------------------------------------------

// A clean of room 2 the way a robot writes it (`tr`, Home Assistant format):
// lanes up and down 10 cm apart while vacuuming and mopping (`W`, then
// relative `L` steps of 2 cm, as a robot logs them), then a mop-only stroke
// (`M`) along the bottom, ended by an absolute step (`l`); the robot stands at
// the end of the lanes.
function lanes() {
  let tr = 'W725,150';
  for (let lane = 0; lane < 6; lane += 1) {
    const up = lane % 2 === 0;
    for (let step = 0; step < 35; step += 1) {
      tr += `L0,${up ? 20 : -20}`;
    }
    tr += 'L100,0';
  }
  return `${tr}M700,125L300,0l1300,125`;
}
const withPath = (tr, robot = { x: 1325, y: 150, angle: 0 }) =>
  decodeMapFrame(
    buildMapFrame({
      width: 30,
      height: 20,
      grid: roomGrid(30, 20, { 1: [2, 2, 12, 8], 2: [13, 2, 27, 17] }),
      charger: { x: 350, y: 250, angle: 0 },
      robot,
      data: { seg_inf: { 1: {}, 2: {} }, tr },
    }),
  );

test('the path is read as strokes, steps merged at the scale of the map', () => {
  const strokes = pathOf(withPath(lanes()));
  assert.deepEqual(
    strokes.map((stroke) => stroke.type),
    ['sweep-mop', 'mop'],
  );
  const [lanesStroke, mop] = strokes;
  // It starts where `W` says, and every relative step adds up.
  assert.deepEqual(lanesStroke.points.slice(0, 2), [725, 150]);
  assert.deepEqual(lanesStroke.points.slice(-2), [1325, 150]);
  // 2 cm steps are merged two by two (the map has 5 cm cells).
  assert.ok(lanesStroke.points.length / 2 < 6 * 35);
  assert.ok(lanesStroke.points.length / 2 > 6 * 35 * 0.4);
  // `l` is an absolute point, drawn on from the last one.
  assert.deepEqual(mop.points, [700, 125, 1000, 125, 1300, 125]);
  // `S` is a stroke of vacuuming only; a lone point or steps before any
  // stroke draw nothing.
  assert.deepEqual(pathOf(withPath('L50,50S100,100L0,500')), [
    { type: 'sweep', points: [100, 100, 100, 600] },
  ]);
  assert.deepEqual(pathOf(withPath('S100,100')), []);
  assert.deepEqual(pathOf(withPath('')), []);
  assert.deepEqual(pathOf({ data: {} }), []);
  assert.deepEqual(pathOf(withPath('garbage')), []);
});

test('the path is drawn over the rooms, the robot over the path', () => {
  const bare = readPng(renderMap({ frame: withPath(lanes()) }, { path: false }).png);
  const image = renderMap({ frame: withPath(lanes()) });
  assert.deepEqual(validateWidgetImage(image.png.toString('base64')), []);
  const drawn = readPng(image.png);
  // The first lane goes up x = 725 mm (cell 14) from y = 150 to 850 mm.
  const lane = center(drawn, 14, 9);
  assert.notDeepEqual(lane, center(bare, 14, 9));
  assert.deepEqual(lane, [250, 251, 253, 255]);
  // The mop-only stroke along y = 125 mm (cell 2, the wall row of room 2) is
  // another color.
  const mop = center(drawn, 17, 2);
  assert.deepEqual(mop, [36, 120, 214, 255]);
  // Between two lanes (10 cm apart, two cells), the room shows through.
  assert.deepEqual(center(drawn, 15, 9), center(bare, 15, 9));
  // The robot stands at the end of a lane: drawn on top of it.
  assert.deepEqual(center(drawn, 26, 3), center(bare, 26, 3));
  // Room 1, which the robot did not clean, is untouched.
  assert.deepEqual(center(drawn, 5, 5), center(bare, 5, 5));
  // A map without a path is drawn as before.
  assert.equal(renderMap({ frame }).key, renderMap({ frame }, { path: false }).key);
  assert.notEqual(image.key, renderMap({ frame: withPath(lanes()) }, { path: false }).key);
});

test('a very long path stays within bounds, in size, time and points', () => {
  // A robot going round and round for hours: far more steps than kept.
  const steps = [];
  for (let i = 0; i < 400000; i += 1) {
    steps.push(i % 2 === 0 ? 'L37,0' : 'L-37,25');
    if (i % 60 === 59) {
      steps.push('L0,-1500');
    }
  }
  const tr = `S700,150${steps.join('')}`;
  const started = Date.now();
  const strokes = pathOf(withPath(tr));
  assert.ok(strokes.reduce((sum, stroke) => sum + stroke.points.length / 2, 0) <= MAX_PATH_POINTS);
  const image = renderMap({ frame: withPath(tr) });
  assert.ok(Date.now() - started < 5000, `${Date.now() - started} ms`);
  assert.deepEqual(validateWidgetImage(image.png.toString('base64')), []);
  // A palette PNG: a few kilobytes still, the widget frame at most.
  assert.ok(image.png.length < 64 * 1024, `${image.png.length} bytes`);
  assert.ok(image.width <= MAX_IMAGE.WIDTH && image.height <= MAX_IMAGE.HEIGHT);
});
