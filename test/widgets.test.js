import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import { modelCapabilities } from '../src/dreame/models.js';
import { moppingOf } from '../src/dreame/mopping.js';
import {
  SETTINGS,
  fit,
  maintenanceContent,
  messageContent,
  quickButtons,
  quickContent,
  robotContent,
  settingChoices,
  settingContent,
  stateText,
  wearOf,
  widgetCommand,
  widgetLanguage,
  widgetMessage,
} from '../src/widgets.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

const ids = createFakeGladys().externalIds('vacuum', '42');
const settings = (entries) => JSON.stringify(entries.map(([k, v]) => ({ k, v })));
const caps = modelCapabilities('dreame.vacuum.r2449a', '4.3.9_1771');
const mopping = moppingOf(
  caps,
  new Set(['4.4', '4.23', '4.25', '4.26', '4.50', '28.1']),
  new Set(['BackWashType', 'SuctionMax', 'CleanRoute']),
);
// The first tester's robot, on its base, as its diagnostic showed it: it
// answers 0 % for wheels its model does not have.
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
    ['4.23', 3841],
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
  caps,
  ids,
  features: null,
  mapKey: 'map-0123456789abcdef',
  rooms: [
    { id: 1, type: 1, index: 0, customName: null },
    { id: 2, type: 4, index: 0, customName: null },
    { id: 3, type: 0, index: 0, customName: 'Chambre de Léa' },
    { id: 12, type: 8, index: 0, customName: null },
  ],
  shortcuts: [
    { id: 32, name: 'Couloir' },
    { id: 33, name: 'Personnaliser le nettoyage des pièces' },
    { id: 34, name: 'Raccourcis3' },
  ],
  picks: new Set(),
  ...overrides,
});
const types = (content) => content.components.map((component) => component.type);
const find = (content, predicate) => content.components.find(predicate);
const buttons = (content) => content.components.filter((c) => c.type === 'button');

