#!/usr/bin/env python3
"""Regenerate src/data/models.json from the Home Assistant integration.

The Dreame cloud does not describe the robots it serves: which map encryption
IV a model uses, and from which firmware it numbers its states the new way,
only exist in the model table that Tasshack/dreame-vacuum (MIT License,
Copyright (c) 2022 Tasshack) ships compressed in its const.py (DEVICE_INFO).
This script extracts those two facts, the list of the models it knows, and
what each model does with its mops: the cleaning mode, the mop wetness and the
mop washing frequency are stored differently from one generation to the next,
and nothing but this table says which way a model stores them.

Usage: tools/extract-models.py <path to dreame_vacuum/dreame/const.py> <version>
"""
import base64
import json
import os
import re
import sys
import zlib

NEW_STATE_CAPABILITY = 45

# Capability flags kept, by their DeviceCapability name (types.py, next to
# const.py) -> key in the JSON. A flag holds from a firmware build on: 1 means
# every firmware.
FLAGS = {
    "MOP_PAD_LIFTING": "mopPadLifting",
    "MOP_PAD_LIFTING_PLUS": "mopPadLiftingPlus",
    "MOP_PAD_UNMOUNTING": "mopPadUnmounting",
    "MAX_SUCTION_POWER": "maxSuctionPower",
    "MOPPING_AFTER_SWEEPING": "moppingAfterSweeping",
    "WETNESS_LEVEL": "wetnessLevel",
    "ONBOARD_WETNESS_LEVEL": "onboardWetnessLevel",
    "SELF_CLEAN_FREQUENCY": "selfCleanFrequency",
    "SMALL_WATER_TANK": "smallWaterTank",
    "CLEANING_ROUTE": "cleaningRoute",
    "CLEANING_ROUTE_V2": "cleaningRouteV2",
    "GEN5": "gen5",
    "MAP_V2": "mapV2",
}
# Capability values kept: the bounds of the mop washing frequency.
VALUES = {
    "SELF_CLEAN_AREA_MIN": "selfCleanAreaMin",
    "SELF_CLEAN_AREA_MAX": "selfCleanAreaMax",
    "SELF_CLEAN_AREA_DEFAULT": "selfCleanAreaDefault",
    "SELF_CLEAN_AREA_FIXED_DEFAULT": "selfCleanAreaFixedDefault",
    "SELF_CLEAN_TIME_MIN": "selfCleanTimeMin",
    "SELF_CLEAN_TIME_MAX": "selfCleanTimeMax",
    "SELF_CLEAN_TIME_DEFAULT": "selfCleanTimeDefault",
    "SELF_CLEAN_TIME_FIXED_DEFAULT": "selfCleanTimeFixedDefault",
}

source, version = sys.argv[1], sys.argv[2]
text = open(source, encoding="utf-8").read()
blob = re.search(r'DEVICE_INFO: Final = \(\s*"([^"]+)"', text).group(1)
entries, capabilities, keys, models = json.loads(zlib.decompress(base64.b64decode(blob), zlib.MAX_WBITS | 32))

types = open(os.path.join(os.path.dirname(source), "types.py"), encoding="utf-8").read()
enum = re.search(r"class DeviceCapability\(IntEnum\):(.*?)\nclass ", types, re.S).group(1)
ids = {name: int(number) for name, number in re.findall(r"\n\s+(\w+) = (\d+)", enum)}
flag_ids = {ids[name]: key for name, key in FLAGS.items()}
value_ids = {ids[name]: key for name, key in VALUES.items()}

map_ivs = {}
new_state = {}
flags = {key: {} for key in FLAGS.values()}
values = {key: {} for key in VALUES.values()}
for model, index in sorted(models.items()):
    entry = entries[index]
    if not entry or entry[2] < 0:
        continue
    if len(entry) == 4 and 0 <= entry[3] < len(keys):
        map_ivs.setdefault(keys[entry[3]], []).append(model)
    for capability in capabilities[entry[2]] or []:
        if capability[0] == NEW_STATE_CAPABILITY:
            new_state.setdefault(str(capability[1]), []).append(model)
        if capability[0] in flag_ids:
            flags[flag_ids[capability[0]]].setdefault(str(capability[1]), []).append(model)
        if capability[0] in value_ids:
            values[value_ids[capability[0]]].setdefault(str(capability[1]), []).append(model)

json.dump(
    {
        "source": f"Tasshack/dreame-vacuum {version} (MIT License, Copyright (c) 2022 Tasshack)",
        "known": sorted(models),
        "mapIvs": map_ivs,
        "newStateFromFirmware": new_state,
        "capabilities": flags,
        "capabilityValues": values,
    },
    sys.stdout,
    indent=1,
    sort_keys=True,
)
sys.stdout.write("\n")
