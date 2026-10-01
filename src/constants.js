// -----------------------------------------------------------------------------
// Dreame protocol constants + the few Gladys values the SDK does not export.
//
// The standard Gladys feature categories / types / units come straight from the
// SDK (DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES, DEVICE_FEATURE_UNITS):
// only the integration-specific values live here.
//
// A Dreame robot is a MIoT device: every value is a property addressed by a
// service id and a property id (`siid.piid`), every command an action addressed
// by a service id and an action id (`siid.aiid`). The ids below are the ones
// reverse-engineered by the Home Assistant integration Tasshack/dreame-vacuum
// (MIT), which serves the same Dreamehome cloud; they are shared by the whole
// range, the properties a model lacks simply answer with an error code.
// -----------------------------------------------------------------------------

// --- Gladys enums (mirror of server/utils/constants.js) ----------------------

// Operational state of the vacuum (vacuum-cleaner / state feature).
export const VACUUM_CLEANER_STATE = {
  STOPPED: 0,
  RUNNING: 1,
  PAUSED: 2,
  ERROR: 3,
  RETURNING_TO_DOCK: 4,
  CHARGING: 5,
  DOCKED: 6,
};

// Run mode of the vacuum (vacuum-cleaner / run-mode feature).
export const VACUUM_CLEANER_MODE = {
  IDLE: 0,
  CLEANING: 1,
  MAPPING: 2,
};

// Clean mode of the vacuum (vacuum-cleaner / clean-mode feature).
export const VACUUM_CLEANER_CLEAN_MODE = {
  AUTO: 0,
  QUICK: 1,
  QUIET: 2,
  LOW_NOISE: 3,
  DEEP_CLEAN: 4,
  VACUUM: 5,
  MOP: 6,
};

// Gladys only queues a device for polling when `should_poll` is true AND
// `poll_frequency` is one of its DEVICE_POLL_FREQUENCIES (milliseconds). The
// robot pushes its changes over MQTT: this poll is the safety net, not the
// main path.
export const POLL_FREQUENCY = 60 * 1000;

// --- Dreamehome cloud ---------------------------------------------------------

// Regions of the Dreamehome cloud, in the order the account form lists them.
// A region is where the ACCOUNT lives (chosen in the app from the country at
// sign-up), not where the robot is. The cloud answers "username or password
// error" alike for an unknown account and a wrong password, so the region
// cannot be guessed from the error: the user picks it, Europe by default.
export const DREAME_REGIONS = ['eu', 'us', 'cn', 'ru', 'sg', 'kr'];
export const DEFAULT_REGION = 'eu';

export const DREAME_CLOUD = {
  HOST_SUFFIX: '.iot.dreame.tech',
  PORT: 13267,
  // Identity of the Dreamehome iOS app, the one the cloud expects.
  USER_AGENT: 'Dreame_Smarthome/2.1.9 (iPhone; iOS 18.4.1; Scale/3.00)',
  // OAuth client of the app ("dreame_appv1"), public: it ships in every copy.
  CLIENT_AUTHORIZATION: 'Basic ZHJlYW1lX2FwcHYxOkFQXmR2QHpAU1FZVnhOODg=',
  DEFAULT_TENANT_ID: '000000',
  // The password never travels in clear: the app sends md5(password + salt).
  PASSWORD_SALT: 'RAylYC%fmSKp7%Tq',
  // Only the Chinese region requires it.
  CN_RLC_HEADER: '1c80b3787b2266776bcdc481f37d8fa42ba10a30af81a6df-1',
  TOKEN_PATH: '/dreame-auth/oauth/token',
  DEVICE_LIST_PATH: '/dreame-user-iot/iotuserbind/device/listV2',
  FILE_URL_PATH: '/dreame-user-iot/iotfile/getDownloadUrl',
  // The command endpoint is routed to the robot's own IoT node:
  // `/dreame-iot-com-<node>/device/sendCommand`, <node> being the first label
  // of the device `bindDomain` (e.g. 10000 for 10000.mt.eu.iot.dreame.tech).
  COMMAND_PREFIX: '/dreame-iot-com',
  COMMAND_SUFFIX: '/device/sendCommand',
  // Renew the access token that long before it expires.
  TOKEN_EXPIRY_MARGIN_MS: 2 * 60 * 1000,
  REQUEST_TIMEOUT_MS: 15 * 1000,
  // get_properties answers at most this many properties per request.
  MAX_PROPERTIES_PER_REQUEST: 15,
};

