// -----------------------------------------------------------------------------
// The "Diagnostic" action: what the integration sees of the account and of each
// robot, in a form a user can paste into a forum post or a GitHub issue.
//
// It is the main debugging tool of an integration written without the hardware:
// it reports the model and firmware, every property the robot answered with its
// raw value, the shortcuts and rooms found, and each step of the map download.
// Nothing identifying goes in: no email, no robot id, no MAC or IP address, no
// token, no room or shortcut name (only counts), and the fields of the device
// record by name only.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

import { DISCOVERY_PROPERTIES, PROP } from './constants.js';
import { gladysStateOf } from './devices/vacuum.js';
import {
  isKnownModel,
  mapIvFor,
  modelCapabilities,
  usesNewStateNumbering,
} from './dreame/models.js';
import { cleaningModeOf, moppingOf, splitGroup } from './dreame/mopping.js';
import { renderMap } from './dreame/render.js';
import { fetchMap } from './dreame/rooms.js';
import { parseSettings } from './dreame/settings.js';
import { parseShortcuts } from './dreame/shortcuts.js';
import { firmwareOf, isRobotVacuum } from './integration.js';
import { REGION_NAMES } from './messages.js';

const { version: VERSION } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

/**
 * Run the diagnostic.
 * @param {object} integration the DreameIntegration
 * @param {object} [options] what to look at
 * @param {string} [options.did] only this robot
 * @returns {Promise<string>} the report, plain text
 */
export async function runDiagnostic(integration, { did = null } = {}) {
  const lines = [`Dreame diagnostic (gladys-dreame ${VERSION}, Node ${process.version})`];
  const cloud = integration.cloud;
  if (!cloud) {
    lines.push('Account: not linked');
    return lines.join('\n');
  }
  lines.push(
    `Account: linked, region ${cloud.region} (${REGION_NAMES[cloud.region].en})` +
      (integration.authFailure ? `, session REFUSED (${integration.authFailure})` : ''),
  );

  let records;
  try {
    records = await cloud.listDevices();
  } catch (err) {
    lines.push(`Device list: FAILED (${err.message})`);
    return lines.join('\n');
  }
  const robots = records.filter(isRobotVacuum);
  const others = records.filter((record) => !isRobotVacuum(record));
  lines.push(
    `Devices on the account: ${records.length} (${robots.length} robot vacuum(s)` +
      (others.length ? `; ignored: ${others.map((record) => record.model).join(', ')}` : '') +
      ')',
  );

  let index = 0;
  for (const record of robots) {
    index += 1;
    if (did && String(record.did) !== did) {
      continue;
    }
    lines.push('', ...(await diagnoseRobot(integration, record, index)));
  }
  return lines.join('\n');
}

