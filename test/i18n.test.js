// -----------------------------------------------------------------------------
// Every text shown to a user exists in the four languages of the Gladys
// interface: French, English, German and Spanish. The German texts say "du",
// never the polite "Sie"; the Spanish ones say "usted".
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { LANGUAGES, TEXTS } from '../src/i18n.js';
import { DEGRADED_MESSAGE } from '../src/integration.js';
import { MESSAGES, REGION_NAMES } from '../src/messages.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const EXPECTED = ['de', 'en', 'es', 'fr'];
// The polite German forms; "sie" and "ihr" in lower case are other words.
const POLITE_GERMAN = /\b(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)\b/;
// What the core shows in a button of a widget, and in the maintenance list.
const BUTTON_MAX = 24;

/**
 * The problems of one multi-language object.
 * @param {object} text `{ en, fr, de, es }`
 * @param {string} where its place, for the message
 * @param {number} max the longest text allowed
 * @returns {string[]} the problems, none when fine
 */
function problemsOf(text, where, max) {
  const problems = [];
  const keys = Object.keys(text).sort();
  if (keys.join() !== EXPECTED.join()) {
    problems.push(`${where}: languages ${keys.join(', ')}`);
  }
  for (const language of keys) {
    problems.push(...stringProblems(text[language], `${where}.${language}`, max, language));
  }
  return problems;
}

function stringProblems(value, where, max, language) {
  if (typeof value !== 'string' || !value.trim()) {
    return [`${where}: empty`];
  }
  const problems = [];
  if (value.length > max) {
    problems.push(`${where}: ${value.length} characters, ${max} at most`);
  }
  if (language === 'de' && POLITE_GERMAN.test(value)) {
    problems.push(`${where}: polite German form in "${value}"`);
  }
  return problems;
}

// The bound of a manifest text, by its key.
function manifestMax(key, path) {
  if (path === 'description') {
    return 99; // the store drops an integration over 100, silently
  }
  if (key === 'label' || key === 'placeholder') {
    return 80;
  }
  return 1000;
}

function manifestProblems() {
  const problems = [];
  let count = 0;
  const walk = (value, path, key) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    // A multi-language object: any of the four language keys makes it one.
    if (Object.keys(value).some((k) => EXPECTED.includes(k))) {
      count += 1;
      problems.push(...problemsOf(value, path, manifestMax(key, path)));
      return;
    }
    for (const [k, v] of Object.entries(value)) {
      walk(v, path ? `${path}.${k}` : k, k);
    }
  };
  walk(manifest, '', '');
  return { problems, count };
}

// Sample arguments for the texts built by a function.
const sample = (fn) => fn(2, 'X');

/**
 * The problems of one language tree of `TEXTS`, against the French one.
 * @param {object} reference the French tree
 * @param {object} tree the tree of another language
 * @param {string} language its language
 * @param {string} where its place, for the message
 * @returns {string[]} the problems
 */
function treeProblems(reference, tree, language, where) {
  const problems = [];
  const want = Object.keys(reference).sort().join();
  const have = Object.keys(tree || {})
    .sort()
    .join();
  if (want !== have) {
    return [`${where}: keys ${have} instead of ${want}`];
  }
  for (const [key, value] of Object.entries(reference)) {
    const here = `${where}.${key}`;
    const other = tree[key];
    if (typeof value === 'function') {
      if (typeof other !== 'function') {
        problems.push(`${here}: not a function`);
      } else {
        problems.push(...stringProblems(sample(other), here, 300, language));
      }
    } else if (value && typeof value === 'object') {
      problems.push(...treeProblems(value, other, language, here));
    } else {
      problems.push(...stringProblems(other, here, textMax(here), language));
    }
  }
  return problems;
}

// The bound of a text: a widget button, a part name, a feature name.
function textMax(where) {
  const path = where.split('.').slice(1).join('.');
  const narrow = [
    /^widget\.(clean|pause|resume|dock|locate|selection|cleanSelection|on|off)$/,
    /^widget\.(shortModes|wetnessLevels)\./,
    /^(suctions|routes|washFrequencies)\./,
  ];
  if (narrow.some((pattern) => pattern.test(path))) {
    return BUTTON_MAX;
  }
  // The robot list cuts a part name at 40 (the maintenance widget at 24, with
  // an ellipsis: a French name already goes over).
  if (/^consumables\./.test(path)) {
    return 40;
  }
  return /^features\./.test(path) ? 60 : 300;
}

// The texts the code sends to Gladys as multi-language objects.
function codeMessages() {
  const found = [['DEGRADED_MESSAGE', DEGRADED_MESSAGE]];
  for (const [key, value] of Object.entries(REGION_NAMES)) {
    found.push([`REGION_NAMES.${key}`, value]);
  }
  for (const [key, value] of Object.entries(MESSAGES)) {
    found.push([`MESSAGES.${key}`, typeof value === 'function' ? value(2, 'eu') : value]);
  }
  return found;
}

test('the code speaks the four languages of the Gladys interface', () => {
  assert.deepEqual([...LANGUAGES].sort(), EXPECTED);
  assert.deepEqual(Object.keys(TEXTS).sort(), EXPECTED);
});

test('every multi-language text of the manifest has en, fr, de and es', () => {
  const { problems, count } = manifestProblems();
  assert.ok(count > 50, `only ${count} texts found`);
  assert.deepEqual(problems, []);
  const language = manifest.config_schema.find((field) => field.key === 'language');
  assert.deepEqual(language.options.map((option) => option.value).sort(), EXPECTED);
});

test('every message of the code has en, fr, de and es', () => {
  const messages = codeMessages();
  assert.ok(messages.length > 15);
  const problems = messages.flatMap(([where, text]) => problemsOf(text, where, 1000));
  assert.deepEqual(problems, []);
});

test('every language tree of the texts written into Gladys matches the French one', () => {
  const problems = [];
  // The French tree itself: no empty text, nothing too long.
  problems.push(...treeProblems(TEXTS.fr, TEXTS.fr, 'fr', 'fr'));
  for (const language of EXPECTED.filter((l) => l !== 'fr')) {
    problems.push(...treeProblems(TEXTS.fr, TEXTS[language], language, language));
  }
  assert.deepEqual(problems, []);
});

test('the checks catch a missing language, an empty text, a long one and a polite German', () => {
  const fine = { en: 'Clean', fr: 'Nettoyer', de: 'Reinigen', es: 'Limpiar' };
  assert.deepEqual(problemsOf(fine, 'x', 24), []);
  const { es, ...noSpanish } = fine;
  assert.equal(es, 'Limpiar');
  assert.equal(problemsOf(noSpanish, 'x', 24).length, 1);
  assert.equal(problemsOf({ ...fine, it: 'Pulire' }, 'x', 24).length, 1);
  assert.equal(problemsOf({ ...fine, de: ' ' }, 'x', 24).length, 1);
  assert.equal(problemsOf({ ...fine, es: 'Limpiar toda la vivienda ahora' }, 'x', 24).length, 1);
  assert.equal(problemsOf({ ...fine, de: 'Geben Sie das Passwort ein' }, 'x', 80).length, 1);
  assert.equal(problemsOf({ ...fine, de: 'Prüfe Ihre Daten' }, 'x', 80).length, 1);
  assert.deepEqual(problemsOf({ ...fine, de: 'Um sie umzubenennen' }, 'x', 80), []);
  const { clean, ...noClean } = TEXTS.de.widget;
  assert.equal(clean, 'Reinigen');
  assert.equal(treeProblems(TEXTS.fr.widget, noClean, 'de', 'de.widget').length, 1);
});
