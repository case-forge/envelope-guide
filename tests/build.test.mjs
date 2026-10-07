// Generated file, do not edit: this repository is refreshed as a whole with each release.
// The built site: hugo builds it, the offline builder lists every file the page loads, nothing the page or its scripts
// name is missing, and every local link in the page points at a file. Skips itself when hugo is not installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const hugo = spawnSync('hugo', ['version'], { encoding: 'utf8' });

test('hugo builds the page and the offline worker lists everything it needs, fonts and workers included', { skip: hugo.status !== 0 && 'hugo is not installed' }, async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-site-'));
  try {
    const built = spawnSync('hugo', ['--gc', '-d', out], { cwd: root, encoding: 'utf8' });
    assert.equal(built.status, 0, built.stderr);
    const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    assert.match(html, /<canvas id=["']?lh-canvas/);
    assert.doesNotMatch(html, /drawer-panel|cf-footer|caseforge-mark/, 'no chrome from the other tools');
    assert.match(html, /More tools at <a href=["']?https:\/\/caseforge\.uk\/["']?>caseforge\.uk<\/a>/);
    for (const m of html.matchAll(/\s(?:href|src)=["']?(\/[^"'\s>#?]+)/g)) {
      assert.ok(fs.existsSync(path.join(out, m[1])), `the page names ${m[1]}, which is in the build`);
    }
    const { TOOLS, generate } = await import(pathToFileURL(path.join(root, 'scripts', 'build-offline.mjs')).href);
    const r = generate(out, TOOLS[0]);
    assert.deepEqual(r.missing, [], 'every file the page and its scripts name is in the build');
    const listed = new Set(r.core.map((e) => e[0]));
    for (const p of ['/', '/js/envelope-guide/app.js', '/pdfjs.worker.mjs', '/vendor/pdfjs.worker.mjs', '/vendor/cantoo-pdf-lib.js', '/vendor/pdf-lib-fontkit.js', '/fonts/liberation-sans/LiberationSans-Regular.ttf', '/fonts/liberation-sans/LiberationSans-Bold.ttf', '/manifest.json']) {
      assert.ok(listed.has(p), `the worker stores ${p}`);
    }
    assert.ok(fs.existsSync(path.join(out, 'sw.js')), 'a stand-in worker is published even before the offline build');
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});
