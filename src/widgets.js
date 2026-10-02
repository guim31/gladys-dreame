// -----------------------------------------------------------------------------
// Dashboard widgets (Gladys 5.1+), content builders — pure functions.
//
//   - robot         : one robot at a glance: state, battery, the map of the
//                     home, its settings and last clean, the four everyday
//                     buttons;
//   - quick_clean   : up to four buttons, each a shortcut of the app, a room or
//                     several rooms (named in the widget settings), for a wall
//                     tablet;
//   - robot_setting : ONE setting of the app (cleaning mode, suction, route,
//                     wetness…) as a row of buttons, the current choice ticked,
//                     for a wall tablet. Gladys keeps input controls (selects,
//                     sliders) out of widgets on purpose: every setting with
//                     its list or slider is in the device box of the core;
//   - maintenance   : the wear of each part, the most worn first.
//
// A widget shows the robot picked in its settings, else the first one. The
// buttons are widget actions carrying the robot id: they work whether or not
// the robot was added to Gladys. The battery and the wear gauges are bound to
// the device features when the robot was added, so they follow its states
// live. The map is an image served by the integration (onWidgetGetImage); its
// key changes with its bytes.
//
// Gladys renders at most 8 components, 2 of them texts and 4 of them buttons,
// and drops a button whose action key another one already uses: the keys are
// numbered, what a button does travels in its params. A current choice or a
// task under way is shown by its icon, never by the `primary` style: in dark
// mode Gladys paints a primary button like the others.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';

import {
  CLEANING_MODES,
  CONSUMABLES,
  DREAME_STATUS,
  FEATURE_CODES,
  PROP,
  ROOM_SELECTION_NONE,
  ROUTES,
  SUCTION_LEVELS,
  VACUUM_CLEANER_STATE,
  WASH_FREQUENCIES,
} from './constants.js';
import {
  gladysStateOf,
  hasTask,
  isRoomCleaning,
  maxSuctionOf,
  normalizeState,
  routeOf,
} from './devices/vacuum.js';
import { namedRooms } from './dreame/map.js';
import { tracksConsumable } from './dreame/models.js';
import { cleaningModeOf, routeAllowed, washFrequencyOf, washValueOf } from './dreame/mopping.js';
import { describeError, texts } from './i18n.js';

/** Widget keys, declared in the manifest `widgets` (forever: never rename). */
export const WIDGET = {
  ROBOT: 'robot',
  QUICK_CLEAN: 'quick_clean',
  ROBOT_SETTING: 'robot_setting',
  MAINTENANCE: 'maintenance',
};

// The four buttons of the robot widget, and the command each one sends.
const ROBOT_BUTTONS = {
  start: { code: FEATURE_CODES.RUN_MODE, value: 1, icon: 'play' },
  pause: { code: FEATURE_CODES.PAUSE, value: 1, icon: 'pause' },
  dock: { code: FEATURE_CODES.DOCK, value: 1, icon: 'home' },
  locate: { code: FEATURE_CODES.LOCATE, value: 1, icon: 'map-pin' },
};

// The widget settings naming the quick buttons.
export const QUICK_BUTTON_SETTINGS = ['button_1', 'button_2', 'button_3', 'button_4'];
// Several rooms in one quick button: "Cuisine + Salon", "Cuisine, Salon".
const ROOM_SEPARATOR = /\s*[+,]\s*/;

/** The settings the robot_setting widget can show, and the feature each sets. */
export const SETTINGS = {
  cleaning_mode: FEATURE_CODES.CLEANING_MODE,
  suction: FEATURE_CODES.SUCTION,
  max_suction: FEATURE_CODES.MAX_SUCTION,
  route: FEATURE_CODES.ROUTE,
  wetness: FEATURE_CODES.WETNESS,
  wash_frequency: FEATURE_CODES.WASH_FREQUENCY,
};
export const DEFAULT_SETTING = 'cleaning_mode';
// The wetness as the app's slider names it: slightly dry, damp, wet. A button
// sets the middle of its range, as the Home Assistant integration does.
const WETNESS_PRESETS = [
  { value: 5, upTo: 10 },
  { value: 16, upTo: 21 },
  { value: 27, upTo: 32 },
];
const MAX_BUTTONS = 4;
// The icon of the current choice, or of the task under way.
const CURRENT_ICON = 'check-circle';