export const DREAME_MQTT = {
  // Fixed by the cloud; the broker presents a certificate that does not
  // match its host name, so it is not verified (same as the official app and
  // the Home Assistant integration). The payload is not a secret the robot
  // does not already publish, and the credentials are a short-lived token.
  PROTOCOL: process.env.DREAME_MQTT_PROTOCOL || 'mqtts',
  KEEPALIVE_SECONDS: 60,
  // First reconnection delay, doubled after each failed attempt up to the max.
  RECONNECT_PERIOD_MS: 10 * 1000,
  RECONNECT_MAX_MS: 5 * 60 * 1000,
  CONNECT_TIMEOUT_MS: 15 * 1000,
  // A refused token is renewed at most that often: a broker refusing for
  // another reason must not make the integration hammer the login endpoint.
  MIN_RENEWAL_INTERVAL_MS: 5 * 60 * 1000,
};

// --- MIoT properties -------------------------------------------------------------

// `siid.piid` keys. Only the ones the integration reads are listed.
export const PROP = {
  STATE: '2.1',
  ERROR: '2.2',
  BATTERY: '3.1',
  CHARGING_STATUS: '3.2',
  STATUS: '4.1',
  // The current (or last) clean: minutes, square metres.
  CLEANING_TIME: '4.2',
  CLEANED_AREA: '4.3',
  SUCTION_LEVEL: '4.4',
  WATER_VOLUME: '4.5',
  WATER_TANK: '4.6',
  TASK_STATUS: '4.7',
  CLEANING_PAUSED: '4.17',
  // On the robots with a self-washing base, a grouped value: the cleaning
  // mode, the mop washing frequency and the water level (see dreame/mopping.js).
  CLEANING_MODE: '4.23',
  SELF_WASH_BASE_STATUS: '4.25',
  // The app's "customize room cleaning": each room its own settings.
  CUSTOMIZED_CLEANING: '4.26',
  SHORTCUTS: '4.48',
  // The app's switchable settings, a JSON list of { k, v }; a push may carry a
  // single { k, v } object, and a write sets one key.
  AUTO_SWITCH: '4.50',
  MAP_LIST: '6.8',
  // The mop wetness of the recent robots, 1 (slightly dry) to 32 (wet).
  WETNESS_LEVEL: '28.1',
};

// Consumables, as the remaining life in percent. The robot reports a pair per
// part (hours left + percent left) in the same service: only the percent is
// used. The order is the order of the Gladys features.
// A robot may answer for a part it does not have (the wheels of a
// dreame.vacuum.r2449a, at 0 %): for a model the table knows, a part flagged
// `needs` is only kept when the model has that capability, a part flagged
// `unless` is dropped when it has that one — as the Home Assistant integration
// decides which parts to show.
export const CONSUMABLES = [
  { code: 'main-brush', prop: '9.2' },
  { code: 'side-brush', prop: '10.2' },
  { code: 'filter', prop: '11.1' },
  { code: 'sensor', prop: '16.1', unless: 'disableSensorCleaning' },
  { code: 'mop-pad', prop: '18.1', unless: 'disableMopConsumable' },
  { code: 'tank-filter', prop: '17.1' },
  { code: 'silver-ion', prop: '19.2' },
  { code: 'detergent', prop: '20.1', unless: 'noDetergent' },
  { code: 'squeegee', prop: '24.1', needs: 'squeegee' },
  { code: 'dirty-water-channel', prop: '25.2' },
  { code: 'onboard-dirty-water-tank', prop: '26.2', needs: 'onboardDirtyWaterTank' },
  { code: 'deodorizer', prop: '29.2', needs: 'deodorizer' },
  { code: 'wheel', prop: '30.2', needs: 'wheel' },
  { code: 'scale-inhibitor', prop: '31.2', needs: 'scaleInhibitor' },
  { code: 'fluffing-roller', prop: '32.1', needs: 'fluffingRoller' },
  { code: 'roller-mop-filter', prop: '33.2', needs: 'rollerMopFilter' },
  { code: 'water-outlet-filter', prop: '35.2', needs: 'waterOutletFilter' },
  { code: 'track-cleaning', prop: '36.2' },
  { code: 'washboard-cleaning', prop: '37.2' },
  { code: 'filter-cleaning', prop: '38.2' },
];

