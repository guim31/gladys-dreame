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
- **Draws the map** for a dashboard widget, next to two others (quick cleaning
  buttons, maintenance).
- **Pushes the changes in real time**: one MQTT connection per robot, on the
  broker the robot is bound to. The Gladys poll (every minute) is only the safety
  net. A state is published when it changes, and only for the robots created in
  Gladys.
- **Shows the transport** on the device: cloud, cloud _degraded_ when the
  real-time channel is down, unreachable when the robot does not answer.

Each robot exposes:

| Feature                        | Category / type                  | Dreame (MIoT)                                        |
| ------------------------------ | -------------------------------- | ---------------------------------------------------- |
| State                          | `vacuum-cleaner` / `state`       | 2.1, with 2.2, 3.2, 4.1, 4.7, 4.17 (see below)       |
| Cleaning                       | `vacuum-cleaner` / `run-mode`    | Clean → start/resume (action 2.1), Idle → stop (4.2) |
| Return to dock                 | `vacuum-cleaner` / `dock`        | action 3.1                                           |
| Pause / resume                 | `button` / `push`                | action 2.2, or 2.1 when the task is paused           |
| Cleaning mode                  | `text` / `select`                | 4.23 mode bits, 4.26 for "customize room cleaning"   |
| Suction power                  | `text` / `select`                | 4.4: quiet 0, standard 1, strong 2, turbo 3          |
| Max suction power              | `switch` / `binary`              | `SuctionMax` in the settings list 4.50               |
| Mop wetness                    | `switch` / `dimmer` (1-32)       | 28.1                                                 |
| Mop washing freq.              | `text` / `select`                | `BackWashType` in 4.50: by area 1, time 2, room 3    |
| Mop washing: every (m²), (min) | `switch` / `dimmer`              | 4.23 byte 1, for the frequency it belongs to         |
| Cleaning route                 | `text` / `select`                | `CleanRoute` in the settings list 4.50 (one key set) |
| Battery                        | `battery` / `integer`            | 3.1                                                  |
| Last clean - area              | `surface` / `decimal` (m²)       | 4.3, the clean under way while it runs; history kept |
| Last clean - duration          | `duration` / `integer` (min)     | 4.2, the clean under way while it runs; history kept |
| Error                          | `text` / `text`                  | 2.2, described in the configured language            |
| Room to clean                  | `text` / `select`                | segment clean: action 4.1, kind 18                   |
| Selection - _room_             | `switch` / `binary`              | kept by the integration (`/data/robots.json`)        |
| Clean the selection            | `button` / `push`                | segment clean of the rooms switched on               |
| Shortcut - _name_              | `button` / `push`                | shortcut: action 4.1, kind 25 (list in 4.48)         |
| Locate the robot               | `button` / `push`                | action 7.1                                           |
| _Consumable_                   | `maintenance` / `life-remaining` | the percent left of each part (9.2, 10.2, 11.1…)     |

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

### Suction power

A select with the four levels of the app, in its order. It replaced the Gladys
clean mode (0.2.3): that list has seven fixed entries, with names and an order
the integration cannot change, and the first tester could not tell which of
them did what. The clean mode stays understood as a command (Quiet, Auto, Deep
Clean, Vacuum → the four levels) for the devices created before.

### Mop settings

On the robots with a self-washing station, property 4.23 packs three settings:
the cleaning mode (byte 0), the mop washing frequency value (byte 1: square
metres by area, minutes by time, 0 by room) and the water level (byte 2, 0 on the
robots with a wetness level, 28.1, instead). A write changes one byte and keeps
the others. The robots whose mops lift number their modes their own way (2 is
vacuum, 0 vacuum and mop, 1 mop, 3 mop after vacuum), so the cleaning mode is only
offered when the model table says the mops lift — it also gives the flags for the
wetness level, the washing frequency, the max suction and "mop after vacuum", and
the bounds of the washing values. Checked against the first tester's r2449a: 3841
with the app on "mop, wash every 15 m²", 3842 on "vacuum".

The two washing sliders share byte 1: each writes it when the robot washes by its
frequency, and is otherwise kept by the integration, for when that frequency is
chosen (as the app does). Wetter mops (above 26) are washed every 20 m² or 20
minutes at most: a wetness change brings the washing value within those bounds.
Choosing a mode that vacuums brings a route the vacuum cannot take (intensive,
deep) back to standard; choosing a suction level ends the max suction boost.

### Rooms

