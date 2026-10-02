// -----------------------------------------------------------------------------
// The shortcuts of the Dreamehome app ("Raccourcis"): a saved cleaning — rooms,
// order, suction, water, passes, mopping mode — started with one tap. The robot
// keeps them itself, in property 4.48, as a JSON array whose names are base64:
//   [{ "id": 32, "name": "Q3Vpc2luZQ==", "state": "0" }, ...]
// Starting one is a custom start (action 4.1) of kind SHORTCUT with the id as
// its parameter, which keeps every setting saved in the app. `state` says
// whether it runs: "0" or "1" while it does, "-1" otherwise (as the Home
// Assistant integration reads it).
// -----------------------------------------------------------------------------

/**
 * Parse the SHORTCUTS property.
 * @param {*} value the raw property value (a JSON string)
 * @returns {Array<{ id: number, name: string, running: boolean }>} the
 *   shortcuts, app order
 */
export function parseShortcuts(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }
  let list;
  try {
    list = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) {
    return [];
  }
  const shortcuts = [];
  const seen = new Set();
  for (const entry of list) {
    const id = Number(entry && entry.id);
    if (!Number.isSafeInteger(id) || id < 0 || seen.has(id)) {
      continue;
    }
    seen.add(id);
    let name = '';
    if (typeof entry.name === 'string') {
      name = Buffer.from(entry.name, 'base64').toString('utf8').trim();
    }
    const state = entry.state === undefined ? null : String(entry.state);
    shortcuts.push({ id, name: name || `#${id}`, running: state === '0' || state === '1' });
  }
  return shortcuts;
}