test('the robot widget: state, battery, map, settings and buttons, all valid', () => {
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
      ['Mode', 'Lavage du sol'],
      ['Aspiration', 'Standard'],
      ['Itinéraire', 'Standard'],
      ['Humidité', '25 / 32'],
      ['Dernier nettoyage', '35 m² · 42 min'],
      // the wheels its model does not have are not a worn part
      ['Usure : Filtre', '3 %'],
    ],
  );
  assert.deepEqual(
    buttons(content).map((c) => [c.label, c.icon, c.action.key, c.action.params.did]),
    [
      ['Nettoyer', 'play', 'start', '42'],
      ['Pause', 'pause', 'pause', '42'],
      ['Base', 'home', 'dock', '42'],
      ['Localiser', 'map-pin', 'locate', '42'],
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

test('the last clean is left out until there is one', () => {
  const fresh = view();
  fresh.props.set('4.2', 0);
  fresh.props.set('4.3', 0);
  const labels = find(robotContent(fresh, 'fr'), (c) => c.type === 'status').items.map(
    (item) => item.label,
  );
  assert.ok(!labels.includes('Dernier nettoyage'));
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

test('the wear parts are the ones the model has; an unknown model keeps them all', () => {
  assert.deepEqual(
    wearOf(view()).map((part) => part.code),
    ['filter', 'side-brush', 'main-brush', 'sensor'],
  );
  assert.deepEqual(
    wearOf(view({ caps: null })).map((part) => part.code),
    ['wheel', 'filter', 'side-brush', 'main-brush', 'sensor'],
  );
});

test('quick buttons: the shortcuts by default, every one of them', () => {
  const content = quickContent(view(), {}, 'fr');
  // Each button its own action key: Gladys drops a button whose key is taken.
  assert.deepEqual(validateWidgetContent(content), []);
  assert.deepEqual(
    buttons(content).map((c) => [c.label, c.action.key, c.action.params]),
    [
      ['Couloir', 'quick_1', { did: '42', kind: 'shortcut', id: 32 }],
      ['Personnaliser le nettoy…', 'quick_2', { did: '42', kind: 'shortcut', id: 33 }],
      ['Raccourcis3', 'quick_3', { did: '42', kind: 'shortcut', id: 34 }],
    ],
  );
});

test('quick buttons: shortcuts, rooms and several rooms, by name', () => {
  // Case and accents do not matter; rooms in either language; a shortcut wins
  // over a room of the same name.
  const named = quickButtons(
    view(),
    {
      button_1: 'couloir',
      button_2: 'RACCOURCIS3',
      button_3: 'Cuisine + Living room',
      button_4: 'Grenier',
    },
    'fr',
  );
  assert.deepEqual(
    named.buttons.map((b) => [b.label, b.params]),
    [
      ['couloir', { did: '42', kind: 'shortcut', id: 32 }],
      ['RACCOURCIS3', { did: '42', kind: 'shortcut', id: 34 }],
      ['Cuisine + Living room', { did: '42', kind: 'rooms', rooms: [2, 1] }],
    ],
  );
  assert.deepEqual(named.unknown, ['Grenier']);
  assert.deepEqual(quickButtons(view(), { button_1: 'Salon, Couloir' }, 'fr').buttons[0].params, {
    did: '42',
    kind: 'rooms',
    rooms: [1, 12],
  });
  const content = quickContent(
    view(),
    { button_1: 'Couloir', button_2: 'Raccourcis3', button_3: 'Cuisine', button_4: 'Grenier' },
    'fr',
  );
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(buttons(content).length, 3);
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
  assert.deepEqual(buttons(content)[0].action.params, { did: '42', kind: 'selection' });
});

test('quick buttons: nothing to show says how to get some', () => {
  const content = quickContent(view({ shortcuts: [] }), {}, 'en');
  assert.deepEqual(validateWidgetContent(content), []);
  assert.match(find(content, (c) => c.type === 'text' && !c.variant).text, /No shortcut/);
});

test('a setting as a row of buttons, the current choice lit', () => {
  const content = settingContent(view(), { setting: 'cleaning_mode' }, 'fr');
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components[0].text, 'Doudou · Mode');
  assert.equal(content.components[1].text, 'Lavage du sol');
  const set = (value) => ({ did: '42', kind: 'set', code: 'cleaning-mode', value });
  assert.deepEqual(
    buttons(content).map((c) => [c.label, c.style || '-', c.icon, c.action.key, c.action.params]),
    [
      ['Aspiration', '-', 'circle', 'choice_1', set('sweeping')],
      ['Lavage du sol', 'primary', 'check', 'choice_2', set('mopping')],
      ['Aspiration + lavage', '-', 'circle', 'choice_3', set('sweeping-and-mopping')],
      ['Lavage après aspiration', '-', 'circle', 'choice_4', set('mopping-after-sweeping')],
    ],
  );
  // The cleaning mode, by default.
  assert.equal(settingContent(view(), {}, 'fr').components[0].text, 'Doudou · Mode');
});

test('every setting of the app has its buttons', () => {
  const lit = (setting, entries = []) => {
    const robot = view();
    for (const [key, value] of entries) {
      robot.props.set(key, value);
    }
    const content = settingContent(robot, { setting }, 'fr');
    assert.deepEqual(validateWidgetContent(content), [], setting);
    return {
      caption: content.components[1].text,
      labels: buttons(content).map((c) => c.label),
      active: buttons(content)
        .filter((c) => c.style === 'primary')
        .map((c) => c.label),
    };
  };
  assert.deepEqual(lit('suction'), {
    caption: 'Standard',
    labels: ['Silencieux', 'Standard', 'Intense', 'Max'],
    active: ['Standard'],
  });
  assert.deepEqual(lit('max_suction'), {
    caption: 'Désactivée',
    labels: ['Désactivée', 'Activée'],
    active: ['Désactivée'],
  });
  assert.deepEqual(lit('route'), {
    caption: 'Standard',
    labels: ['Rapide', 'Standard', 'Intensif', 'En profondeur'],
    active: ['Standard'],
  });
  // A mode that vacuums only has two routes, and no use for the mops.
  assert.deepEqual(lit('route', [['4.23', 3842]]).labels, ['Rapide', 'Standard']);
  assert.deepEqual(lit('wetness'), {
    caption: '25 / 32',
    labels: ['Légèrement sèche', 'Humide', 'Mouillée'],
    active: ['Mouillée'],
  });
  assert.equal(
    lit('wetness', [['4.23', 3842]]).caption,
    '25 / 32 · sans effet en aspiration seule',
  );
  assert.deepEqual(lit('wash_frequency'), {
    caption: 'Lavage tous les 15 m²',
    labels: ['Par zone', 'Par heure', 'Par pièce'],
    active: ['Par zone'],
  });
  const missing = settingContent(view({ mopping: null }), { setting: 'wetness' }, 'en');
  assert.deepEqual(validateWidgetContent(missing), []);
  assert.equal(missing.components[1].text, 'This robot has no such setting.');
  assert.equal(settingChoices(view({ mopping: null }), 'cleaning_mode', 'en'), null);
});

test('a widget button says what it does, and only what a widget may do', () => {
  assert.deepEqual(widgetCommand('start', { did: '42' }), { code: 'run-mode', value: 1 });
  assert.deepEqual(widgetCommand('locate', { did: '42' }), { code: 'locate', value: 1 });
  assert.deepEqual(widgetCommand('quick_1', { did: '42', kind: 'shortcut', id: 34 }), {
    code: 'shortcut-34',
    value: 1,
  });
  assert.deepEqual(widgetCommand('quick_2', { did: '42', kind: 'rooms', rooms: [2, 1] }), {
    rooms: [2, 1],
  });
  assert.deepEqual(widgetCommand('quick_3', { did: '42', kind: 'selection' }), {
    code: 'clean-rooms',
    value: 1,
  });
  assert.deepEqual(
    widgetCommand('choice_1', { did: '42', kind: 'set', code: 'suction', value: 'turbo' }),
    { code: 'suction', value: 'turbo' },
  );
  // Never another feature than the settings.
  assert.equal(
    widgetCommand('choice_1', { did: '42', kind: 'set', code: 'locate', value: 1 }),
    null,
  );
  assert.equal(widgetCommand('explode', { did: '42' }), null);
  assert.equal(Object.keys(SETTINGS).length, 6);

  const robot = view();
  assert.equal(widgetMessage('dock', {}, robot, 'fr'), 'Retour à la base demandé');
  assert.equal(
    widgetMessage('quick_1', { kind: 'shortcut', id: 34 }, robot, 'fr'),
    'Raccourci lancé : Raccourcis3',
  );
  assert.equal(
    widgetMessage('quick_2', { kind: 'rooms', rooms: [2, 1] }, robot, 'en'),
    'Cleaning started: Kitchen, Living room',
  );
  assert.equal(
    widgetMessage(
      'choice_2',
      { kind: 'set', code: 'cleaning-mode', value: 'mopping' },
      robot,
      'fr',
    ),
    'Mode : Lavage du sol',
  );
  assert.equal(
    widgetMessage('choice_3', { kind: 'set', code: 'wetness', value: 27 }, robot, 'en'),
    'Wetness: Wet',
  );
});

test('the maintenance widget: the most worn parts first, the model ones only', () => {
  const content = maintenanceContent(view(), 'fr');
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components[1].text, '1 pièce à remplacer');
  assert.deepEqual(
    content.components.filter((c) => c.type === 'gauge').map((c) => [c.label, c.value, c.color]),
    [
      ['Filtre', 3, 'danger'],
      ['Brosse latérale', 14, 'warning'],
      ['Brosse principale', 69, 'success'],
    ],
  );
  assert.deepEqual(
    find(content, (c) => c.type === 'status').items.map((item) => item.value),
    ['3 %', '14 %', '69 %', '83 %'],
  );
  const live = maintenanceContent(
    view({ features: new Set([ids.feature('consumable-filter')]) }),
    'fr',
  );
  assert.equal(
    find(live, (c) => c.type === 'gauge').device_feature,
    ids.feature('consumable-filter'),
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