// Everything the integration reads from a robot. Probed once at discovery
// (a property the model lacks answers with a non-zero code), then polled.
export const STATUS_PROPERTIES = [
  PROP.STATE,
  PROP.ERROR,
  PROP.BATTERY,
  PROP.CHARGING_STATUS,
  PROP.STATUS,
  PROP.CLEANING_TIME,
  PROP.CLEANED_AREA,
  PROP.SUCTION_LEVEL,
  PROP.WATER_VOLUME,
  PROP.TASK_STATUS,
  PROP.CLEANING_PAUSED,
  PROP.CLEANING_MODE,
  PROP.SELF_WASH_BASE_STATUS,
  PROP.CUSTOMIZED_CLEANING,
  PROP.AUTO_SWITCH,
  PROP.WETNESS_LEVEL,
];
export const DISCOVERY_PROPERTIES = [
  ...STATUS_PROPERTIES,
  PROP.SHORTCUTS,
  ...CONSUMABLES.map((consumable) => consumable.prop),
];

// --- MIoT actions ----------------------------------------------------------------

export const ACTION = {
  START: [2, 1], // start, or resume a paused task
  PAUSE: [2, 2],
  CHARGE: [3, 1], // back to the dock
  START_CUSTOM: [4, 1], // start a task described by its parameters
  STOP: [4, 2],
  REQUEST_MAP: [6, 1],
  LOCATE: [7, 1],
};

// Parameters of START_CUSTOM: piid 1 carries the task kind (a
// DREAME_STATUS value), piid 10 its JSON description.
export const START_CUSTOM_PIID = { STATUS: 1, PARAMETERS: 10 };
// Parameter of REQUEST_MAP, and the pieces of its answer.
export const MAP_PIID = { MAP_DATA: 1, FRAME_INFO: 2, OBJECT_NAME: 3, OLD_MAP_DATA: 13 };

// --- Dreame enums ------------------------------------------------------------------

// STATE (2.1), current firmwares. Values past 18 were renumbered: models
// without the "new state" capability still send the old ones (see below).
export const DREAME_STATE = {
  SWEEPING: 1,
  IDLE: 2,
  PAUSED: 3,
  ERROR: 4,
  RETURNING: 5,
  CHARGING: 6,
  MOPPING: 7,
  DRYING: 8,
  WASHING: 9,
  RETURNING_TO_WASH: 10,
  BUILDING: 11,
  SWEEPING_AND_MOPPING: 12,
  CHARGING_COMPLETED: 13,
  UPGRADING: 14,
};

// Old numbering (values above 18) -> current numbering.
export const OLD_STATE_TO_NEW = {
  19: 23, // remote control
  20: 20, // clean + add water
  21: 98, // monitoring
  23: 21, // washing paused
  24: 22, // auto emptying
  25: 19, // water check
  26: 24, // smart charging
};