Recent firmwares keep the rooms not in the current map but in the saved map
embedded in it (`rism`, same format, not encrypted), read when `seg_inf` is
missing. A room clean sends the room with the suction the robot is set to and its water
level (third byte of 4.23 on self-washing stations, 4.5 otherwise), once. Rooms
are named as the app names them: by type when they have one ("Kitchen",
"Primary bedroom 2"), else by the name the user gave. The selector goes back to
"—" when the room clean is over, when it never started (2 minutes), and once after
a restart. Rooms and shortcuts are re-read every 6 hours, and at every scan.

**Wear parts.** A robot may answer for a part its model does not have — the
first tester's r2449a reports 0 % for wheels. For a model the table knows, a part
is only published when the model has its capability (wheels, squeegee, scale
inhibitor, deodorizer…) or lacks the one that rules it out (sensors, mop pads,
detergent), the rule the Home Assistant integration applies; the diagnostic lists
the parts answered but left out. A model unknown to the table keeps every part it
answers for.

Several rooms at once: each room has a **Selection** switch, kept by the
integration (the robot has no such setting, and it survives restarts), and the
**Clean the selection** button starts a segment clean of the rooms switched on, in
the order of the map. Each entry carries 1 as its index on the robots with
room-by-room settings and on the fifth generation (another index stops them), its
position otherwise.

### Dashboard widgets (Gladys 5.1+)

| Widget            | Key             | Shows                                                                                                                  |
| ----------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Robot vacuum      | `robot`         | name and state, live battery, the map, settings and last clean in a status list, Clean/Pause/Dock/Locate               |
| Quick clean       | `quick_clean`   | up to 4 buttons: the app shortcuts, or the shortcuts/rooms named in its settings ("Kitchen + Living room" for several) |
| Robot setting     | `robot_setting` | one setting (mode, suction, max suction, route, wetness, mop washing) as up to 4 buttons, the current choice ticked    |
| Robot maintenance | `maintenance`   | the 3 most worn parts as gauges, every part in a status list                                                           |

Gladys renders at most 8 components per widget, 2 of them texts and 4 of them
buttons: the name and the state share the heading. The buttons are widget actions
carrying the robot id (they work for a robot not added to Gladys); the battery and
wear gauges bind the device features when the robot was added, so they move live.
**Gladys drops a button whose action key another button of the widget already
uses**: the keys are numbered (`quick_1`…, `choice_1`…) and what a button does
travels in its params, checked against a whitelist (`widgetCommand()`).

The widget vocabulary has no select nor slider, **on purpose**: the spec of
Gladys (`docs/specs/external-integrations/capabilities/dashboard-widgets.md`, "Out
of scope") keeps widgets read-and-tap, settings being device features controlled
through the core device boxes. A setting widget is therefore a row of up to four
buttons, the robot's current choice ticked; the full set of settings, with their
lists and sliders, lives in a Devices box next to the robot widget (the first
tester's verdict). A wetness button sets the middle of its range of the app's
slider (5, 16, 27), as the Home Assistant integration does.

**A current choice, or the task under way, is shown by its icon
(`check-circle`), never by the `primary` style**: in dark mode Gladys paints a
primary button like the others (its `.dark-mode .button` rule outweighs
`.buttonPrimary`, and there is no dark rule for it), so the tester saw nothing.
A quick button is ticked while its task runs: a shortcut the robot reports running
(`state` "0" or "1" in 4.48), or the rooms last sent while the robot cleans rooms.

The widgets are nudged whenever a property they show changes (`applyProps()`),
whether or not the robot was added to Gladys. When the robot's state changes (it
leaves, returns to or reaches its base), the map is re-read at the next request:
otherwise a docked robot kept its last position on the way back for half an hour.

**The map image** is drawn by the integration (`src/dreame/render.js`, no image
library: a palette PNG written by hand, zlib doing the compression). Each cell of
the grid is one byte whose meaning depends on the generation (room id in the low
bits and a wall bit, or v3 maps with 5 room bits and 2 wall bits, or "frame maps"
with the room id in the high bits, or a map being built with wall/floor only) —
the formats the Home Assistant integration reads. The rows are flipped (the
world's y axis goes up), the map is cropped and scaled to fit the 16:9 frame,
rooms get colors neighbours never share, and the charger and robot are drawn
from the header positions (millimetres). When the rooms live in the saved map
(`rism`), that is the one drawn, the robot position still coming from the current
frame. The image key is a hash of its bytes: Gladys caches an image for an hour
by key. The map is re-read only when a dashboard asks for the widget, and only
if it is older than 50 s while the robot moves (30 min otherwise); the widget is
then nudged. Its content lives 60 s while the robot moves, 10 min otherwise.
The integration nudges the widgets when the states they show change, the last
change of a burst sent at the end of Gladys' 10 s window rather than dropped.

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
