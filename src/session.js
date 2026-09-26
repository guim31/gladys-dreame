// -----------------------------------------------------------------------------
// Persisted Dreamehome session.
//
// The account is linked once, from the Configuration screen; what that yields
// is persisted through the Gladys config (`gladys.setConfig()`), in off-schema
// keys: Gladys never sends those back to the browser, and they are not form
// fields. Every later start reuses them silently.
//
// Stored: the account name and region, the refresh token, and md5(password +
// salt) — what the app itself sends instead of the password. That hash lets
// the integration log in again when Dreame ends the session, without asking
// the user; the clear password is never stored anywhere.
// -----------------------------------------------------------------------------

import { DEFAULT_REGION, DREAME_REGIONS } from './constants.js';
import { DEFAULT_LANGUAGE, LANGUAGES } from './i18n.js';

// Config keys. `language` is the only form field; the others are off-schema.
export const CONFIG_KEYS = {
  LANGUAGE: 'language',
  USERNAME: 'dreame_username',
  REGION: 'dreame_region',
  PASSWORD_HASH: 'dreame_password_hash',
  REFRESH_TOKEN: 'dreame_refresh_token',
  TENANT_ID: 'dreame_tenant_id',
};

/**
 * @param {object} [config] the raw integration config
 * @returns {object} the persisted session
 */
export function readSession(config = {}) {
  const region = str(config[CONFIG_KEYS.REGION]);
  return {
    username: str(config[CONFIG_KEYS.USERNAME]),
    region: DREAME_REGIONS.includes(region) ? region : DEFAULT_REGION,
    passwordHash: str(config[CONFIG_KEYS.PASSWORD_HASH]),
    refreshToken: str(config[CONFIG_KEYS.REFRESH_TOKEN]),
    tenantId: str(config[CONFIG_KEYS.TENANT_ID]),
  };
}

/**
 * @param {object} session a session
 * @returns {boolean} whether it can open a session without the user
 */
export function isSessionUsable(session) {
  return Boolean(session && (session.refreshToken || (session.username && session.passwordHash)));
}

/**
 * @param {object} [session] a session (DreameCloud.getSession())
 * @returns {object} the config keys to write
 */
export function sessionToConfig(session = {}) {
  return {
    [CONFIG_KEYS.USERNAME]: session.username || '',
    [CONFIG_KEYS.REGION]: session.username ? session.region || DEFAULT_REGION : '',
    [CONFIG_KEYS.PASSWORD_HASH]: session.passwordHash || '',
    [CONFIG_KEYS.REFRESH_TOKEN]: session.refreshToken || '',
    [CONFIG_KEYS.TENANT_ID]: session.tenantId || '',
  };
}

/** @returns {object} the config keys that forget the account */
export function clearedSessionConfig() {
  return sessionToConfig({});
}

/**
 * @param {object} [config] the raw integration config
 * @returns {string} the language of the texts written into Gladys
 */
export function readLanguage(config = {}) {
  const language = str(config[CONFIG_KEYS.LANGUAGE]);
  return LANGUAGES.includes(language) ? language : DEFAULT_LANGUAGE;
}

function str(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}
