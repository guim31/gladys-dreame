// -----------------------------------------------------------------------------
// In-memory stand-in for the SDK object, for the unit tests: the external id
// builders, plus recorders for everything the integration publishes. The
// end-to-end test does the opposite and boots index.js against a fake Gladys
// HOST (test/helpers/fakeGladysHost.js).
// -----------------------------------------------------------------------------

export const SELECTOR = 'dreame-test';

/**
 * @param {object} [options] the fake
 * @param {Array} [options.devices] the devices created in Gladys
 * @param {object} [options.config] the stored config
 * @returns {object} the fake SDK
 */
export function createFakeGladys({ devices = [], config = {} } = {}) {
  return {
    devices,
    config,
    discovered: [],
    states: [],
    transports: [],
    statuses: [],
    configWrites: [],
    externalId(suffix) {
      return `ext:${SELECTOR}:${suffix}`;
    },
    externalIds(type, platformId) {
      const device = `ext:${SELECTOR}:${type}:${platformId}`;
      return { device, feature: (key) => `${device}:${key}` };
    },
    async getConfig() {
      return this.config;
    },
    async setConfig(partial) {
      this.configWrites.push(partial);
      Object.assign(this.config, partial);
    },
    async publishDiscoveredDevices(list) {
      this.discovered.push(list);
    },
    async publishStates(states) {
      this.states.push(...states);
    },
    async publishTransports(entries) {
      this.transports.push(...entries);
    },
    async setConnectionStatus(connected, message) {
      this.statuses.push({ connected, message });
    },
  };
}

export const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};
