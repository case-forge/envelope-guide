// Generated file, do not edit: this repository is refreshed as a whole with each release.
// The command line tool documents itself: every way of asking for help works and every preset is in the help. (The
// request schema and the accepted fields are compared in envelopeCli.test.mjs.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENVELOPES } from '../static/js/envelope-guide/envelopes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'envelope-guide-cli', 'cli.mjs');
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

test('--help, -h, -help, -?, /?, --usage and the word help print the same help, and it lists every preset', () => {
  const base = run('--help');
  assert.equal(base.status, 0);
  for (const alias of ['-h', '-help', '-?', '/?', '--usage', 'help']) assert.equal(run(alias).stdout, base.stdout, alias);
  const presets = run('--help', 'envelopes').stdout;
  for (const id of Object.keys(ENVELOPES)) assert.ok(presets.includes(id), `the help lists ${id}`);
});

test('a mistyped option names the nearest real one and stays a usage error', () => {
  const typo = run('--hewlp');
  assert.equal(typo.status, 2);
  assert.match(typo.stderr, /Did you mean --help\?/);
});
