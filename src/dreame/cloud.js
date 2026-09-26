// -----------------------------------------------------------------------------
// Client of the Dreamehome cloud (`<region>.iot.dreame.tech:13267`).
//
//   - account: an OAuth2 password grant with the app's own client, the password
//     sent as md5(password + salt) like the app does. The refresh token and
//     that hash are all a restart needs: the clear password is never kept;
//   - robots: the device list of the account (`listV2`);
//   - commands: a MIoT RPC (`get_properties`, `set_properties`, `action`)
//     relayed by the cloud to the robot through `sendCommand`, on the IoT node
//     the robot is bound to;
//   - files: the signed download URL of a file the robot uploaded (its map).
//
// Verified against the live cloud (a failed login with an account that does
// not exist, and calls with a dead token): a refused login answers HTTP 400
// `{"error":"invalid_user","error_description":"username or password error"}`
// whether the account is unknown or the password wrong; an expired access
// token answers HTTP 401 `{"code":401,"message":"Token invalid or expired"}`;
// a dead refresh token answers HTTP 401
// `{"error":"invalid_token","error_description":"Invalid refresh token (expired)"}`.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

import { DEFAULT_REGION, DREAME_CLOUD, DREAME_REGIONS } from '../constants.js';

// Why an account operation failed, for a message the user can act on.
export const AUTH_FAILURE = {
  // The cloud refused the credentials (or the account is unknown in that region).
  CREDENTIALS: 'credentials',
  // The stored session is dead and there is nothing to renew it with.
  SESSION_EXPIRED: 'session-expired',
  // Nothing linked yet.
  NOT_LINKED: 'not-linked',
};

export class DreameAuthError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'DreameAuthError';
    this.reason = reason;
  }
}

export class DreameApiError extends Error {
  constructor(message, { code = null, status = null } = {}) {
    super(message);
    this.name = 'DreameApiError';
    this.code = code;
    this.status = status;
  }
}

/**
 * The password as the app sends it.
 * @param {string} password the clear password
 * @returns {string} md5(password + salt), hex
 */
export function hashPassword(password) {
  return createHash('md5').update(`${password}${DREAME_CLOUD.PASSWORD_SALT}`, 'utf8').digest('hex');
}

/**
 * The IoT node a robot is bound to: the first label of its `bindDomain`
 * (`10000.mt.eu.iot.dreame.tech:19973` -> `10000`).
 * @param {string} bindDomain the device bindDomain
 * @returns {string|null} the node, or null when unknown
 */
export function iotNodeOf(bindDomain) {
  const host = String(bindDomain || '').split(':')[0];
  const node = host.split('.')[0];
  return node || null;
}

export class DreameCloud {
  /**
   * @param {object} options the account
   * @param {string} [options.region] account region (`eu`, `us`, ...)
   * @param {string} [options.username] email or phone number of the account
   * @param {string} [options.passwordHash] md5(password + salt), to log in again
   *   when Dreame ends the session
   * @param {string} [options.refreshToken] refresh token of a previous login
   * @param {string} [options.tenantId] tenant id of a previous login
   * @param {Function} [options.onSession] called with the session after every
   *   login or renewal, so it can be persisted
   * @param {Function} [options.fetchImpl] fetch, injectable for the tests
   * @param {Function} [options.now] clock, injectable for the tests
   * @param {string} [options.baseUrl] overrides the region host (tests)
   */
  constructor({
    region = DEFAULT_REGION,
    username = null,
    passwordHash = null,
    refreshToken = null,
    tenantId = null,
    onSession = null,
    fetchImpl = globalThis.fetch,
    now = Date.now,
    baseUrl = process.env.DREAME_API_BASE || null,
  } = {}) {
    this.region = DREAME_REGIONS.includes(region) ? region : DEFAULT_REGION;
    this.username = username;
    this.passwordHash = passwordHash;
    this.refreshToken = refreshToken;
    this.tenantId = tenantId || DREAME_CLOUD.DEFAULT_TENANT_ID;
    this.onSession = onSession;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.baseUrlOverride = baseUrl ? baseUrl.replace(/\/+$/, '') : null;
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
    this.uid = null;
    this.pendingToken = null;
    // MIoT request ids, as the app does: an increasing counter.
    this.requestId = Math.floor(Math.random() * 100) + 1;
  }

