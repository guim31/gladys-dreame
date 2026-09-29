import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import { modelCapabilities } from '../src/dreame/models.js';
import { moppingOf } from '../src/dreame/mopping.js';
import {
  fit,
  maintenanceContent,
  messageContent,
  quickButtons,
  quickContent,
  robotContent,
  stateText,
  widgetLanguage,
} from '../src/widgets.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

const ids = createFakeGladys().externalIds('vacuum', '42');
const settings = (entries) => JSON.stringify(entries.map(([k, v]) => ({ k, v })));
const mopping = moppingOf(
  modelCapabilities('dreame.vacuum.r2449a', '4.3.9_1771'),
  new Set(['4.4', '4.23', '4.25', '4.26', '4.50', '28.1']),
  new Set(['BackWashType', 'SuctionMax', 'CleanRoute']),
);
// The first tester's robot, on its base, as its diagnostic showed it.
const docked = () =>
  new Map([
    ['2.1', 13],
    ['2.2', 0],
    ['3.1', 100],
    ['3.2', 3],
    ['4.1', 0],
    ['4.2', 42],
    ['4.3', 35],
    ['4.4', 1],
    ['4.7', 0],
    ['4.23', 3842],
    ['4.26', 0],
    ['28.1', 25],
    [
      '4.50',
      settings([
        ['CleanRoute', 1],
        ['SuctionMax', 0],
        ['BackWashType', 1],
      ]),
    ],
    ['9.2', 69],
    ['10.2', 14],
    ['11.1', 3],
    ['16.1', 83],
    ['30.2', 0],
  ]);
const view = (overrides = {}) => ({
  did: '42',
  name: 'Doudou',
  props: docked(),
  newNumbering: true,
  mopping,
  ids,
  features: null,
  mapKey: 'map-0123456789abcdef',
  rooms: [
    { id: 1, type: 1, index: 0, customName: null },
    { id: 2, type: 4, index: 0, customName: null },
    { id: 3, type: 0, index: 0, customName: 'Chambre de Léa' },
  ],
  shortcuts: [
    { id: 32, name: 'Après le dîner' },
    { id: 33, name: 'Nettoyage Chambres' },
  ],
  picks: new Set(),
  ...overrides,
});
const types = (content) => content.components.map((component) => component.type);
const find = (content, predicate) => content.components.find(predicate);

test('the robot widget: state, tiles, map, settings and buttons, all valid', () => {
  const content = robotContent(view(), 'fr');
  assert.deepEqual(validateWidgetContent(content), []);
  // The 8 components Gladys renders at most.
  assert.deepEqual(types(content), [
    'text',
    'value',
    'image',
    'status',
    'button',
    'button',
    'button',
    'button',
  ]);
  assert.equal(content.components[0].text, 'Doudou · Charge terminée');
  const battery = find(content, (c) => c.type === 'value');
  assert.deepEqual([battery.label, battery.value, battery.unit], ['Batterie', 100, '%']);
  assert.equal(find(content, (c) => c.type === 'image').key, 'map-0123456789abcdef');
  assert.deepEqual(
    find(content, (c) => c.type === 'status').items.map((item) => [item.label, item.value]),
    [
      ['Mode', 'Aspiration'],
      ['Aspiration', 'Standard'],
      ['Itinéraire', 'Standard'],
      ['Humidité', '25 / 32'],
      ['Dernier nettoyage', '35 m² · 42 min'],
      ['Usure : Roues', '0 %'],
    ],
  );
  assert.deepEqual(
    content.components
      .filter((c) => c.type === 'button')
      .map((c) => [c.label, c.action.key, c.action.params.did]),
    [
      ['Nettoyer', 'start', '42'],
      ['Pause', 'pause', '42'],
      ['Base', 'dock', '42'],
      ['Localiser', 'locate', '42'],
    ],
  );
  // Docked: ten minutes; the map is re-read while the robot moves.
  assert.equal(content.ttl_seconds, 600);
  const running = view();
  running.props.set('2.1', 1);
  running.props.set('4.7', 1);
  running.props.set('4.1', 2);
  const busy = robotContent(running, 'en');
  assert.equal(busy.ttl_seconds, 60);
  assert.equal(busy.components[0].text, 'Doudou · Vacuuming');
});

test('a robot added to Gladys gets a live battery tile', () => {
  const features = new Set([ids.feature('battery')]);
  const content = robotContent(view({ features }), 'fr');
  const battery = find(content, (c) => c.type === 'value');
  assert.equal(battery.device_feature, ids.feature('battery'));
  assert.equal(battery.value, undefined);
  assert.deepEqual(validateWidgetContent(content), []);
});