// Current numbering -> Gladys state. IDLE (2) is not listed: its meaning
// depends on the task and the charger (see devices/vacuum.js).
export const DREAME_STATE_TO_GLADYS = {
  1: VACUUM_CLEANER_STATE.RUNNING, // sweeping
  3: VACUUM_CLEANER_STATE.PAUSED, // paused
  4: VACUUM_CLEANER_STATE.ERROR, // error
  5: VACUUM_CLEANER_STATE.RETURNING_TO_DOCK, // returning
  6: VACUUM_CLEANER_STATE.CHARGING, // charging
  7: VACUUM_CLEANER_STATE.RUNNING, // mopping
  8: VACUUM_CLEANER_STATE.DOCKED, // drying the mops
  9: VACUUM_CLEANER_STATE.DOCKED, // washing the mops
  10: VACUUM_CLEANER_STATE.RETURNING_TO_DOCK, // returning to wash
  11: VACUUM_CLEANER_STATE.RUNNING, // building a map
  12: VACUUM_CLEANER_STATE.RUNNING, // sweeping and mopping
  13: VACUUM_CLEANER_STATE.DOCKED, // charging completed
  14: VACUUM_CLEANER_STATE.STOPPED, // upgrading
  15: VACUUM_CLEANER_STATE.RUNNING, // clean summon
  16: VACUUM_CLEANER_STATE.DOCKED, // station reset
  17: VACUUM_CLEANER_STATE.RETURNING_TO_DOCK, // returning to install the mop
  18: VACUUM_CLEANER_STATE.RETURNING_TO_DOCK, // returning to remove the mop
  19: VACUUM_CLEANER_STATE.DOCKED, // water check
  20: VACUUM_CLEANER_STATE.DOCKED, // adding clean water
  21: VACUUM_CLEANER_STATE.PAUSED, // washing paused
  22: VACUUM_CLEANER_STATE.DOCKED, // auto emptying
  23: VACUUM_CLEANER_STATE.RUNNING, // remote control
  24: VACUUM_CLEANER_STATE.CHARGING, // smart charging
  25: VACUUM_CLEANER_STATE.RUNNING, // second cleaning
  26: VACUUM_CLEANER_STATE.RUNNING, // human following
  27: VACUUM_CLEANER_STATE.RUNNING, // spot cleaning
  28: VACUUM_CLEANER_STATE.RETURNING_TO_DOCK, // returning to auto empty
  29: VACUUM_CLEANER_STATE.STOPPED, // waiting for a task
  30: VACUUM_CLEANER_STATE.DOCKED, // station cleaning
  31: VACUUM_CLEANER_STATE.RETURNING_TO_DOCK, // returning to drain
  32: VACUUM_CLEANER_STATE.DOCKED, // draining
  33: VACUUM_CLEANER_STATE.DOCKED, // auto water draining
  34: VACUUM_CLEANER_STATE.DOCKED, // emptying
  35: VACUUM_CLEANER_STATE.DOCKED, // dust bag drying
  36: VACUUM_CLEANER_STATE.DOCKED, // dust bag drying paused
  37: VACUUM_CLEANER_STATE.RUNNING, // heading to extra cleaning
  38: VACUUM_CLEANER_STATE.RUNNING, // extra cleaning
  95: VACUUM_CLEANER_STATE.PAUSED, // finding pet, paused
  96: VACUUM_CLEANER_STATE.RUNNING, // finding pet
  97: VACUUM_CLEANER_STATE.RUNNING, // running a shortcut
  98: VACUUM_CLEANER_STATE.RUNNING, // monitoring
  99: VACUUM_CLEANER_STATE.PAUSED, // monitoring paused
  101: VACUUM_CLEANER_STATE.RUNNING, // initial deep cleaning
  102: VACUUM_CLEANER_STATE.PAUSED, // initial deep cleaning paused
  103: VACUUM_CLEANER_STATE.DOCKED, // sanitizing
  104: VACUUM_CLEANER_STATE.DOCKED, // sanitizing with dry
  105: VACUUM_CLEANER_STATE.DOCKED, // changing the mop
  106: VACUUM_CLEANER_STATE.PAUSED, // changing the mop, paused
  107: VACUUM_CLEANER_STATE.RUNNING, // floor maintaining
  108: VACUUM_CLEANER_STATE.PAUSED, // floor maintaining paused
  109: VACUUM_CLEANER_STATE.RUNNING, // remote pickup
  113: VACUUM_CLEANER_STATE.RUNNING, // arranging items
  114: VACUUM_CLEANER_STATE.RUNNING, // pet guarding
  115: VACUUM_CLEANER_STATE.PAUSED, // pet guarding paused
  116: VACUUM_CLEANER_STATE.DOCKED, // installing the mop
  117: VACUUM_CLEANER_STATE.DOCKED, // uninstalling the mop
  118: VACUUM_CLEANER_STATE.RETURNING_TO_DOCK, // going back to recharge mid-task
  120: VACUUM_CLEANER_STATE.RUNNING, // assisted cleaning
  121: VACUUM_CLEANER_STATE.RETURNING_TO_DOCK, // entering the dock
  122: VACUUM_CLEANER_STATE.RUNNING, // leaving the dock
  140: VACUUM_CLEANER_STATE.RUNNING, // stair climber: navigating to it
  141: VACUUM_CLEANER_STATE.RUNNING, // stair climber: docking onto it
  142: VACUUM_CLEANER_STATE.RUNNING, // stair climber: docked onto it
  143: VACUUM_CLEANER_STATE.RUNNING, // stair climber: navigating
  144: VACUUM_CLEANER_STATE.RUNNING, // stair climber: climbing
  145: VACUUM_CLEANER_STATE.RUNNING, // stair climber: climb completed
  146: VACUUM_CLEANER_STATE.RUNNING, // stair climber: at its dock
  147: VACUUM_CLEANER_STATE.RUNNING, // stair climber: leaving its dock
};