  get baseUrl() {
    return (
      this.baseUrlOverride ||
      `https://${this.region}${DREAME_CLOUD.HOST_SUFFIX}:${DREAME_CLOUD.PORT}`
    );
  }

  /** @returns {boolean} whether there is anything to open a session with */
  hasCredentials() {
    return Boolean(this.refreshToken || (this.username && this.passwordHash));
  }

  /** @returns {object} what a restart needs, never the clear password */
  getSession() {
    return {
      region: this.region,
      username: this.username,
      passwordHash: this.passwordHash,
      refreshToken: this.refreshToken,
      tenantId: this.tenantId,
    };
  }

  baseHeaders() {
    const headers = {
      Accept: '*/*',
      'Accept-Language': 'en-US;q=0.8',
      'User-Agent': DREAME_CLOUD.USER_AGENT,
      Authorization: DREAME_CLOUD.CLIENT_AUTHORIZATION,
      'Tenant-Id': this.tenantId,
    };
    if (this.region === 'cn') {
      headers['Dreame-Rlc'] = DREAME_CLOUD.CN_RLC_HEADER;
    }
    return headers;
  }

  // --- Account ------------------------------------------------------------

  /**
   * Log in with the account credentials. The clear password only transits
   * here, hashed at once; the hash is kept to log in again later.
   * @param {string} username email or phone number
   * @param {string} password clear password
   * @returns {Promise<void>}
   */
  async login(username, password) {
    this.username = username;
    this.passwordHash = hashPassword(password);
    this.refreshToken = null;
    this.accessToken = null;
    await this.passwordGrant();
  }

  async passwordGrant() {
    if (!this.username || !this.passwordHash) {
      throw new DreameAuthError(AUTH_FAILURE.NOT_LINKED, 'No Dreamehome account is linked');
    }
    await this.tokenRequest({
      grant_type: 'password',
      username: this.username,
      password: this.passwordHash,
      type: 'account',
    });
  }

