import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MapDecodeError,
  decodeMapFrame,
  mapLocationOf,
  namedRooms,
  roomName,
  roomsOf,
  splitObjectName,
} from '../src/dreame/map.js';
import { mapIvFor } from '../src/dreame/models.js';
import { buildMapFrame, segment } from './helpers/mapFrame.js';

const SEG_INF = {
  1: segment({ type: 1 }),
  2: segment({ type: 4 }),
  3: segment({ type: 0, name: 'Chambre de Léa' }),
  4: segment({ type: 2, index: 1 }),
  5: segment({ type: 0 }),
};

test('a clear map frame: header, grid, then the JSON trailer', () => {
  const frame = decodeMapFrame(buildMapFrame({ width: 7, height: 5, data: { seg_inf: SEG_INF } }));
  assert.equal(frame.frameType, 73);
  assert.equal(frame.mapId, 3);
  assert.equal(frame.width, 7);
  assert.equal(frame.height, 5);
  assert.deepEqual(Object.keys(frame.data.seg_inf), ['1', '2', '3', '4', '5']);
});

test('an encrypted frame is decrypted with the model IV and the key of the object name', () => {
  const { iv } = mapIvFor('dreame.vacuum.r2416');
  const raw = buildMapFrame({ data: { seg_inf: SEG_INF }, key: 'k3y', iv });
  const frame = decodeMapFrame(raw, { key: 'k3y', iv });
  assert.equal(roomsOf(frame).length, 5);
});

test('the key may also come inline, after the frame', () => {
  const { iv } = mapIvFor('dreame.vacuum.r2416');
  const raw = buildMapFrame({ data: { seg_inf: SEG_INF }, key: 'inline', iv });
  assert.equal(roomsOf(decodeMapFrame(`${raw},inline`, { iv })).length, 5);
});

test('a wrong IV is reported as such, not as a crash', () => {
  const raw = buildMapFrame({ data: { seg_inf: SEG_INF }, key: 'k3y', iv: '0123456789abcdef' });
  assert.throws(() => decodeMapFrame(raw, { key: 'k3y', iv: 'fedcba9876543210' }), MapDecodeError);
  assert.throws(() => decodeMapFrame(raw, { key: 'k3y', iv: null }), /no IV/);
});

test('rooms are named as in the app: type first, then the custom name', () => {
  const rooms = roomsOf(decodeMapFrame(buildMapFrame({ data: { seg_inf: SEG_INF } })));
  assert.deepEqual(
    rooms.map((room) => roomName(room, 'fr')),
    ['Salon', 'Cuisine', 'Chambre de Léa', 'Chambre principale 2', 'Pièce 5'],
  );
  assert.deepEqual(
    rooms.map((room) => roomName(room, 'en')),
    ['Living room', 'Kitchen', 'Chambre de Léa', 'Primary bedroom 2', 'Room 5'],
  );
  // sorted by name for the selector, numbers in numeric order
  assert.deepEqual(
    namedRooms(rooms, 'fr').map((room) => room.id),
    [3, 4, 2, 5, 1],
  );
});

test('a frame without rooms gives no rooms', () => {
  assert.deepEqual(roomsOf(decodeMapFrame(buildMapFrame({ data: {} }))), []);
  assert.deepEqual(roomsOf(null), []);
});

test('the object name and its key are split', () => {
  assert.deepEqual(splitObjectName('a/b/c,k'), { name: 'a/b/c', key: 'k' });
  assert.deepEqual(splitObjectName('a/b/c'), { name: 'a/b/c', key: null });
});

test('the map location is read wherever the firmware puts it', () => {
  assert.deepEqual(
    mapLocationOf({
      out: [
        { piid: 3, value: 'obj,k' },
        { piid: 5, value: '1' },
      ],
    }),
    {
      objectName: 'obj,k',
      frame: null,
    },
  );
  assert.deepEqual(mapLocationOf({ out: [{ piid: 1, value: 'FRAME' }] }), {
    objectName: null,
    frame: 'FRAME',
  });
  assert.deepEqual(mapLocationOf({ out: [{ piid: 13, value: '1,obj,k' }] }), {
    objectName: 'obj,k',
    frame: null,
  });
  assert.deepEqual(mapLocationOf({ out: [{ piid: 13, value: '0,FRAME' }] }), {
    objectName: null,
    frame: 'FRAME',
  });
  assert.deepEqual(mapLocationOf({ out: [] }), { objectName: null, frame: null });
});

test('garbage is refused with a decode error', () => {
  assert.throws(() => decodeMapFrame(''), MapDecodeError);
  assert.throws(() => decodeMapFrame('bm90IGEgbWFw'), MapDecodeError);
});