// Dreame states in which the robot is building a map.
export const DREAME_MAPPING_STATES = new Set([DREAME_STATE.BUILDING]);

// CHARGING_STATUS (3.2).
export const DREAME_CHARGING_STATUS = {
  CHARGING: 1,
  NOT_CHARGING: 2,
  CHARGING_COMPLETED: 3,
  RETURN_TO_CHARGE: 5,
};

// STATUS (4.1): the kind of task. Only the values the integration uses.
export const DREAME_STATUS = {
  IDLE: 0,
  PAUSED: 1,
  CLEANING: 2,
  BACK_HOME: 3,
  PARTIAL_CLEANING: 4,
  SEGMENT_CLEANING: 18,
  ZONE_CLEANING: 19,
  SPOT_CLEANING: 20,
  FAST_MAPPING: 21,
  CRUISING_PATH: 22,
  CRUISING_POINT: 23,
  SHORTCUT: 25,
};

// STATUS values meaning "a task is under way" (with TASK_STATUS below).
export const DREAME_TASK_STATUS_VALUES = new Set([
  DREAME_STATUS.CLEANING,
  DREAME_STATUS.PARTIAL_CLEANING,
  DREAME_STATUS.SEGMENT_CLEANING,
  DREAME_STATUS.ZONE_CLEANING,
  DREAME_STATUS.SPOT_CLEANING,
  DREAME_STATUS.FAST_MAPPING,
  DREAME_STATUS.CRUISING_PATH,
  DREAME_STATUS.CRUISING_POINT,
  DREAME_STATUS.SHORTCUT,
]);

// TASK_STATUS (4.7): 0 means no task. DOCKING_PAUSED (11) is not a task
// either: the robot was sent home and stopped on the way.
export const DREAME_TASK_COMPLETED = 0;
export const DREAME_TASK_DOCKING_PAUSED = 11;
// TASK_STATUS values of a paused task.
export const DREAME_PAUSED_TASKS = new Set([
  6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 23, 24, 31, 32, 33, 35, 42, 44,
]);

// Error codes (2.2) the app shows as a dismissible warning, not a fault:
// the robot keeps its normal state.
export const DREAME_WARNING_CODES = new Set([
  9, 10, 20, 47, 51, 56, 68, 70, 71, 72, 75, 82, 85, 107, 114, 117, 121, 122, 123, 129, 213, 214,
]);

// --- Suction level (4.4) <-> Gladys clean mode ------------------------------------
// Gladys exposes a fixed list of clean modes; Dreame exposes four suction
// levels. The mapping follows the other vacuum integrations of the store
// (Roborock, Xiaomi Home), which also carry the suction power on the clean
// mode, so a scene reads the same whatever the brand: the quietest level is
// Quiet, the standard one Auto, the stronger ones Deep clean then Vacuum.
export const SUCTION_TO_CLEAN_MODE = {
  0: VACUUM_CLEANER_CLEAN_MODE.QUIET, // Quiet
  1: VACUUM_CLEANER_CLEAN_MODE.AUTO, // Standard
  2: VACUUM_CLEANER_CLEAN_MODE.DEEP_CLEAN, // Strong
  3: VACUUM_CLEANER_CLEAN_MODE.VACUUM, // Turbo
};
export const CLEAN_MODE_TO_SUCTION = Object.fromEntries(
  Object.entries(SUCTION_TO_CLEAN_MODE).map(([suction, cleanMode]) => [cleanMode, Number(suction)]),
);