  async refreshGrant() {
    await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: this.refreshToken });
  }

  async tokenRequest(grant) {
    // Same field order as the app; URLSearchParams also encodes what must be
    // (a `+` in an email address would otherwise reach the cloud as a space).
    const body = new URLSearchParams({ platform: 'IOS', scope: 'all', ...grant });
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${DREAME_CLOUD.TOKEN_PATH}`, {
        method: 'POST',
        headers: { ...this.baseHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(DREAME_CLOUD.REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new DreameApiError(`The Dreamehome cloud is unreachable: ${err.message}`);
    }
    const text = await response.text();
    const json = parseJson(text);
    if (response.ok && json && json.access_token) {
      this.accessToken = json.access_token;
      this.refreshToken = json.refresh_token || this.refreshToken;
      this.uid = json.uid !== undefined && json.uid !== null ? String(json.uid) : this.uid;
      this.tenantId = json.tenant_id || this.tenantId;
      const lifetimeMs = Number(json.expires_in) > 0 ? Number(json.expires_in) * 1000 : 3600 * 1000;
      this.accessTokenExpiresAt =
        this.now() + Math.max(lifetimeMs - DREAME_CLOUD.TOKEN_EXPIRY_MARGIN_MS, lifetimeMs / 2);
      if (this.onSession) {
        // Persisting the session is best effort: a failure there must not turn
        // a successful login into a failed one.
        await Promise.resolve()
          .then(() => this.onSession(this.getSession()))
          .catch(() => {});
      }
      return;
    }
    const error = (json && json.error) || '';
    const description = (json && (json.error_description || json.message || json.msg)) || text;
    if (grant.grant_type === 'refresh_token' && response.status < 500) {
      throw new DreameAuthError(AUTH_FAILURE.SESSION_EXPIRED, `Session refused: ${description}`);
    }
    if (error === 'invalid_user' || /password/i.test(String(description))) {
      throw new DreameAuthError(AUTH_FAILURE.CREDENTIALS, String(description));
    }
    throw new DreameApiError(`Login failed (HTTP ${response.status}): ${description}`, {
      status: response.status,
    });
  }

  /**
   * A valid access token: the current one, else a renewed one (refresh token
   * first, then the stored password hash). Concurrent callers share a single
   * renewal.
   * @param {boolean} [force] renew even if the current token looks valid
   * @returns {Promise<string>} the access token
   */
  async getAccessToken(force = false) {
    if (!force && this.accessToken && this.now() < this.accessTokenExpiresAt) {
      return this.accessToken;
    }
    if (!this.pendingToken) {
      this.pendingToken = this.renewToken().finally(() => {
        this.pendingToken = null;
      });
    }
    await this.pendingToken;
    return this.accessToken;
  }

  async renewToken() {
    this.accessToken = null;
    if (this.refreshToken) {
      try {
        await this.refreshGrant();
        return;
      } catch (err) {
        if (!(err instanceof DreameAuthError)) {
          // Network or server trouble: the refresh token is still good.
          throw err;
        }
        this.refreshToken = null;
        if (!this.passwordHash) {
          throw err;
        }
        // Dreame ended the session: log in again with the stored hash, as the
        // app does, rather than asking the user for the password again.
      }
    }
    if (!this.username || !this.passwordHash) {
      throw new DreameAuthError(AUTH_FAILURE.NOT_LINKED, 'No Dreamehome account is linked');
    }
    // A refused password here means it changed since the link: the user
    // must link again (AUTH_FAILURE.CREDENTIALS).
    await this.passwordGrant();
  }

  /** Forget everything (unlink). */
  clear() {
    this.username = null;
    this.passwordHash = null;
    this.refreshToken = null;
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
    this.uid = null;
    this.tenantId = DREAME_CLOUD.DEFAULT_TENANT_ID;
  }

  // --- API ------------------------------------------------------------------

  /**
   * POST a JSON body to the API with the session token, renewing it once
   * on a 401.
   * @param {string} path the API path
   * @param {object} [body] the JSON body; none is sent when undefined
   * @param {boolean} [retry] internal: whether a 401 may renew the token
   * @returns {Promise<object>} the decoded answer (`code` 0)
   */
  async post(path, body, retry = true) {
    const token = await this.getAccessToken();
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          ...this.baseHeaders(),
          'Content-Type': 'application/json',
          'Dreame-Auth': token,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(DREAME_CLOUD.REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new DreameApiError(`The Dreamehome cloud is unreachable: ${err.message}`);
    }
    if (response.status === 401 && retry) {
      await this.getAccessToken(true);
      return this.post(path, body, false);
    }
    const text = await response.text();
    const json = parseJson(text);
    if (!response.ok || !json) {
      const message = (json && (json.message || json.msg)) || text || `HTTP ${response.status}`;
      throw new DreameApiError(`Dreamehome API error on ${path}: ${message}`, {
        status: response.status,
        code: json && json.code,
      });
    }
    if (json.code !== undefined && json.code !== 0) {
      throw new DreameApiError(
        `Dreamehome API error on ${path}: ${json.msg || json.message || `code ${json.code}`}`,
        { status: response.status, code: json.code },
      );
    }
    return json;
  }

  /**
   * The devices of the account, as the app lists them.
   * @returns {Promise<Array>} the raw device records
   */
  async listDevices() {
    const json = await this.post(DREAME_CLOUD.DEVICE_LIST_PATH);
    const records = json.data && json.data.page && json.data.page.records;
    return Array.isArray(records) ? records : [];
  }

  /**
   * Relay one MIoT RPC to a robot.
   * @param {object} device the robot (`did`, `bindDomain`)
   * @param {string} method `get_properties`, `set_properties` or `action`
   * @param {*} params the RPC parameters
   * @returns {Promise<*>} the RPC result
   */
  async sendCommand(device, method, params) {
    const node = iotNodeOf(device.bindDomain);
    const path = `${DREAME_CLOUD.COMMAND_PREFIX}${node ? `-${node}` : ''}${DREAME_CLOUD.COMMAND_SUFFIX}`;
    const send = async () => {
      this.requestId += 1;
      const id = this.requestId;
      const did = String(device.did);
      return this.post(path, { did, id, data: { did, id, method, params } });
    };
    let json = await send();
    if (!hasResult(json) && json.success === true) {
      // Accepted with no answer: the app retries once, so do we.
      json = await send();
    }
    if (!hasResult(json)) {
      throw new DreameApiError(`The robot did not answer ${method}`, { code: json.code });
    }
    return json.data.result;
  }

  /**
   * Read properties, by `siid.piid` key.
   * @param {object} device the robot
   * @param {Array<string>} keys `siid.piid` keys
   * @returns {Promise<Map<string, *>>} the values the robot has; a property it
   *   lacks (non-zero code) is absent from the map
   */
  async getProperties(device, keys) {
    const values = new Map();
    for (let start = 0; start < keys.length; start += DREAME_CLOUD.MAX_PROPERTIES_PER_REQUEST) {
      const batch = keys.slice(start, start + DREAME_CLOUD.MAX_PROPERTIES_PER_REQUEST);
      const params = batch.map((key, index) => {
        const [siid, piid] = key.split('.').map(Number);
        // `did` only correlates the answers here; the app sends a number.
        return { did: String(start + index), siid, piid };
      });
      const result = await this.sendCommand(device, 'get_properties', params);
      for (const item of Array.isArray(result) ? result : []) {
        if (item && item.code === 0 && item.value !== undefined) {
          values.set(`${item.siid}.${item.piid}`, item.value);
        }
      }
    }
    return values;
  }

  /**
   * Write one property.
   * @param {object} device the robot
   * @param {string} key `siid.piid`
   * @param {*} value the new value
   * @returns {Promise<void>}
   */
  async setProperty(device, key, value) {
    const [siid, piid] = key.split('.').map(Number);
    const result = await this.sendCommand(device, 'set_properties', [
      { did: String(device.did), siid, piid, value },
    ]);
    const item = Array.isArray(result) ? result[0] : result;
    if (!item || item.code !== 0) {
      throw new DreameApiError(
        `The robot refused ${key} = ${value} (code ${item ? item.code : 'none'})`,
        { code: item && item.code },
      );
    }
  }

  /**
   * Run one action.
   * @param {object} device the robot
   * @param {Array<number>} action `[siid, aiid]`
   * @param {Array} [inParams] the action input, `[{ piid, value }]`
   * @returns {Promise<object>} the action result (`out` holds its output)
   */
  async action(device, [siid, aiid], inParams = []) {
    const result = await this.sendCommand(device, 'action', {
      did: String(device.did),
      siid,
      aiid,
      in: inParams,
    });
    if (!result || result.code !== 0) {
      throw new DreameApiError(
        `The robot refused the action ${siid}.${aiid} (code ${result ? result.code : 'none'})`,
        { code: result && result.code },
      );
    }
    return result;
  }

  /**
   * The signed download URL of a file a robot uploaded (its map).
   * @param {object} device the robot (`did`, `model`)
   * @param {string} objectName the object name the robot gave
   * @returns {Promise<string>} the URL
   */
  async getFileUrl(device, objectName) {
    const json = await this.post(DREAME_CLOUD.FILE_URL_PATH, {
      did: String(device.did),
      model: device.model,
      filename: objectName,
      region: this.region,
    });
    if (typeof json.data !== 'string' || !json.data) {
      // The object name carries the account and robot ids: not in the message.
      throw new DreameApiError('The cloud gave no download URL for the map');
    }
    return json.data;
  }

  /**
   * Download a file from a signed URL.
   * @param {string} url the URL from getFileUrl()
   * @returns {Promise<string>} the file content
   */
  async download(url) {
    let response;
    try {
      response = await this.fetchImpl(url, {
        signal: AbortSignal.timeout(DREAME_CLOUD.REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new DreameApiError(`Download failed: ${err.message}`);
    }
    if (!response.ok) {
      throw new DreameApiError(`Download failed (HTTP ${response.status})`, {
        status: response.status,
      });
    }
    return response.text();
  }
}

function hasResult(json) {
  return Boolean(json && json.data && json.data.result !== undefined && json.data.result !== null);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
