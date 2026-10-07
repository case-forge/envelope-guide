/**
 * The Envelope Guide CLI never resizes a logo: it embeds it as supplied and refuses one that is too big.
 * The browser page shrinks a large logo on a canvas; that is not repeated here, because Node has no canvas and a
 * refusal is simpler and leaves the logo exactly as it was made.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'envelope-guide-cli', 'cli.mjs');
const photos = path.join(here, 'fixtures', 'photo');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'eglimits-'));

function run(dir, logoFile) {
  const r = path.join(dir, 'r.json');
  fs.writeFileSync(r, JSON.stringify({ envelope: 'c5', firmName: 'X', addressTo: 'A\nB', logo: { path: logoFile, shape: 'square', sizeMm: 24 } }));
  const out = path.join(dir, 'o.pdf');
  const p = spawnSync(process.execPath, [CLI, '--json', r, out], { encoding: 'utf8' });
  return { status: p.status, json: JSON.parse(p.stdout), out };
}

test('a logo is embedded as it is: the sheet is about the size of the logo file, with no warning about it', () => {
  const d = tmp();
  try {
    fs.copyFileSync(path.join(photos, 'plain.jpg'), path.join(d, 'logo.jpg'));
    const { status, json, out } = run(d, 'logo.jpg');
    assert.equal(status, 0, JSON.stringify(json));
    assert.deepEqual(json.warnings, []);
    assert.ok(fs.statSync(out).size >= fs.statSync(path.join(d, 'logo.jpg')).size, 'the picture is inside the PDF, whole');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('a logo over 4 MB is refused with logo_too_large and nothing is written', () => {
  const d = tmp();
  try {
    const big = Buffer.concat([fs.readFileSync(path.join(photos, 'plain.jpg')), Buffer.alloc(4 * 1024 * 1024 + 1)]);
    fs.writeFileSync(path.join(d, 'big.jpg'), big);
    const { status, json, out } = run(d, 'big.jpg');
    assert.equal(status, 3);
    assert.equal(json.error.code, 'logo_too_large');
    assert.equal(fs.existsSync(out), false);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('a picture that claims too many pixels is refused from its header, before anything decodes it', () => {
  const d = tmp();
  try {
    const png = Buffer.from(fs.readFileSync(path.join(photos, 'upright.png')));
    png.writeUInt32BE(9000, 16); png.writeUInt32BE(9000, 20);          // 81 million pixels claimed; the file is small
    fs.writeFileSync(path.join(d, 'bomb.png'), png);
    const a = run(d, 'bomb.png');
    assert.equal(a.status, 3);
    assert.equal(a.json.error.code, 'logo_too_many_pixels');
    const jpg = Buffer.from(fs.readFileSync(path.join(photos, 'plain.jpg')));
    let patched = false;
    for (let i = 2; i + 9 < jpg.length;) {                                // patch the start-of-frame header to 9000 x 9000
      const m = jpg[i + 1];
      if (m >= 0xc0 && m <= 0xc2) { jpg.writeUInt16BE(9000, i + 5); jpg.writeUInt16BE(9000, i + 7); patched = true; break; }
      i += 2 + jpg.readUInt16BE(i + 2);
    }
    assert.ok(patched, 'the fixture has a frame header');
    fs.writeFileSync(path.join(d, 'bomb.jpg'), jpg);
    const b = run(d, 'bomb.jpg');
    assert.equal(b.status, 3);
    assert.equal(b.json.error.code, 'logo_too_many_pixels');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