test('the state says the error, and the pause turns the clean button into resume', () => {
  const failing = view();
  failing.props.set('2.2', 12);
  assert.equal(stateText(failing, 'fr'), 'Erreur : Brosse principale bloquée');
  const paused = view();
  paused.props.set('2.1', 2);
  paused.props.set('4.7', 6);
  paused.props.set('4.1', 2);
  const content = robotContent(paused, 'fr');
  assert.equal(content.components[0].text, 'Doudou · En pause');
  assert.equal(find(content, (c) => c.type === 'button').label, 'Reprendre');
});

test('without a map nor a mop, the widget keeps the rest', () => {
  const content = robotContent(view({ mapKey: null, mopping: null }), 'en');
  assert.ok(!types(content).includes('image'));
  assert.deepEqual(validateWidgetContent(content), []);
});

test('quick buttons: the shortcuts by default, else the names given', () => {
  assert.deepEqual(
    quickButtons(view(), {}, 'fr').buttons.map((b) => [b.label, b.action, b.params]),
    [
      ['Après le dîner', 'shortcut', { did: '42', id: 32 }],
      ['Nettoyage Chambres', 'shortcut', { did: '42', id: 33 }],
    ],
  );
  // Case and accents do not matter; rooms in either language.
  const named = quickButtons(
    view(),
    {
      button_1: 'cuisine',
      button_2: 'Living room',
      button_3: 'APRES LE DINER',
      button_4: 'Grenier',
    },
    'fr',
  );
  assert.deepEqual(
    named.buttons.map((b) => [b.label, b.action, b.params]),
    [
      ['cuisine', 'clean_room', { did: '42', room: 2 }],
      ['Living room', 'clean_room', { did: '42', room: 1 }],
      ['APRES LE DINER', 'shortcut', { did: '42', id: 32 }],
    ],
  );
  assert.deepEqual(named.unknown, ['Grenier']);
  const content = quickContent(view(), { button_1: 'Cuisine', button_2: 'Grenier' }, 'fr');
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(
    find(content, (c) => c.type === 'text' && !c.variant).text,
    'Ni raccourci ni pièce : Grenier.',
  );
});

test('quick buttons: "clean the selection" shows what is picked', () => {
  const content = quickContent(
    view({ picks: new Set(['1', '3']) }),
    { button_1: 'Nettoyer la sélection' },
    'fr',
  );
  assert.deepEqual(validateWidgetContent(content), []);
  assert.deepEqual(find(content, (c) => c.type === 'status').items, [
    { label: 'Sélection', value: 'Chambre de Léa, Salon' },
  ]);
  assert.equal(find(content, (c) => c.type === 'button').action.key, 'clean_selection');
});

test('quick buttons: nothing to show says how to get some', () => {
  const content = quickContent(view({ shortcuts: [] }), {}, 'en');
  assert.deepEqual(validateWidgetContent(content), []);
  assert.match(find(content, (c) => c.type === 'text' && !c.variant).text, /No shortcut/);
});

test('the maintenance widget: the most worn parts first', () => {
  const content = maintenanceContent(view(), 'fr');
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components[1].text, '2 pièces à remplacer');
  assert.deepEqual(
    content.components.filter((c) => c.type === 'gauge').map((c) => [c.label, c.value, c.color]),
    [
      ['Roues', 0, 'danger'],
      ['Filtre', 3, 'danger'],
      ['Brosse latérale', 14, 'warning'],
    ],
  );
  assert.deepEqual(
    find(content, (c) => c.type === 'status').items.map((item) => item.value),
    ['0 %', '3 %', '14 %', '69 %', '83 %'],
  );
  const live = maintenanceContent(
    view({ features: new Set([ids.feature('consumable-wheel')]) }),
    'fr',
  );
  assert.equal(
    find(live, (c) => c.type === 'gauge').device_feature,
    ids.feature('consumable-wheel'),
  );
  assert.deepEqual(validateWidgetContent(live), []);
  const none = maintenanceContent(view({ props: new Map() }), 'en');
  assert.deepEqual(validateWidgetContent(none), []);
});

test('texts are cut to the bounds of the core, the language falls back to English', () => {
  assert.equal(fit('Nettoyage de toute la maison après le dîner', 24), 'Nettoyage de toute la m…');
  assert.equal(fit('Court', 24), 'Court');
  assert.equal(widgetLanguage('de'), 'en');
  assert.equal(widgetLanguage('fr'), 'fr');
  assert.deepEqual(validateWidgetContent(messageContent('Aucun robot')), []);
});