async function diagnoseRobot(integration, record, index) {
  const cloud = integration.cloud;
  const known = integration.robots.get(String(record.did));
  const robot = known || {
    did: String(record.did),
    model: String(record.model),
    bindDomain: record.bindDomain,
    masterUid: record.masterUid ? String(record.masterUid) : null,
  };
  const firmware = firmwareOf(record);
  const newNumbering = usesNewStateNumbering(record.model, firmware);
  const { guessed } = mapIvFor(record.model);
  const lines = [
    `Robot ${index}: ${record.model} (${isKnownModel(record.model) ? 'known model' : 'model unknown to the table'})`,
    `  Firmware: ${firmware || 'not in the device list'}; state numbering: ${newNumbering ? 'new' : 'old'}`,
    `  Device list fields: ${Object.keys(record).sort().join(', ')}`,
    `  Online (device list): ${record.online === undefined ? 'not given' : record.online}`,
  ];

  const channel = robot.channel;
  lines.push(
    channel
      ? `  Real-time channel: ${channel.connected ? 'connected' : 'NOT connected'}, ${channel.messages} message(s) received` +
          (channel.lastError ? `, last error: ${channel.lastError}` : '')
      : '  Real-time channel: not started',
  );

  let props;
  try {
    props = await cloud.getProperties(robot, DISCOVERY_PROPERTIES);
  } catch (err) {
    lines.push(`  Properties: FAILED (${err.message})`);
    return lines;
  }
  const answered = DISCOVERY_PROPERTIES.filter((key) => props.has(key));
  const values = answered
    .filter((key) => key !== PROP.SHORTCUTS && key !== PROP.AUTO_SWITCH)
    .map((key) => `${key}=${JSON.stringify(props.get(key))}`);
  lines.push(`  Properties answered: ${answered.length}/${DISCOVERY_PROPERTIES.length}`);
  lines.push(`  Values: ${values.join(' ')}`);
  lines.push(
    `  Missing: ${DISCOVERY_PROPERTIES.filter((key) => !props.has(key)).join(' ') || 'none'}`,
  );
  const settings = parseSettings(props.get(PROP.AUTO_SWITCH));
  lines.push(
    `  Settings (4.50): ${
      settings ? [...settings].map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ') : 'none'
    }`,
  );
  lines.push(`  Gladys state computed: ${gladysStateOf(props, newNumbering)}`);
  const caps = modelCapabilities(record.model, firmware);
  lines.push(
    `  Model capabilities: ${caps ? [...caps.flags].sort().join(' ') || 'none' : 'unknown'}`,
  );
  const mopping = moppingOf(caps, new Set(props.keys()), new Set(settings ? settings.keys() : []));
  const offered = [
    'cleaningMode',
    'custom',
    'wetness',
    'washFrequency',
    'washArea',
    'washTime',
  ].filter((name) => mopping[name]);
  const group = mopping.grouped ? splitGroup(props.get(PROP.CLEANING_MODE)) : null;
  lines.push(
    `  Mop settings: ${offered.join(' ') || 'none'}; cleaning mode ${cleaningModeOf(props, mopping) || '-'}` +
      (group ? ` (4.23 mode ${group.mode}, wash ${group.wash}, water ${group.water})` : ''),
  );
  lines.push(
    `  Shortcuts: ${props.has(PROP.SHORTCUTS) ? parseShortcuts(props.get(PROP.SHORTCUTS)).length : 'property absent'}`,
  );

  const trace = [];
  try {
    const map = await fetchMap(cloud, robot, {
      // Only a discovered robot has a real-time channel to push on.
      waitForPush: known ? (ms) => integration.waitForMapLocation(robot, ms) : null,
      trace,
    });
    const { rooms } = map;
    const types = rooms.map((room) => room.type).join(',');
    const named = rooms.filter((room) => room.customName).length;
    lines.push(`  Rooms: ${rooms.length} (types ${types || '-'}; ${named} with a custom name)`);
    const drawn = map.saved && !map.frame.data.seg_inf ? map.saved : map.frame;
    const image = renderMap(map, { mapV2: Boolean(caps && caps.flags.has('mapV2')) });
    lines.push(
      `  Map image: ${image ? `${image.width}x${image.height} px, ${Math.round(image.png.length / 1024)} KB` : 'empty map'}` +
        ` (drawn from the ${drawn === map.saved ? 'saved' : 'current'} map, cell ${drawn.gridSize} mm,` +
        ` fsm ${drawn.data.fsm ?? '-'}, ris ${drawn.data.ris ?? '-'}; robot ${map.frame.robot ? 'placed' : 'absent'},` +
        ` charger ${map.frame.charger || drawn.charger ? 'placed' : 'absent'})`,
    );
  } catch (err) {
    trace.push(`FAILED: ${err.message}`);
    lines.push('  Rooms: not read');
  }
  lines.push(`  Map IV: ${guessed ? 'guessed (model unknown to the table)' : 'known'}`);
  lines.push(...trace.map((step) => `  Map: ${step}`));
  return lines;
}
