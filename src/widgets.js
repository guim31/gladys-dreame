// -----------------------------------------------------------------------------
// Dashboard widgets (Gladys 5.1+), content builders — pure functions.
//
//   - robot        : one robot at a glance: state, battery, the map of the
//                    home, its settings and last clean, the four everyday
//                    buttons;
//   - quick_clean  : up to four buttons, each a shortcut of the app or a room
//                    (named in the widget settings), for a wall tablet;
//   - maintenance  : the wear of each part, the most worn first.
//
// A widget shows the robot picked in its settings, else the first one. The
// buttons are widget actions (see ACTIONS), carrying the robot id: they work
// whether or not the robot was added to Gladys. The battery and the wear
// gauges are bound to the device features when the robot was added, so they
// follow its states live. The map is an image served by the integration
// (onWidgetGetImage); its key changes with its bytes.
//
// Gladys renders at most 8 components, 2 of them texts: the name and the state
// share the heading, and the details go in the status list.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';

import {
  CONSUMABLES,
  FEATURE_CODES,
  PROP,
  SUCTION_LEVELS,
  VACUUM_CLEANER_STATE,
} from './constants.js';
import { gladysStateOf, maxSuctionOf, normalizeState, routeOf } from './devices/vacuum.js';
import { namedRooms } from './dreame/map.js';
import { cleaningModeOf } from './dreame/mopping.js';
import { describeError, texts } from './i18n.js';

/** Widget keys, declared in the manifest `widgets` (forever: never rename). */
export const WIDGET = {
  ROBOT: 'robot',
  QUICK_CLEAN: 'quick_clean',
  MAINTENANCE: 'maintenance',
};

/** Widget action keys, and the feature command each one stands for. */
export const ACTIONS = {
  start: { code: FEATURE_CODES.RUN_MODE, value: 1 },
  pause: { code: FEATURE_CODES.PAUSE, value: 1 },
  dock: { code: FEATURE_CODES.DOCK, value: 1 },
  locate: { code: FEATURE_CODES.LOCATE, value: 1 },
  shortcut: { code: null, value: 1 }, // shortcut-<params.id>
  clean_room: { code: FEATURE_CODES.ROOM, value: null }, // params.room
  clean_selection: { code: FEATURE_CODES.CLEAN_ROOMS, value: 1 },
};

// The widget settings naming the quick buttons.
export const QUICK_BUTTON_SETTINGS = ['button_1', 'button_2', 'button_3', 'button_4'];

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

function header(view, language) {
  const state = stateText(view, language);
  return {
    type: 'text',
    variant: 'heading',
    text: fit(state ? `${view.name} · ${state}` : view.name, 40),
  };
}

/**
 * A widget with nothing to show but a sentence.
 * @param {string} text the sentence
 * @returns {object} the content
 */
export function messageContent(text) {
  return { version: 1, ttl_seconds: 300, components: [{ type: 'text', text: fit(text, 300) }] };
}

function actionButton(label, key, params, style) {
  return {
    type: 'button',
    label: fit(label, 24),
    ...(style ? { style } : {}),
    action: { key, params },
  };
}

function wearOf(view) {
  return CONSUMABLES.map((consumable) => ({
    ...consumable,
    left: toNumber(view.props.get(consumable.prop)),
  }))
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
  const area = toNumber(view.props.get(PROP.CLEANED_AREA));
  const minutes = toNumber(view.props.get(PROP.CLEANING_TIME));
  if (area !== null || minutes !== null) {
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
  components.push(
    actionButton(paused ? w.resume : w.clean, 'start', params, 'primary'),
    actionButton(w.pause, 'pause', params),
    actionButton(w.dock, 'dock', params),
    actionButton(w.locate, 'locate', params),
  );
  const running =
    state === VACUUM_CLEANER_STATE.RUNNING || state === VACUUM_CLEANER_STATE.RETURNING_TO_DOCK;
  // A minute while the robot moves (the map follows it), ten otherwise.
  return { version: 1, ttl_seconds: running ? 60 : 600, components };
}

function normalizeName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The buttons of the "quick_clean" widget: the names given in its settings,
 * each matched against the shortcuts, the rooms (in both languages) and "clean
 * the selection"; without any name, the shortcuts of the app.
 * @param {object} view the robot, see robotContent() (+ `rooms`, `shortcuts`,
 *   `picks`)
 * @param {object} settings the widget settings
 * @param {string} language `fr` or `en`
 * @returns {{ buttons: Array<object>, unknown: Array<string> }} the buttons
 *   (`{ label, action, params }`) and the names matched to nothing
 */
export function quickButtons(view, settings, language) {
  const w = texts(language).widget;
  const params = (extra) => ({ did: view.did, ...extra });
  const names = QUICK_BUTTON_SETTINGS.map((key) => settings && settings[key])
    .filter((name) => typeof name === 'string' && name.trim())
    .map((name) => name.trim());
  const shortcuts = view.shortcuts || [];
  if (names.length === 0) {
    return {
      buttons: shortcuts.slice(0, 4).map((shortcut) => ({
        label: shortcut.name,
        action: 'shortcut',
        params: params({ id: shortcut.id }),
      })),
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
    if (shortcut) {
      buttons.push({ label: name, action: 'shortcut', params: params({ id: shortcut.id }) });
    } else if (rooms.has(key)) {
      buttons.push({
        label: name,
        action: 'clean_room',
        params: params({ room: rooms.get(key).id }),
      });
    } else if (selection.has(key)) {
      buttons.push({ label: w.cleanSelection, action: 'clean_selection', params: params() });
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
  if (picked.length > 0 && buttons.some((button) => button.action === 'clean_selection')) {
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
  buttons.forEach((button, index) => {
    components.push(
      actionButton(button.label, button.action, button.params, index === 0 ? 'primary' : null),
    );
  });
  return { version: 1, ttl_seconds: 300, components };
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
  const components = [
    { type: 'text', variant: 'heading', text: fit(`${w.maintenance} · ${view.name}`, 40) },
  ];
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
