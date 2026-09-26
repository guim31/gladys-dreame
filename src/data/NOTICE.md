# Third-party data

`models.json` is extracted, by `tools/extract-models.py`, from the model table
(`DEVICE_INFO`) of the Home Assistant integration
[Tasshack/dreame-vacuum](https://github.com/Tasshack/dreame-vacuum), version
v2.0.0b25. It keeps three facts per model: whether the table knows it, the AES
IV of its map files, and from which firmware build it numbers its states the new
way. The MIoT property and action ids in `src/constants.js`, and the map format
decoded in `src/dreame/map.js`, follow the same project.

That project is published under the following license:

```
MIT License

Copyright (c) 2022 Tasshack

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
