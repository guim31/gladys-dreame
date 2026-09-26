// -----------------------------------------------------------------------------
// The switchable settings of the app (property 4.50): a JSON list of
// `{ "k": <name>, "v": <value> }` when read, but a single `{ k, v }` object when
// the robot pushes one change, and a single object again when one is written.
// A pushed change is therefore merged into what is known, never a replacement.
// -----------------------------------------------------------------------------

/**
 * @param {*} value the raw 4.50 value
 * @returns {Map<string, *>|null} the settings it carries, null when unreadable
 */
export function parseSettings(value) {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const settings = new Map();
  for (const entry of entries) {
    if (entry && typeof entry.k === 'string' && entry.v !== undefined) {
      settings.set(entry.k, entry.v);
    }
  }
  return settings.size > 0 ? settings : null;
}

/**
 * Merge a 4.50 value into the one known: a full list replaces it, a single
 * setting updates it.
 * @param {*} previous the raw value known so far
 * @param {*} incoming the raw value just read or pushed
 * @returns {string|*} the merged value, as a JSON list (or `incoming` as is
 *   when it cannot be read)
 */
export function mergeSettings(previous, incoming) {
  const update = parseSettings(incoming);
  if (!update) {
    return incoming;
  }
  let isList = Array.isArray(incoming);
  if (typeof incoming === 'string') {
    try {
      isList = Array.isArray(JSON.parse(incoming));
    } catch {
      isList = false;
    }
  }
  const merged = isList ? new Map() : new Map(parseSettings(previous) || []);
  for (const [key, value] of update) {
    merged.set(key, value);
  }
  return JSON.stringify([...merged].map(([k, v]) => ({ k, v })));
}
