// -----------------------------------------------------------------------------
// What discovery learned about each robot, kept in /data (the only writable
// place of the container): which properties it answers, its rooms and its
// shortcuts. A robot that is offline when the integration restarts is then
// still published with the same features — without this, its device would
// shrink to the basic features and Gladys would offer to "update" it.
// Best effort: a read or write failure only costs that convenience.
// -----------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export class RobotStore {
  /**
   * @param {string} dir the data directory
   * @param {object} logger the logger
   */
  constructor(dir, logger) {
    this.dir = dir;
    this.file = path.join(dir, 'robots.json');
    this.logger = logger;
    this.robots = this.load();
  }

  load() {
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8'));
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch {
      return {};
    }
  }

  save() {
    try {
      if (!existsSync(this.dir)) {
        mkdirSync(this.dir, { recursive: true });
      }
      const temporary = `${this.file}.tmp`;
      writeFileSync(temporary, JSON.stringify(this.robots));
      renameSync(temporary, this.file);
    } catch (err) {
      this.logger.debug(`Could not save the robot cache: ${err.message}`);
    }
  }

  /**
   * @param {string} did the robot id
   * @returns {object|null} `{ capabilities, rooms, shortcuts }`
   */
  get(did) {
    return this.robots[did] || null;
  }

  /**
   * @param {string} did the robot id
   * @param {object} entry `{ capabilities, rooms, shortcuts }`
   */
  set(did, entry) {
    this.robots[did] = entry;
    this.save();
  }

  /**
   * Keep only the robots still on the account.
   * @param {Set<string>} dids the robot ids to keep
   */
  retain(dids) {
    const before = Object.keys(this.robots).length;
    this.robots = Object.fromEntries(Object.entries(this.robots).filter(([did]) => dids.has(did)));
    if (Object.keys(this.robots).length !== before) {
      this.save();
    }
  }

  clear() {
    this.robots = {};
    this.save();
  }
}
