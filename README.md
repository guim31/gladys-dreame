# Gladys Dreame integration

External integration for [Gladys Assistant](https://gladysassistant.com) that
controls the **robot vacuums of a Dreamehome account**, through the Dreamehome
cloud, with their changes pushed in real time.

Built on the JavaScript SDK
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
from the official
[template](https://github.com/GladysAssistant/integration-template-js). User
documentation: [`docs/fr.md`](docs/fr.md), [`docs/en.md`](docs/en.md).

> Which integration serves a robot depends on the app it was paired with. A Dreame
> robot paired in the **Xiaomi Home** app is on the Xiaomi cloud, not this one.

## What it does

- **Links the account once**, from the Actions box: email or phone number,
  password, region. The password is hashed at once the way the app does
  (`md5(password + salt)`); only that hash and the refresh token are kept, in
  off-schema config keys Gladys never sends back to the browser. When Dreame ends
  the session, the integration logs in again with the hash, without the user.
- **Discovers the robots** of the account (not its other Dreame devices), probing
  each one property by property: a feature is only published if the robot has it.
- **Reads the rooms from the robot's map**: requests a full map frame, downloads
  it, decrypts it (AES-256-CBC with a per-model IV) and reads its `seg_inf`.
- **Pushes the changes in real time**: one MQTT connection per robot, on the
  broker the robot is bound to. The Gladys poll (every minute) is only the safety
  net. A state is published when it changes, and only for the robots created in
  Gladys.
- **Shows the transport** on the device: cloud, cloud _degraded_ when the
  real-time channel is down, unreachable when the robot does not answer.

Each robot exposes:

| Feature           | Category / type                  | Dreame (MIoT)                                        |
| ----------------- | -------------------------------- | ---------------------------------------------------- |
| State             | `vacuum-cleaner` / `state`       | 2.1, with 2.2, 3.2, 4.1, 4.7, 4.17 (see below)       |
| Cleaning          | `vacuum-cleaner` / `run-mode`    | Clean → start/resume (action 2.1), Idle → stop (4.2) |
| Return to dock    | `vacuum-cleaner` / `dock`        | action 3.1                                           |
| Pause             | `button` / `push`                | action 2.2                                           |
| Suction power     | `vacuum-cleaner` / `clean-mode`  | 4.4 (table below)                                    |
| Battery           | `battery` / `integer`            | 3.1                                                  |
| Error             | `text` / `text`                  | 2.2, described in the configured language            |
| Room to clean     | `text` / `select`                | segment clean: action 4.1, kind 18                   |
| Shortcut - _name_ | `button` / `push`                | shortcut: action 4.1, kind 25 (list in 4.48)         |
| Locate the robot  | `button` / `push`                | action 7.1                                           |
| _Consumable_      | `maintenance` / `life-remaining` | the percent left of each part (9.2, 10.2, 11.1…)     |

### The state

Dreame's own state (2.1) is mapped to the seven Gladys states, except _idle_,
which means three things: a task stopped midway (**paused**: a task is under way
in 4.1/4.7, or the robot waits for a charge, 4.17), sitting on the charger
(**charging** or **docked**, from 3.2), or stopped away from it. A non-zero error
(2.2) is an **error**, unless the app shows it as a dismissible warning (dust bag
full, water tank empty…). Models without the "new state" capability number their
states above 18 differently, from a firmware build that depends on the model: both
come from the model table.

The run mode is _Clean_ only while a task actively runs, so choosing _Clean_ on a
paused robot resumes it.

### Suction power ↔ clean mode

Gladys has one clean-mode list; Dreame has four suction levels. The mapping follows
the other vacuum integrations of the store (Roborock, Xiaomi Home), so a scene
reads the same whatever the brand:

| Dreame   | 4.4 | Gladys clean mode |
| -------- | --- | ----------------- |
| Quiet    | 0   | Quiet             |
| Standard | 1   | Auto              |
| Strong   | 2   | Deep Clean        |
| Turbo    | 3   | Vacuum            |

_Quick_, _Low Noise_ and _Mop_ are refused with an explicit error.

**Mopping mode and water flow are deliberately not writable yet.** On the robots
with a self-washing station, property 4.23 packs the cleaning mode, the mop
washing frequency and the mop humidity into one integer, with a bit layout that
depends on capabilities of the model (mop pad lifting…). Writing it wrong would
change the user's settings. The diagnostic reports its raw value, so it can be
added once validated on real robots; meanwhile an app shortcut covers the need.

### Rooms

A room clean sends the room with the suction the robot is set to and its water
level (third byte of 4.23 on self-washing stations, 4.5 otherwise), once. Rooms
are named as the app names them: by type when they have one ("Kitchen",
"Primary bedroom 2"), else by the name the user gave. The selector goes back to
"—" when the room clean is over, when it never started (2 minutes), and once after
a restart. Rooms and shortcuts are re-read every 6 hours, and at every scan.

## Configuration

Nothing but the **language** of the names written into Gladys (French by default:
Gladys does not tell a device integration the language of its users). The account
is linked from the actions:

| Action             | What it does                                                          |
| ------------------ | --------------------------------------------------------------------- |
| Link the account   | Logs in (email or phone, password, region), then discovers the robots |
| Unlink the account | Erases the session and the password hash, unpublishes the robots      |
| Diagnostic         | A report to paste in a forum post: see below                          |

The **Diagnostic** action is the tool for supporting a robot one has never seen:
model and firmware, the fields of the device record (names only), every property
the robot answers with its raw value, the shortcuts and rooms found, and every
step of the map download. It contains no email, no identifier (robot id, uid,
MAC), no token and no room or shortcut name.

## Protocol notes

Verified against the live cloud, with a nonexistent account and dead tokens:

- the login answers HTTP 400 `invalid_user` / "username or password error" for an
  unknown account and a wrong password alike: the region cannot be inferred from
  the error, hence the region field (Europe by default);
- an expired access token answers HTTP 401 "Token invalid or expired"; a dead
  refresh token HTTP 401 `invalid_token` "Invalid refresh token (expired)";
- the six regional hosts resolve (`eu`, `us`, `cn`, `ru`, `sg`, `kr`
  `.iot.dreame.tech:13267`).

Taken from the reference Home Assistant integration
[Tasshack/dreame-vacuum](https://github.com/Tasshack/dreame-vacuum) (v2.0.0b25),
and **not yet exercised against a real robot**: the device list format, the
`sendCommand` relay, the MIoT property and action ids, the MQTT broker, client id
and topic, and the map format. Everything is covered by unit and end-to-end tests
against a fake cloud, broker and robot.

Traps worth knowing:

- `get_properties` answers at most 15 properties per request;
- the map location comes, depending on the firmware, in the answer of the map
  request, pushed right after on MQTT (6.3), or at a derived object name — the
  three are tried in turn; only a full frame (type 73, `I`) carries the rooms;
- the map IV is per model (13 distinct values for 659 models); an unknown model
  gets the most common one, and the diagnostic says so;
- the MQTT broker certificate does not match its host name: it is not verified,
  as in the app and the Home Assistant integration;
- `src/data/models.json` is regenerated with
  `tools/extract-models.py <path to dreame_vacuum/dreame/const.py> <version>`.

## Development

```bash
npm install
npm test             # node:test: unit tests + an end-to-end test of index.js
npm run lint         # ESLint
npm run format:check # Prettier
```

`test/e2e.test.js` boots the real `index.js` against a fake Gladys host (REST +
WebSocket), a fake Dreamehome cloud and an in-process MQTT broker (aedes) standing
in for the robot, and drives it the way the Gladys UI does: link, add the robot,
commands, real-time states, diagnostic, unlink. The test-only environment
variables are `DREAME_API_BASE`, `DREAME_MQTT_PROTOCOL`, `DREAME_DATA_DIR` and
`DREAME_MAP_PUSH_WAIT_MS`.

Validate against the store before publishing:

```bash
npx -y github:GladysAssistant/integration-store
```

## Credits

The protocol knowledge — MIoT ids, cloud API, map format — and the model table
come from [Tasshack/dreame-vacuum](https://github.com/Tasshack/dreame-vacuum), MIT
License, Copyright (c) 2022 Tasshack: see [`src/data/NOTICE.md`](src/data/NOTICE.md).
The structure follows the Gladys Roborock integration
([callemand/gladys-roborock](https://github.com/callemand/gladys-roborock)).

## License

Apache-2.0
