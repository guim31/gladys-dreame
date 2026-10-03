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
  cleansSelection,
  settingChoices,
  settingContent,
  stateText,
  isUnderWay,
  launchKeyOf,
  taskKey,
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

test('the robot widget: state, map, battery and wear, buttons, all valid', () => {
  const content = robotContent(view(), 'fr');
  assert.deepEqual(validateWidgetContent(content), []);
  // No tile: Gladys would set it above the map, on a row of its own.
  assert.deepEqual(types(content), [
    'text',
    'image',
    'status',
    'button',
    'button',
    'button',
    'button',
  ]);
  assert.equal(content.components[0].text, 'Doudou · Charge terminée');
  assert.equal(find(content, (c) => c.type === 'image').key, 'map-0123456789abcdef');
  assert.deepEqual(
    find(content, (c) => c.type === 'status').items.map((item) => [
      item.label,
      item.value,
      item.color,
    ]),
    [
      ['Batterie', '100 %', 'success'],
      // the most worn first; the wheels its model does not have are not a part
      ['Filtre', '3 %', 'danger'],
      ['Brosse latérale', '14 %', 'warning'],
      ['Brosse principale', '69 %', 'success'],
      ['Capteurs', '83 %', 'success'],
    ],
  );
  assert.deepEqual(
    buttons(content).map((c) => [c.label, c.icon, c.action.key, c.action.params.did]),
    [
      ['Nettoyer', 'play', 'start', '42'],
      ['Pause', 'pause', 'pause', '42'],
      ['Retour base', 'home', 'dock', '42'],
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

test('the robot widget may list the settings and the last clean instead', () => {
  const content = robotContent(view(), 'fr', { list: 'settings' });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.deepEqual(
    find(content, (c) => c.type === 'status').items.map((item) => [item.label, item.value]),
    [
      ['Batterie', '100 %'],
      ['Mode', 'Lavage du sol'],
      ['Aspiration', 'Standard'],
      ['Itinéraire', 'Standard'],
      ['Humidité', '25 / 32'],
      ['Dernier nettoyage', '35 m² · 42 min'],
      ['Usure : Filtre', '3 %'],
    ],
  );
  // An unknown list is the default one.
  assert.deepEqual(robotContent(view(), 'fr', { list: 'nope' }), robotContent(view(), 'fr', {}));
});

test('a low battery is flagged, and a list stays within ten rows', () => {
  const low = view({ caps: null });
  low.props.set('3.1', 15);
  for (const prop of ['17.1', '18.1', '19.2', '20.1', '24.1', '25.2', '26.2', '29.2', '31.2']) {
    low.props.set(prop, 50);
  }
  const content = robotContent(low, 'en');
  assert.deepEqual(validateWidgetContent(content), []);
  const { items } = find(content, (c) => c.type === 'status');
  assert.deepEqual(
    [items[0].label, items[0].value, items[0].color],
    ['Battery', '15 %', 'warning'],
  );
  assert.equal(items.length, 10);
  low.props.set('3.1', 8);
  assert.equal(find(robotContent(low, 'en'), (c) => c.type === 'status').items[0].color, 'danger');
});

test('the last clean is left out until there is one', () => {
  const fresh = view();
  fresh.props.set('4.2', 0);
  fresh.props.set('4.3', 0);
  const content = robotContent(fresh, 'fr', { list: 'settings' });
  const labels = find(content, (c) => c.type === 'status').items.map((item) => item.label);
  assert.ok(!labels.includes('Dernier nettoyage'));
});

test('rooms picked: the clean button cleans them, unless a paused task waits', () => {
  const picked = view({ picks: new Set(['2', '12']) });
  assert.ok(cleansSelection(picked));
  const label = (content) => find(content, (c) => c.type === 'button').label;
  assert.equal(label(robotContent(picked, 'fr')), 'Nettoyer la sélection');
  assert.equal(label(robotContent(picked, 'en')), 'Clean the selection');
  // a room picked that the map no longer has does not count
  assert.ok(!cleansSelection(view({ picks: new Set(['99']) })));
  const paused = view({ picks: new Set(['2']) });
  paused.props.set('2.1', 2);
  paused.props.set('4.7', 6);
  paused.props.set('4.1', 2);
  assert.ok(!cleansSelection(paused));
  assert.equal(label(robotContent(paused, 'fr')), 'Reprendre');
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

test('a setting as a row of buttons, the current choice ticked', () => {
  const content = settingContent(view(), { setting: 'cleaning_mode' }, 'fr');
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components[0].text, 'Doudou · Mode');
  assert.equal(content.components[1].text, 'Lavage du sol');
  const set = (value) => ({ did: '42', kind: 'set', code: 'cleaning-mode', value });
  // An icon, never the `primary` style: Gladys paints it like the others in
  // dark mode.
  assert.deepEqual(
    buttons(content).map((c) => [c.label, c.style, c.icon, c.action.key, c.action.params]),
    [
      ['Aspiration', undefined, 'circle', 'choice_1', set('sweeping')],
      ['Lavage du sol', undefined, 'check-circle', 'choice_2', set('mopping')],
      ['Aspiration + lavage', undefined, 'circle', 'choice_3', set('sweeping-and-mopping')],
      ['Lavage après aspiration', undefined, 'circle', 'choice_4', set('mopping-after-sweeping')],
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
        .filter((c) => c.icon === 'check-circle')
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

test('the button of the task under way is ticked, and no button looks selected otherwise', () => {
  // Nothing runs: no button stands out (a primary first button looked
  // selected to the tester).
  const idle = quickContent(view(), { button_1: 'Couloir', button_2: 'Raccourcis3' }, 'fr');
  assert.deepEqual(
    buttons(idle).map((c) => [c.label, c.style, c.icon]),
    [
      ['Couloir', undefined, undefined],
      ['Raccourcis3', undefined, undefined],
    ],
  );
  // The robot says Raccourcis3 runs.
  const shortcuts = [
    { id: 32, name: 'Couloir', running: false },
    { id: 34, name: 'Raccourcis3', running: true },
  ];
  const running = quickContent(
    view({ shortcuts }),
    { button_1: 'Couloir', button_2: 'Raccourcis3' },
    'fr',
  );
  assert.deepEqual(
    buttons(running).map((c) => [c.label, c.icon]),
    [
      ['Couloir', undefined],
      ['Raccourcis3', 'check-circle'],
    ],
  );
  assert.deepEqual(validateWidgetContent(running), []);
  // Rooms sent from Gladys, while the robot cleans rooms.
  const cleaning = view({ lastLaunch: 'rooms:1,2' });
  cleaning.props.set('4.1', 18);
  cleaning.props.set('4.7', 1);
  assert.equal(isUnderWay(cleaning, { kind: 'rooms', rooms: [2, 1] }), true);
  assert.equal(isUnderWay(cleaning, { kind: 'rooms', rooms: [12] }), false);
  assert.equal(
    isUnderWay(view({ lastLaunch: 'rooms:1,2' }), { kind: 'rooms', rooms: [1, 2] }),
    false,
  );
  // The robot widget has no highlighted button either.
  assert.ok(robotContent(view(), 'fr').components.every((c) => c.style === undefined));
});

test('the task a command starts, whichever way it was sent', () => {
  assert.equal(taskKey({ kind: 'shortcut', id: '34' }), 'shortcut:34');
  assert.equal(taskKey({ kind: 'rooms', rooms: [12, 1] }), 'rooms:1,12');
  assert.equal(taskKey({ kind: 'selection' }), 'selection');
  assert.equal(launchKeyOf('shortcut-34', 1), 'shortcut:34');
  assert.equal(launchKeyOf('shortcut-34', 0), null);
  assert.equal(launchKeyOf('room', '12'), 'rooms:12');
  assert.equal(launchKeyOf('room', 'none'), null);
  assert.equal(launchKeyOf('clean-rooms', 1), 'selection');
  assert.equal(launchKeyOf('suction', 'turbo'), null);
});
