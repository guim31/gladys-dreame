// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json`, package.json
// and the code. The store validator checks the manifest format; nothing there
// knows which handlers index.js registers, nor the limits it only enforces at
// indexing time.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { DEFAULT_REGION, DREAME_REGIONS } from '../src/constants.js';
import { DEFAULT_LANGUAGE, LANGUAGES } from '../src/i18n.js';
import { CONFIG_KEYS } from '../src/session.js';
import { QUICK_BUTTON_SETTINGS, WIDGET } from '../src/widgets.js';

const read = async (path) => readFile(new URL(path, import.meta.url), 'utf8');
const manifest = JSON.parse(await read('../gladys-assistant-integration.json'));
const pkg = JSON.parse(await read('../package.json'));
const indexSource = await read('../index.js');

test('every manifest action has a handler in index.js, and only those', () => {
  const registered = [...indexSource.matchAll(/onAction\('([a-z0-9_]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...registered].sort(), manifest.actions.map((action) => action.key).sort());
});

test('version, image tag and package stay in sync (the Release workflow bumps all three)', () => {
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/guim31/gladys-dreame:${pkg.version}`);
  assert.match(
    manifest.cover_image,
    /^https:\/\/raw\.githubusercontent\.com\/guim31\/gladys-dreame\//,
  );
});

test('texts fit the store limits', () => {
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  for (const [language, text] of Object.entries(manifest.description)) {
    // The store rejects a description over 100 characters, silently.
    assert.ok(text.length >= 10 && text.length < 100, `description.${language}: ${text.length}`);
  }
  for (const field of manifest.config_schema.filter((f) => f.type === 'section')) {
    for (const text of Object.values(field.description)) {
      assert.ok(text.length <= 1000);
    }
  }
});

test('declaring catalog categories requires Gladys >= 4.86.0', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  const [, major, minor] = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.\d+/).map(Number);
  assert.ok(major > 4 || (major === 4 && minor >= 86), manifest.gladys_version);
});

test('the language field matches the code', () => {
  const field = manifest.config_schema.find((f) => f.key === CONFIG_KEYS.LANGUAGE);
  assert.equal(field.default, DEFAULT_LANGUAGE);
  assert.deepEqual(
    field.options.map((option) => option.value),
    LANGUAGES,
  );
});

test('the link action asks for the credentials, the password as a secret', () => {
  const link = manifest.actions.find((action) => action.key === 'dreame_link');
  const byKey = Object.fromEntries(link.fields.map((field) => [field.key, field]));
  assert.equal(byKey.username.type, 'string');
  // Not `secret`: the Gladys action form never shows what is typed in a secret
  // field (it passes no touched secrets), so nothing could be entered.
  assert.equal(byKey.password.type, 'string');
  assert.equal(byKey.password.required, true);
  // Gladys applies no default to an action field and enforces `required`: an
  // untouched required select would be refused, so the code defaults it.
  assert.equal(byKey.region.required, false);
  assert.equal(byKey.region.default, DEFAULT_REGION);
  assert.deepEqual(
    byKey.region.options.map((option) => option.value),
    DREAME_REGIONS,
  );
  // login + discovery + map download: longer than the default 30 s
  assert.ok(link.timeout_seconds >= 60 && link.timeout_seconds <= 120);
});

test('the credentials are never part of the stored config schema', () => {
  const keys = manifest.config_schema.map((field) => field.key);
  for (const key of Object.values(CONFIG_KEYS).filter((k) => k !== CONFIG_KEYS.LANGUAGE)) {
    assert.ok(!keys.includes(key), `${key} must stay off-schema`);
  }
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    assert.ok(section.label.en && section.description.en);
  }
});

test('dynamic selects declare a source and no static options', () => {
  const fields = manifest.actions.flatMap((action) => action.fields || []);
  for (const field of fields.filter((f) => f.source !== undefined)) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined);
  }
});

test('every multi-language text has English and French', () => {
  const texts = [];
  const collect = (value) => {
    if (value && typeof value === 'object') {
      if (typeof value.en === 'string') {
        texts.push(value);
        return;
      }
      Object.values(value).forEach(collect);
    }
  };
  collect(manifest);
  assert.ok(texts.length > 20);
  for (const text of texts) {
    assert.ok(text.en && text.fr, JSON.stringify(text));
  }
});

test('the widgets: declared as the code serves them, within the store limits', () => {
  // Widgets need Gladys 5.1.
  const [, major, minor] = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.\d+/).map(Number);
  assert.ok(major > 5 || (major === 5 && minor >= 1), manifest.gladys_version);
  assert.deepEqual(
    manifest.widgets.map((widget) => widget.key).sort(),
    Object.values(WIDGET).sort(),
  );
  assert.ok(manifest.widgets.length <= 5);
  assert.match(indexSource, /onWidgetGet\(/);
  assert.match(indexSource, /onWidgetGetImage\(/);
  for (const widget of manifest.widgets) {
    assert.match(widget.key, /^[a-z0-9_]{2,32}$/);
    for (const text of Object.values(widget.label)) {
      assert.ok(text.length >= 3 && text.length <= 30, `${widget.key}: ${text}`);
    }
    for (const text of Object.values(widget.description)) {
      assert.ok(text.length <= 100, `${widget.key}: ${text.length}`);
    }
    assert.ok(widget.label.en && widget.label.fr && widget.description.en && widget.description.fr);
    assert.ok((widget.settings || []).length <= 10);
    for (const field of widget.settings || []) {
      assert.ok(
        ['string', 'number', 'boolean', 'select', 'multi_select', 'section'].includes(field.type),
      );
      assert.ok(field.label.en && field.label.fr);
    }
    // Every widget shows the robot picked, among the robots added to Gladys.
    const robot = widget.settings.find((field) => field.key === 'robot');
    assert.equal(robot.source, 'devices');
    assert.equal(robot.required, false);
  }
  const quick = manifest.widgets.find((widget) => widget.key === WIDGET.QUICK_CLEAN);
  assert.deepEqual(
    quick.settings.filter((field) => field.type === 'string').map((field) => field.key),
    QUICK_BUTTON_SETTINGS,
  );
});