// --- Gladys feature codes -----------------------------------------------------------

// Last segment of the feature external ids (`ext:<selector>:vacuum:<did>:<code>`).
// Published codes are forever: a renamed code is a removed feature for every
// user who created the device.
export const FEATURE_CODES = {
  STATE: 'state',
  RUN_MODE: 'run-mode',
  CLEAN_MODE: 'clean-mode',
  DOCK: 'dock',
  PAUSE: 'pause',
  LOCATE: 'locate',
  BATTERY: 'battery',
  ERROR: 'error',
  ROOM: 'room',
  ROUTE: 'route',
  SUCTION: 'suction',
  MAX_SUCTION: 'max-suction',
  CLEANING_MODE: 'cleaning-mode',
  WETNESS: 'wetness',
  WASH_FREQUENCY: 'mop-wash-frequency',
  WASH_AREA: 'mop-wash-area',
  WASH_TIME: 'mop-wash-time',
  ROOM_PICK_PREFIX: 'room-pick-',
  CLEAN_ROOMS: 'clean-rooms',
  SHORTCUT_PREFIX: 'shortcut-',
  CONSUMABLE_PREFIX: 'consumable-',
};

export const BATTERY_BOUNDS = { MIN: 0, MAX: 100 };
export const CONSUMABLE_BOUNDS = { MIN: 0, MAX: 100 };
export const ROOM_SELECTION_NONE = 'none';

// A room clean repeats once, with the suction and water the robot is set to.
export const ROOM_CLEAN_REPEATS = 1;
// Water level sent with a room clean when the robot reports none.
export const DEFAULT_WATER_LEVEL = 2;

// --- Cleaning route (auto-switch setting `CleanRoute`) -----------------------------
// The "Quick / Standard / Intensive / Deep" choice of the app, on the robots
// that have it. Written one key at a time, like the app: the other settings of
// the list are left untouched.
export const ROUTE_SETTING = 'CleanRoute';
export const ROUTES = [
  { value: 'quick', code: 4 },
  { value: 'standard', code: 1 },
  { value: 'intensive', code: 2 },
  { value: 'deep', code: 3 },
];

// --- Suction level (4.4) as the app lists it -----------------------------------------
// A select with the app's own four levels, in its order: the Gladys clean mode
// list above cannot be renamed nor narrowed, and testers could not tell which
// of its seven entries did what. The clean mode stays understood as a command
// for the devices created before.
export const SUCTION_LEVELS = [
  { value: 'quiet', code: 0 },
  { value: 'standard', code: 1 },
  { value: 'strong', code: 2 },
  { value: 'turbo', code: 3 },
];

// --- Mop settings, as the app lists them ---------------------------------------------
// The cleaning mode, in the app's order. `code` is the mode as the Home
// Assistant integration numbers it; how a robot stores it depends on its
// generation (see dreame/mopping.js). `custom` is the app's "customize room
// cleaning" (4.26): each room is cleaned with its own settings.
export const CLEANING_MODES = [
  { value: 'sweeping', code: 0 },
  { value: 'mopping', code: 1 },
  { value: 'sweeping-and-mopping', code: 2 },
  { value: 'mopping-after-sweeping', code: 3 },
  { value: 'custom', code: null },
];

// When the robot goes back to its base to wash its mops (setting
// `BackWashType`): after an area, after a time, or after each room.
export const WASH_FREQUENCY_SETTING = 'BackWashType';
export const WASH_FREQUENCIES = [
  { value: 'by-area', code: 1 },
  { value: 'by-time', code: 2 },
  { value: 'by-room', code: 3 },
];

// "Max suction power" of the app: a boost for the next clean only.
export const MAX_SUCTION_SETTING = 'SuctionMax';

export const WETNESS_BOUNDS = { MIN: 1, MAX: 32 };
