#!/usr/bin/env python3
"""Regenerate src/data/models.json from the Home Assistant integration.

The Dreame cloud does not describe the robots it serves: which map encryption
IV a model uses, and from which firmware it numbers its states the new way,
only exist in the model table that Tasshack/dreame-vacuum (MIT License,
Copyright (c) 2022 Tasshack) ships compressed in its const.py (DEVICE_INFO).
This script extracts those two facts, and the list of the models it knows.

Usage: tools/extract-models.py <path to dreame_vacuum/dreame/const.py> <version>
"""
import base64
import json
import re
import sys
import zlib

NEW_STATE_CAPABILITY = 45

source, version = sys.argv[1], sys.argv[2]
text = open(source, encoding="utf-8").read()
blob = re.search(r'DEVICE_INFO: Final = \(\s*"([^"]+)"', text).group(1)
entries, capabilities, keys, models = json.loads(zlib.decompress(base64.b64decode(blob), zlib.MAX_WBITS | 32))

map_ivs = {}
new_state = {}
for model, index in sorted(models.items()):
    entry = entries[index]
    if not entry or entry[2] < 0:
        continue
    if len(entry) == 4 and 0 <= entry[3] < len(keys):
        map_ivs.setdefault(keys[entry[3]], []).append(model)
    for capability in capabilities[entry[2]] or []:
        if capability[0] == NEW_STATE_CAPABILITY:
            new_state.setdefault(str(capability[1]), []).append(model)

json.dump(
    {
        "source": f"Tasshack/dreame-vacuum {version} (MIT License, Copyright (c) 2022 Tasshack)",
        "known": sorted(models),
        "mapIvs": map_ivs,
        "newStateFromFirmware": new_state,
    },
    sys.stdout,
    indent=1,
    sort_keys=True,
)
sys.stdout.write("\n")
