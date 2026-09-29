// -----------------------------------------------------------------------------
// Entry point of the Gladys Dreame external integration.
//
//   - controls the robot vacuums of a DREAMEHOME app account, through the
//     Dreamehome cloud (the robots offer no local API);
//   - links the account once, from the email (or phone number) and password,
//     in the Actions box of the Configuration screen; only a fingerprint of
//     the password is kept, to reopen the session silently afterwards;
//   - publishes the robots as discovered devices (state, run mode, suction,
//     dock, battery, error, rooms, app shortcuts, consumables);
//   - publishes every change the robot pushes in real time, Gladys polling
//     only as a safety net; forwards the user commands to the robot;
//   - serves three dashboard widgets: the robot with its map, quick cleaning
//     buttons, and the wear of its parts.
//
// The Gladys supervisor provides GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN
// and GLADYS_INTEGRATION_SELECTOR: `new GladysIntegration()` reads them.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';

import { didOf } from './src/devices/convertDevice.js';
import { runDiagnostic } from './src/diagnostic.js';
import { DreameIntegration } from './src/integration.js';
import { WIDGET } from './src/widgets.js';

const gladys = new GladysIntegration();
const dreame = new DreameIntegration({ gladys, logger });

// --- Discovery: the user opened the Discovery screen -------------------------
// Scan requests are not acknowledged: a failure only shows in the logs.
gladys.onScanRequest(async () => {
  logger.info('Scan requested: reading the robots of the account');
  try {
    await dreame.discover();
  } catch (err) {
    logger.error(`Scan failed: ${err.message}`);
  }
});

// --- Devices ----------------------------------------------------------------
gladys.onPoll((device) => dreame.poll(device));
gladys.onSetValue((device, feature, value) => {
  logger.info(`Command ${feature.external_id} = ${value}`);
  return dreame.setValue(device, feature, value);
});
gladys.onDeviceCreated((device) => dreame.onDeviceCreated(device));

// --- Configuration screen ------------------------------------------------------
// The credentials travel with the action, right above its button: nothing to
// save first, and the password never lands in the configuration.
gladys.onAction('dreame_link', (fields) => dreame.link(fields));
gladys.onAction('dreame_unlink', () => dreame.unlink());
gladys.onAction('dreame_diagnostic', (fields) =>
  runDiagnostic(dreame, { did: didOf(gladys, fields && fields.device) }),
);
gladys.onConfigUpdated((config) => dreame.onConfigUpdated(config));

// --- Dashboard widgets (Gladys 5.1+) ---------------------------------------------
for (const key of Object.values(WIDGET)) {
  gladys.onWidgetGet(key, (request) => dreame.widgetContent(key, request));
}
// The buttons carry the robot id: the same handler serves every widget.
for (const key of [WIDGET.ROBOT, WIDGET.QUICK_CLEAN]) {
  gladys.onWidgetAction(key, (actionKey, params) => dreame.widgetAction(actionKey, params));
}
gladys.onWidgetGetImage((imageKey) => dreame.widgetImage(imageKey));

// --- Connection lifecycle ------------------------------------------------------
gladys.on('connected', () => {
  dreame.onConnected().catch((err) => logger.error(`Start failed: ${err.message}`));
});
gladys.on('disconnected', () => {
  logger.warn('WebSocket disconnected from Gladys: the SDK reconnects');
});

gladys.handleShutdown(async (signal) => {
  logger.info(`Received ${signal}: shutting down`);
  dreame.stopAll();
});

logger.info('Starting the Dreame integration');
gladys.connect().catch((err) => {
  logger.error(`Initial connection failed: ${err.message}`);
  process.exit(1);
});
