/**
 * A JPEG logo that carries an EXIF orientation is drawn upright without a canvas (drawUpright in
 * static/js/envelope-guide/envelope.js), so the command line, which cannot redraw pixels, gets the same
 * sheet as the browser. Real JPEG fixtures, one per orientation, of the same picture; each is rendered in
 * both logo shapes and compared with the upright original. Rendering needs pdftoppm and skips without it.
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
const HAVE_PDFTOPPM = spawnSync('pdftoppm', ['-v']).status !== null;
const MM = 72 / 25.4;

function render(pdf, out) {
  const r = spawnSync('pdftoppm', ['-r', '200', '-singlefile', pdf, out]);
  assert.equal(r.status, 0);
  const ppm = fs.readFileSync(`${out}.ppm`);
  const m = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(ppm.subarray(0, 40).toString('latin1'));
  return { W: Number(m[1]), H: Number(m[2]), at: (x, y) => { const i = m[0].length + (y * Number(m[1]) + x) * 3; return [ppm[i], ppm[i + 1], ppm[i + 2]]; }, ppm, head: m[0].length };
}
const colour = ([r, g, b]) => (r > 170 && g < 110 ? 'R' : g > 130 && r < 110 ? 'G' : b > 150 && r < 110 ? 'B' : r > 190 && g > 170 && b < 120 ? 'Y' : '?');

test('a rotated JPEG logo is drawn upright, square and circle, and matches the upright original', { skip: !HAVE_PDFTOPPM }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'egorient-'));
  try {
    for (const shape of ['square', 'circle']) {
      const sheets = {};
      for (let o = 1; o <= 8; o++) {
        fs.copyFileSync(path.join(photos, `orientation-${o}.jpg`), path.join(d, `logo${o}.jpg`));
        const req = path.join(d, `r${o}${shape}.json`);
        fs.writeFileSync(req, JSON.stringify({ envelope: 'c5', firmName: 'X', logo: { path: `logo${o}.jpg`, shape, sizeMm: 30 } }));
        const pdf = path.join(d, `o${o}${shape}.pdf`);
        const run = spawnSync(process.execPath, [CLI, '--json', req, pdf], { encoding: 'utf8' });
        assert.equal(run.status, 0, run.stdout);
        assert.ok(!JSON.parse(run.stdout).warnings.some((w) => w.code === 'logo_orientation_not_applied'));
        sheets[o] = render(pdf, path.join(d, `o${o}${shape}`));
      }
      const px = (page, mm) => Math.round((mm / 25.4) * 200);
      // the logo box: 30 mm square with its left edge at 20 mm and its top at the masthead top (14 mm)
      const x0 = px(0, 20); const y0 = px(0, 14); const s = px(0, 30);
      for (let o = 1; o <= 8; o++) {
        const at = (fx, fy) => sheets[o].at(x0 + Math.round(s * fx), y0 + Math.round(s * fy));
        // Upright, the picture is wider than tall (150 x 100): red top left, green top right, blue bottom left,
        // yellow bottom right. In a circle the middle two thirds show, so sample well inside it either way.
        const names = [at(0.30, 0.33), at(0.70, 0.33), at(0.70, 0.67), at(0.30, 0.67)].map(colour).join('');
        assert.equal(names, 'RGYB', `${shape} orientation ${o}`);
        // and the whole sheet matches the one made from the upright original, pixel for pixel within JPEG noise
        if (o > 1) {
          const a = sheets[1]; const b = sheets[o];
          let sum = 0;
          for (let i = a.head; i < a.ppm.length; i += 3) sum += Math.abs(a.ppm[i] - b.ppm[i]) + Math.abs(a.ppm[i + 1] - b.ppm[i + 1]) + Math.abs(a.ppm[i + 2] - b.ppm[i + 2]);
          const mean = sum / (a.ppm.length - a.head);
          assert.ok(mean < 0.6, `${shape} orientation ${o}: mean difference from the upright sheet is ${mean.toFixed(3)}`);
        }
      }
    }
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

/**
 * Runs `fn` with `new Date()` and Date.now() frozen. The PDF's /CreationDate and /ModDate sit in a compressed
 * object stream, so the size of the file depends on the digits of the time it was made: two renders of the
 * same input a second apart can differ by a byte or two (3309 against 3310). A byte-length
 * comparison of two renders therefore needs the same clock for both.
 */
async function atFixedTime(fn) {
  const Real = Date;
  const fixed = new Real('2026-01-01T00:00:00Z').getTime();
  globalThis.Date = class extends Real {
    constructor(...args) { if (args.length) super(...args); else super(fixed); }
    static now() { return fixed; }
  };
  try { return await fn(); } finally { globalThis.Date = Real; }
}

test('in the browser path a logo given without an orientation is drawn as stored, the same as orientation 1', async () => {
  const { makeLetterhead } = await import('../static/js/envelope-guide/envelope.js');
  const bytes = new Uint8Array(fs.readFileSync(path.join(photos, 'orientation-6.jpg')));
  await atFixedTime(async () => {
    const asIs = await makeLetterhead({ envelope: 'c5', logo: { bytes, type: 'jpg' } });
    const explicit = await makeLetterhead({ envelope: 'c5', logo: { bytes, type: 'jpg', orientation: 1 } });
    assert.equal(Buffer.from(asIs).length, Buffer.from(explicit).length);
    const turned = await makeLetterhead({ envelope: 'c5', logo: { bytes, type: 'jpg', orientation: 6 } });
    assert.notEqual(Buffer.from(turned).length, Buffer.from(asIs).length, 'an orientation changes the drawing');
  });
});

test('the file size of the same input varies with the clock, which is why the size comparisons freeze it', async () => {
  const { makeLetterhead } = await import('../static/js/envelope-guide/envelope.js');
  const bytes = new Uint8Array(fs.readFileSync(path.join(photos, 'orientation-6.jpg')));
  const sizes = new Set();
  for (const when of ['2026-10-02T13:24:59.999Z', '2026-10-02T13:25:00.000Z', '2026-01-01T00:00:00.000Z', '2026-12-31T23:59:59.999Z']) {
    const Real = Date; const t = new Real(when).getTime();
    globalThis.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(t); } static now() { return t; } };
    try { sizes.add(Buffer.from(await makeLetterhead({ envelope: 'c5', logo: { bytes, type: 'jpg' } })).length); } finally { globalThis.Date = Real; }
  }
  // The size depends on the timestamp. If this becomes 1 (dates written uncompressed, or fixed), the
  // freeze above is not needed and this test can go.
  assert.ok(sizes.size > 1, `expected the file size to vary with the clock, saw ${[...sizes]}`);
});