// Wear thresholds, in percent left.
const WORN = 10;
const WEARING = 30;

/**
 * The language of a widget: Gladys sends the user's, the texts exist in two.
 * @param {string} language the user's language
 * @returns {string} `fr` or `en`
 */
export function widgetLanguage(language) {
  return language === 'fr' ? 'fr' : 'en';
}

/**
 * A text cut to a bound (the core would cut it, and say so in its logs).
 * @param {string} text the text
 * @param {number} max the bound
 * @returns {string} the text, with an ellipsis when cut
 */
export function fit(text, max) {
  const value = String(text).trim();
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

function toNumber(value) {
  const number = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(number)
    ? null
    : number;
}

/**
 * The state of a robot in words: its own state when it says more than the
 * Gladys one (drying the mops…), the error when there is one.
 * @param {object} view the robot, see robotContent()
 * @param {string} language `fr` or `en`
 * @returns {string|null} the state, null when unknown
 */
export function stateText(view, language) {
  const t = texts(language).widget;
  const state = gladysStateOf(view.props, view.newNumbering);
  if (state === null) {
    return null;
  }
  if (state === VACUUM_CLEANER_STATE.ERROR) {
    return t.error(describeError(toNumber(view.props.get(PROP.ERROR)), language));
  }
  const own = normalizeState(view.props.get(PROP.STATE), view.newNumbering);
  if (state !== VACUUM_CLEANER_STATE.PAUSED && t.robotStates[own]) {
    return t.robotStates[own];
  }
  return t.states[state];
}

function heading(text) {
  return { type: 'text', variant: 'heading', text: fit(text, 40) };
}

function header(view, language) {
  const state = stateText(view, language);
  return heading(state ? `${view.name} · ${state}` : view.name);
}

/**
 * A widget with nothing to show but a sentence.
 * @param {string} text the sentence
 * @returns {object} the content
 */
export function messageContent(text) {
  return { version: 1, ttl_seconds: 300, components: [{ type: 'text', text: fit(text, 300) }] };
}

function actionButton(label, key, params, icon = null) {
  return {
    type: 'button',
    label: fit(label, 24),
    ...(icon ? { icon } : {}),
    action: { key, params },
  };
}

/**
 * The wear parts of a robot that it really has, the most worn first.
 * @param {object} view the robot, see robotContent()
 * @returns {Array<object>} the CONSUMABLES entries, with `left` (percent)
 */
export function wearOf(view) {
  return CONSUMABLES.filter((consumable) => tracksConsumable(view.caps || null, consumable))
    .map((consumable) => ({ ...consumable, left: toNumber(view.props.get(consumable.prop)) }))
    .filter((consumable) => consumable.left !== null)
    .map((consumable) => ({ ...consumable, left: Math.max(0, Math.min(100, consumable.left)) }))
    .sort((a, b) => a.left - b.left);
}

function wearColor(left) {
  if (left <= WORN) {
    return WIDGET_COLORS.DANGER;
  }
  return left <= WEARING ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS;
}

/**
 * The "robot" widget.
 * @param {object} view what the integration knows of the robot
 * @param {string} view.did the robot id
 * @param {string} view.name its name
 * @param {Map<string, *>} view.props its properties
 * @param {boolean} view.newNumbering whether it numbers its states the new way
 * @param {object|null} view.mopping moppingOf() of the robot
 * @param {object|null} view.caps modelCapabilities() of the robot
 * @param {object} view.ids its external ids (`{ feature(code) }`)
 * @param {Set<string>|null} view.features the external ids of its features in
 *   Gladys, null when it was not added
 * @param {string|null} view.mapKey the key of its map image
 * @param {string} language `fr` or `en`
 * @returns {object} the widget content
 */
export function robotContent(view, language) {
  const t = texts(language);
  const w = t.widget;
  const components = [header(view, language)];
  const has = (code) => Boolean(view.features && view.features.has(view.ids.feature(code)));

  const battery = toNumber(view.props.get(PROP.BATTERY));
  if (has(FEATURE_CODES.BATTERY)) {
    components.push({
      type: 'value',
      label: w.battery,
      icon: 'battery',
      device_feature: view.ids.feature(FEATURE_CODES.BATTERY),
    });
  } else if (battery !== null) {
    components.push({
      type: 'value',
      label: w.battery,
      icon: 'battery',
      value: battery,
      unit: '%',
    });
  }
  if (view.mapKey) {
    components.push({ type: 'image', key: view.mapKey, alt: w.map, fit: 'contain' });
  }

  const items = [];
  const mode = view.mopping ? cleaningModeOf(view.props, view.mopping) : null;
  if (mode) {
    items.push({ label: w.mode, value: fit(t.cleaningModes[mode], 40) });
  }
  const suction = SUCTION_LEVELS.find(
    (level) => level.code === toNumber(view.props.get(PROP.SUCTION_LEVEL)),
  );
  if (suction) {
    const boosted = maxSuctionOf(view.props) === 1;
    items.push({
      label: w.suction,
      value: boosted ? `${t.suctions[suction.value]} (${w.maxSuction})` : t.suctions[suction.value],
    });
  }
  const route = routeOf(view.props);
  if (route) {
    items.push({ label: w.route, value: t.routes[route.value] });
  }
  const wetness = toNumber(view.props.get(PROP.WETNESS_LEVEL));
  if (view.mopping && view.mopping.wetness && wetness !== null) {
    items.push({ label: w.wetness, value: `${wetness} / 32` });
  }
  // Nothing to say before a first clean (both stay at 0).
  const area = toNumber(view.props.get(PROP.CLEANED_AREA));
  const minutes = toNumber(view.props.get(PROP.CLEANING_TIME));
  if (area > 0 || minutes > 0) {
    items.push({
      label: w.lastClean,
      value: [area !== null ? `${area} m²` : null, minutes !== null ? `${minutes} min` : null]
        .filter(Boolean)
        .join(' · '),
    });
  }
  const [worst] = wearOf(view);
  if (worst) {
    items.push({
      label: fit(w.wear(t.consumables[worst.code]), 40),
      value: `${worst.left} %`,
      color: wearColor(worst.left),
    });
  }
  if (items.length > 0) {
    components.push({ type: 'status', items });
  }

  const params = { did: view.did };
  const state = gladysStateOf(view.props, view.newNumbering);
  const paused = state === VACUUM_CLEANER_STATE.PAUSED;
  const labels = {
    start: paused ? w.resume : w.clean,
    pause: w.pause,
    dock: w.dock,
    locate: w.locate,
  };
  for (const [key, button] of Object.entries(ROBOT_BUTTONS)) {
    components.push(actionButton(labels[key], key, params, button.icon));
  }
  const running =
    state === VACUUM_CLEANER_STATE.RUNNING || state === VACUUM_CLEANER_STATE.RETURNING_TO_DOCK;
  // A minute while the robot moves (the map follows it), ten otherwise.
  return { version: 1, ttl_seconds: running ? 60 : 600, components };
}

function normalizeName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The buttons of the "quick_clean" widget: the names given in its settings,
 * each matched against the shortcuts, the rooms (in both languages), several
 * rooms joined by "+" or ",", and "clean the selection"; without any name, the
 * shortcuts of the app.
 * @param {object} view the robot, see robotContent() (+ `rooms`, `shortcuts`,
 *   `picks`)
 * @param {object} settings the widget settings
 * @param {string} language `fr` or `en`
 * @returns {{ buttons: Array<object>, unknown: Array<string> }} the buttons
 *   (`{ label, params }`, params carrying `kind`: `shortcut` with `id`, `rooms`
 *   with `rooms`, or `selection`) and the names matched to nothing
 */
export function quickButtons(view, settings, language) {
  const w = texts(language).widget;
  const names = QUICK_BUTTON_SETTINGS.map((key) => settings && settings[key])
    .filter((name) => typeof name === 'string' && name.trim())
    .map((name) => name.trim());
  const shortcuts = view.shortcuts || [];
  const button = (label, extra) => ({ label, params: { did: view.did, ...extra } });
  if (names.length === 0) {
    return {
      buttons: shortcuts
        .slice(0, MAX_BUTTONS)
        .map((shortcut) => button(shortcut.name, { kind: 'shortcut', id: shortcut.id })),
      unknown: [],
    };
  }
  const rooms = new Map();
  for (const lang of ['fr', 'en']) {
    for (const room of namedRooms(view.rooms || [], lang)) {
      rooms.set(normalizeName(room.name), room);
    }
  }
  const selection = new Set(
    ['fr', 'en']
      .flatMap((lang) => [texts(lang).widget.cleanSelection, texts(lang).widget.selection])
      .map(normalizeName),
  );
  const buttons = [];
  const unknown = [];
  for (const name of names) {
    const key = normalizeName(name);
    const shortcut = shortcuts.find((candidate) => normalizeName(candidate.name) === key);
    const parts = name.split(ROOM_SEPARATOR).map(normalizeName).filter(Boolean);
    if (shortcut) {
      buttons.push(button(name, { kind: 'shortcut', id: shortcut.id }));
    } else if (selection.has(key)) {
      buttons.push(button(w.cleanSelection, { kind: 'selection' }));
    } else if (parts.length > 0 && parts.every((part) => rooms.has(part))) {
      const ids = [...new Set(parts.map((part) => rooms.get(part).id))];
      buttons.push(button(name, { kind: 'rooms', rooms: ids }));
    } else {
      unknown.push(name);
    }
  }
  return { buttons, unknown };
}

/**
 * The "quick_clean" widget.
 * @param {object} view the robot, see quickButtons()
 * @param {object} settings the widget settings
 * @param {string} language `fr` or `en`
 * @returns {object} the widget content
 */
export function quickContent(view, settings, language) {
  const w = texts(language).widget;
  const components = [header(view, language)];
  const { buttons, unknown } = quickButtons(view, settings, language);
  const picked = namedRooms(view.rooms || [], language).filter((room) =>
    (view.picks || new Set()).has(String(room.id)),
  );
  if (picked.length > 0 && buttons.some((entry) => entry.params.kind === 'selection')) {
    components.push({
      type: 'status',
      items: [{ label: w.selection, value: fit(picked.map((room) => room.name).join(', '), 40) }],
    });
  }
  if (unknown.length > 0) {
    components.push({ type: 'text', text: fit(w.unknownNames(unknown.join(', ')), 300) });
  } else if (buttons.length === 0) {
    components.push({ type: 'text', text: fit(w.noButton, 300) });
  }
  buttons.forEach((entry, index) => {
    // Numbered keys: Gladys drops a button whose key another one uses.
    components.push(
      actionButton(
        entry.label,
        `quick_${index + 1}`,
        entry.params,
        isUnderWay(view, entry.params) ? CURRENT_ICON : null,
      ),
    );
  });
  return { version: 1, ttl_seconds: 300, components };
}

/**
 * The key of a task a button starts, to tell when it is the one under way.
 * @param {object} params the button params (`kind`, `id` or `rooms`)
 * @returns {string|null} the key
 */
export function taskKey(params) {
  if (params.kind === 'shortcut') {
    return `shortcut:${Number(params.id)}`;
  }
  if (params.kind === 'rooms') {
    return `rooms:${[...params.rooms]
      .map(Number)
      .sort((a, b) => a - b)
      .join(',')}`;
  }
  return params.kind === 'selection' ? 'selection' : null;
}

/**
 * The key of the task a feature command starts (see taskKey()), from Gladys
 * or from a widget.
 * @param {string} code the feature code
 * @param {*} value the value
 * @returns {string|null} the key, null for a command that starts no such task
 */
export function launchKeyOf(code, value) {
  if (code.startsWith(FEATURE_CODES.SHORTCUT_PREFIX) && Number(value) === 1) {
    return taskKey({ kind: 'shortcut', id: code.slice(FEATURE_CODES.SHORTCUT_PREFIX.length) });
  }
  if (code === FEATURE_CODES.ROOM && value !== ROOM_SELECTION_NONE) {
    return taskKey({ kind: 'rooms', rooms: [value] });
  }
  if (code === FEATURE_CODES.CLEAN_ROOMS && Number(value) === 1) {
    return taskKey({ kind: 'selection' });
  }
  return null;
}

/**
 * Whether the task a quick button starts is the one under way: a shortcut the
 * robot says it runs, or the rooms last sent while the robot cleans rooms.
 * @param {object} view the robot (`props`, `shortcuts`, `lastLaunch`)
 * @param {object} params the button params
 * @returns {boolean} true while that task runs
 */
export function isUnderWay(view, params) {
  const launched = view.lastLaunch === taskKey(params);
  if (params.kind === 'shortcut') {
    const shortcut = (view.shortcuts || []).find((item) => item.id === Number(params.id));
    if (shortcut && shortcut.running) {
      return true;
    }
    return (
      launched &&
      Number(view.props.get(PROP.STATUS)) === DREAME_STATUS.SHORTCUT &&
      hasTask(view.props)
    );
  }
  return launched && isRoomCleaning(view.props);
}

/**
 * The choices of one setting, for the robot_setting widget.
 * @param {object} view the robot, see robotContent()
 * @param {string} setting a SETTINGS key
 * @param {string} language `fr` or `en`
 * @returns {{ caption: string, choices: Array<object> }|null} the current value
 *   in words and the buttons (`{ label, value, active }`), null when the robot
 *   has no such setting
 */
export function settingChoices(view, setting, language) {
  const t = texts(language);
  const w = t.widget;
  const { props, mopping } = view;
  const mode = mopping ? cleaningModeOf(props, mopping) : null;
  // The mop settings mean nothing to a robot that only vacuums.
  const vacuumOnly = mode === 'sweeping' ? ` · ${w.noEffectVacuum}` : '';
  if (setting === 'cleaning_mode') {
    if (!mopping || !mopping.cleaningMode) {
      return null;
    }
    const modes = CLEANING_MODES.filter(
      (entry) =>
        (entry.value !== 'mopping-after-sweeping' || mopping.afterSweeping) &&
        (entry.value !== 'custom' || mopping.custom),
    ).slice(0, MAX_BUTTONS);
    return {
      caption: mode ? t.cleaningModes[mode] : '—',
      choices: modes.map((entry) => ({
        label: w.shortModes[entry.value],
        value: entry.value,
        active: entry.value === mode,
      })),
    };
  }
  if (setting === 'suction') {
    const current = SUCTION_LEVELS.find(
      (level) => level.code === toNumber(props.get(PROP.SUCTION_LEVEL)),
    );
    if (!props.has(PROP.SUCTION_LEVEL)) {
      return null;
    }
    const boost = maxSuctionOf(props) === 1 ? ` · ${w.maxSuctionOn}` : '';
    return {
      caption: `${current ? t.suctions[current.value] : '—'}${boost}`,
      choices: SUCTION_LEVELS.map((level) => ({
        label: t.suctions[level.value],
        value: level.value,
        active: level === current,
      })),
    };
  }
  if (setting === 'max_suction') {
    const current = maxSuctionOf(props);
    if (current === null) {
      return null;
    }
    return {
      caption: current === 1 ? w.on : w.off,
      choices: [
        { label: w.off, value: 0, active: current === 0 },
        { label: w.on, value: 1, active: current === 1 },
      ],
    };
  }
  if (setting === 'route') {
    const current = routeOf(props);
    if (!current) {
      return null;
    }
    // As in the app: a mode that vacuums only offers the quick and standard
    // routes.
    const routes = ROUTES.filter((route) => !mopping || routeAllowed(route.code, mode, mopping));
    return {
      caption: t.routes[current.value],
      choices: routes.map((route) => ({
        label: t.routes[route.value],
        value: route.value,
        active: route === current,
      })),
    };
  }
  if (setting === 'wetness') {
    const current = toNumber(props.get(PROP.WETNESS_LEVEL));
    if (!mopping || !mopping.wetness) {
      return null;
    }
    const zone = current === null ? null : WETNESS_PRESETS.find((preset) => current <= preset.upTo);
    return {
      caption: `${current === null ? '—' : `${current} / 32`}${vacuumOnly}`,
      choices: WETNESS_PRESETS.map((preset) => ({
        label: w.wetnessLevels[preset.value],
        value: preset.value,
        active: preset === zone,
      })),
    };
  }
  if (setting === 'wash_frequency') {
    if (!mopping || !mopping.washFrequency) {
      return null;
    }
    const current = washFrequencyOf(props);
    const wash = washValueOf(props);
    let caption = '—';
    if (current && current.value === 'by-area') {
      caption = w.everyArea(wash);
    } else if (current && current.value === 'by-time') {
      caption = w.everyTime(wash);
    } else if (current) {
      caption = w.afterEachRoom;
    }
    return {
      caption: `${caption}${vacuumOnly}`,
      choices: WASH_FREQUENCIES.map((frequency) => ({
        label: t.washFrequencies[frequency.value],
        value: frequency.value,
        active: frequency === current,
      })),
    };
  }
  return null;
}

/**
 * The "robot_setting" widget: one setting, its choices as buttons, the current
 * one lit.
 * @param {object} view the robot, see robotContent()
 * @param {object} settings the widget settings (`setting`: a SETTINGS key)
 * @param {string} language `fr` or `en`
 * @returns {object} the widget content
 */
export function settingContent(view, settings, language) {
  const w = texts(language).widget;
  const setting = SETTINGS[settings && settings.setting] ? settings.setting : DEFAULT_SETTING;
  const components = [heading(`${view.name} · ${w.settingNames[setting]}`)];
  const choices = settingChoices(view, setting, language);
  if (!choices) {
    components.push({ type: 'text', text: w.settingMissing });
    return { version: 1, ttl_seconds: 3600, components };
  }
  components.push({ type: 'text', variant: 'caption', text: fit(choices.caption, 80) });
  choices.choices.slice(0, MAX_BUTTONS).forEach((choice, index) => {
    components.push(
      actionButton(
        choice.label,
        `choice_${index + 1}`,
        { did: view.did, kind: 'set', code: SETTINGS[setting], value: choice.value },
        choice.active ? CURRENT_ICON : 'circle',
      ),
    );
  });
  return { version: 1, ttl_seconds: 300, components };
}

/**
 * What a widget button stands for: a feature command, or a clean of rooms.
 * @param {string} actionKey the key of the button
 * @param {object} params its params (as the widget content declared them)
 * @returns {{ code: string, value: * }|{ rooms: Array<number> }|null} the
 *   command, null for an unknown button
 */
export function widgetCommand(actionKey, params = {}) {
  if (ROBOT_BUTTONS[actionKey]) {
    const { code, value } = ROBOT_BUTTONS[actionKey];
    return { code, value };
  }
  if (params.kind === 'shortcut' && Number.isSafeInteger(Number(params.id))) {
    return { code: `${FEATURE_CODES.SHORTCUT_PREFIX}${Number(params.id)}`, value: 1 };
  }
  if (params.kind === 'rooms' && Array.isArray(params.rooms) && params.rooms.length > 0) {
    return { rooms: params.rooms.map(Number) };
  }
  if (params.kind === 'selection') {
    return { code: FEATURE_CODES.CLEAN_ROOMS, value: 1 };
  }
  if (params.kind === 'set' && Object.values(SETTINGS).includes(params.code)) {
    return { code: params.code, value: params.value };
  }
  return null;
}

/**
 * The message shown once a widget button did its job.
 * @param {string} actionKey the key of the button
 * @param {object} params its params
 * @param {object} robot the robot (`shortcuts`, `rooms`)
 * @param {string} language `fr` or `en`
 * @returns {string} the message
 */
export function widgetMessage(actionKey, params, robot, language) {
  const t = texts(language);
  const done = t.widget.done;
  if (ROBOT_BUTTONS[actionKey]) {
    return done[actionKey];
  }
  if (params.kind === 'shortcut') {
    const shortcut = (robot.shortcuts || []).find((item) => String(item.id) === String(params.id));
    return done.shortcut(shortcut ? shortcut.name : params.id);
  }
  if (params.kind === 'rooms') {
    const names = namedRooms(robot.rooms || [], language);
    const label = params.rooms
      .map((id) => (names.find((room) => String(room.id) === String(id)) || { name: id }).name)
      .join(', ');
    return done.room(label);
  }
  if (params.kind === 'selection') {
    return done.selection;
  }
  const setting = Object.keys(SETTINGS).find((key) => SETTINGS[key] === params.code);
  return done.setting(t.widget.settingNames[setting], choiceLabel(setting, params.value, language));
}

function choiceLabel(setting, value, language) {
  const t = texts(language);
  const w = t.widget;
  if (setting === 'cleaning_mode') {
    return t.cleaningModes[value] || value;
  }
  if (setting === 'suction') {
    return t.suctions[value] || value;
  }
  if (setting === 'max_suction') {
    return Number(value) === 1 ? w.on : w.off;
  }
  if (setting === 'route') {
    return t.routes[value] || value;
  }
  if (setting === 'wetness') {
    return w.wetnessLevels[value] || String(value);
  }
  return t.washFrequencies[value] || value;
}

/**
 * The "maintenance" widget: the three most worn parts as gauges, then every
 * part, the most worn first.
 * @param {object} view the robot, see robotContent()
 * @param {string} language `fr` or `en`
 * @returns {object} the widget content
 */
export function maintenanceContent(view, language) {
  const t = texts(language);
  const w = t.widget;
  const wear = wearOf(view);
  const components = [heading(`${w.maintenance} · ${view.name}`)];
  if (wear.length === 0) {
    components.push({ type: 'text', text: w.noConsumable });
    return { version: 1, ttl_seconds: 3600, components };
  }
  const worn = wear.filter((part) => part.left <= WORN).length;
  const wearing = wear.filter((part) => part.left > WORN && part.left <= WEARING).length;
  let summary = w.allGood;
  if (worn > 0) {
    summary = w.toReplace(worn);
  } else if (wearing > 0) {
    summary = w.soon(wearing);
  }
  components.push({ type: 'text', variant: 'caption', text: summary });
  for (const part of wear.slice(0, 3)) {
    const code = `${FEATURE_CODES.CONSUMABLE_PREFIX}${part.code}`;
    const label = fit(t.consumables[part.code], 24);
    components.push(
      view.features && view.features.has(view.ids.feature(code))
        ? {
            type: 'gauge',
            label,
            color: wearColor(part.left),
            device_feature: view.ids.feature(code),
          }
        : {
            type: 'gauge',
            label,
            color: wearColor(part.left),
            value: part.left,
            min: 0,
            max: 100,
            unit: '%',
          },
    );
  }
  components.push({
    type: 'status',
    items: wear.slice(0, 10).map((part) => ({
      label: fit(t.consumables[part.code], 40),
      value: `${part.left} %`,
      color: wearColor(part.left),
    })),
  });
  return { version: 1, ttl_seconds: 3600, components };
}
