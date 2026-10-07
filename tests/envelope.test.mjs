import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ENVELOPES, DEFAULT_ENVELOPE, LEGACY_ENVELOPE_IDS, resolveEnvelopeId, foldMarks, MM,
  effectiveLogoSize, mastheadBottom, mastheadBaselines,
} from '../static/js/envelope-guide/envelopes.js';
import { jpegOrientation } from '../static/js/envelope-guide/logo.js';
import { makeLetterhead } from '../static/js/envelope-guide/envelope.js';

// Words and their boxes in millimetres from the top-left of the sheet, read back from the real PDF.
function wordsIn(bytes) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'env-')), 'x.pdf');
  fs.writeFileSync(f, bytes);
  const r = spawnSync('pdftotext', ['-bbox', f, '-'], { encoding: 'utf8' });
  if (r.status !== 0) return null;   // poppler not installed: the geometry tests skip
  return [...r.stdout.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)]
    .map((m) => ({ x: m[1] / MM, top: m[2] / MM, right: m[3] / MM, bottom: m[4] / MM, text: m[5] }));
}

test('the DIN 5008 presets carry the current standard\'s numbers', () => {
  const b = ENVELOPES['dl-din-5008-b'];
  const a = ENVELOPES['dl-din-5008-a'];
  assert.equal(DEFAULT_ENVELOPE, 'dl-din-5008-b');
  assert.equal(b.label, 'DL, DIN 5008 Form B');
  assert.equal(a.label, 'DL, DIN 5008 Form A');
  assert.deepEqual(b.window, { x: 20, y: 45, w: 85, h: 45 });
  assert.deepEqual(a.window, { x: 20, y: 27, w: 85, h: 45 });
  assert.deepEqual(foldMarks('dl-din-5008-b'), [105, 210]);
  assert.deepEqual(foldMarks('dl-din-5008-a'), [87, 192]);
  // The recipient zone starts 17.7 mm below the top of the address field: 62.7 and 44.7 from the sheet's top.
  for (const [preset, zoneTop] of [[b, 62.7], [a, 44.7]]) {
    const firstLineTop = preset.window.y + preset.addressBaseline - 3.6;   // baseline minus the first line's height
    assert.ok(Math.abs(firstLineTop - zoneTop) <= 0.5, `first line starts at ${firstLineTop}, zone at ${zoneTop}`);
  }
});

test('the UK, C5 and C4 presets keep their windows and put the addressee 9.5 mm down', () => {
  assert.deepEqual(foldMarks('dl-uk'), [99, 198]);
  assert.deepEqual(foldMarks('c5'), [148.5]);
  assert.deepEqual(foldMarks('c4'), []);
  for (const id of ['dl-uk', 'c5', 'c4']) {
    assert.equal(ENVELOPES[id].addressBaseline, 9.5);
    assert.ok(ENVELOPES[id].senderBaseline < ENVELOPES[id].addressBaseline - 3);
  }
  assert.equal(ENVELOPES.c5.label, 'C5 (162 × 229 mm)');
  assert.equal(ENVELOPES.c4.label, 'C4 (229 × 324 mm)');
});

test('older envelope ids saved in history still open on a sensible preset', () => {
  assert.equal(resolveEnvelopeId('dl-din-a'), 'dl-din-5008-b');   // the same 45 mm field
  assert.equal(resolveEnvelopeId('dl-din-b'), 'dl-din-5008-b');   // a 50 mm field: 5 mm from Form B, 23 from Form A
  assert.equal(resolveEnvelopeId('c5'), 'c5');
  assert.equal(resolveEnvelopeId('no-such-thing'), DEFAULT_ENVELOPE);
  assert.equal(resolveEnvelopeId(undefined), DEFAULT_ENVELOPE);
  for (const target of Object.values(LEGACY_ENVELOPE_IDS)) assert.ok(ENVELOPES[target]);
  assert.deepEqual(foldMarks('dl-din-a'), [105, 210]);
});

test('every preset draws the sender line inside its window, above the addressee, and the address fits', async () => {
  for (const [id, env] of Object.entries(ENVELOPES)) {
    const bytes = await makeLetterhead({
      envelope: id, senderLine: 'SENDERLINE', addressTo: 'Line1\nLine2\nLine3\nLine4\nLine5\nLine6',
    });
    const words = wordsIn(bytes);
    if (!words) return;   // pdftotext missing
    const w = env.window;
    const sender = words.find((x) => x.text === 'SENDERLINE');
    const first = words.find((x) => x.text === 'Line1');
    const last = words.find((x) => x.text === 'Line6');
    assert.ok(sender && first && last, `${id}: text found`);
    assert.ok(sender.top >= w.y && sender.bottom <= w.y + w.h, `${id}: sender line inside the window (${sender.top.toFixed(1)} to ${sender.bottom.toFixed(1)}, window ${w.y} to ${w.y + w.h})`);
    assert.ok(sender.bottom < first.top, `${id}: sender line above the addressee`);
    assert.ok(first.top >= w.y && last.bottom <= w.y + w.h, `${id}: six address lines inside the window (${first.top.toFixed(1)} to ${last.bottom.toFixed(1)})`);
    assert.ok(Math.abs(first.x - w.x) < 1, `${id}: left edge at the window's left edge`);
    assert.ok(last.right <= w.x + w.w, `${id}: within the window's width`);
  }
});

test('the DIN presets start the addressee at the standard\'s recipient zone', async () => {
  for (const [id, zoneTop] of [['dl-din-5008-b', 62.7], ['dl-din-5008-a', 44.7]]) {
    const words = wordsIn(await makeLetterhead({ envelope: id, addressTo: 'Ms A Sample\n12 Example Road' }));
    if (!words) return;
    const first = words.find((x) => x.text === 'Ms');
    assert.ok(first.top >= zoneTop - 1 && first.top <= zoneTop + 2, `${id}: text top ${first.top.toFixed(1)} vs zone ${zoneTop}`);
  }
});

// ── Characters beyond Western European, overflow, and stored history ─────────

import { isValidEntry } from '../static/js/envelope-guide/history.js';
import { logoIsUsable } from '../static/js/envelope-guide/envelope.js';

const FONT_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'static', 'fonts', 'liberation-sans');
const shippedFonts = () => ({
  regular: new Uint8Array(fs.readFileSync(path.join(FONT_DIR, 'LiberationSans-Regular.ttf'))),
  bold: new Uint8Array(fs.readFileSync(path.join(FONT_DIR, 'LiberationSans-Bold.ttf'))),
});
const textOf = (bytes) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'env-')), 'x.pdf');
  fs.writeFileSync(f, bytes);
  const r = spawnSync('pdftotext', [f, '-'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
};

test('Welsh, Polish and Turkish letters are printed, not turned into question marks', async () => {
  const address = 'Ms Nia Ŵyn\nTŷ Hafan\nŁódź\nYılmaz Öğretmen';
  const problems = [];
  const bytes = await makeLetterhead({ envelope: DEFAULT_ENVELOPE, addressTo: address, firmName: 'Cyfreithwyr Tŷ Ŵyn',
    fonts: shippedFonts(), onProblems: (p) => problems.push(p) });
  assert.deepEqual(problems[0].unprintable, [], 'nothing is reported as unprintable');
  const text = textOf(bytes);
  if (!text) return;   // pdftotext missing
  for (const word of ['Ŵyn', 'Tŷ', 'Łódź', 'Yılmaz', 'Öğretmen']) assert.ok(text.includes(word), `${word} appears in the PDF text`);
  assert.ok(!text.includes('?'), 'no question marks');
});

test('plain Western European text keeps the small built-in font and needs no extra font', async () => {
  const problems = [];
  const bytes = await makeLetterhead({ envelope: DEFAULT_ENVELOPE, addressTo: 'Ms Zoë Müller\nCafé Road', onProblems: (p) => problems.push(p) });
  assert.deepEqual(problems[0].unprintable, []);
  assert.ok(bytes.length < 40000, `a plain sheet stays small (${bytes.length} bytes)`);
});

test('a character no font here has is reported, and the sheet still builds', async () => {
  const problems = [];
  const bytes = await makeLetterhead({ envelope: DEFAULT_ENVELOPE, addressTo: 'Ms A 你好\n1 Road', fonts: shippedFonts(), onProblems: (p) => problems.push(p) });
  assert.ok(bytes.length > 1000);
  assert.deepEqual(problems[0].unprintable.sort(), ['你', '好'].sort());
});

test('an address too wide or too tall for the window is reported', async () => {
  const problems = [];
  await makeLetterhead({ envelope: DEFAULT_ENVELOPE,
    addressTo: `${'A very long line of an address that cannot possibly fit in the window '.repeat(2)}\n2\n3\n4\n5\n6\n7\n8`,
    onProblems: (p) => problems.push(p) });
  assert.equal(problems[0].tooWide.length, 1);
  assert.equal(problems[0].tooTall, true);
  assert.equal(problems[0].maxLines, 6, 'DIN 5008 holds six lines');
  const fine = [];
  await makeLetterhead({ envelope: DEFAULT_ENVELOPE, addressTo: 'Ms A Sample\n12 Example Road\nLondon\nN1 1AA', onProblems: (p) => fine.push(p) });
  assert.deepEqual([fine[0].tooWide, fine[0].tooTall], [[], false]);
});

test('stored history entries of the wrong shape are dropped, not trusted', () => {
  const good = { id: 'a-1', timestamp: 1, action: 'printed', fields: { addressTo: 'x' } };
  assert.equal(isValidEntry(good), true);
  for (const bad of [null, undefined, 'text', 5, [], {}, { id: 'x' }, { id: 'x', timestamp: 'now', fields: {} },
    { id: 'x', timestamp: 1 }, { id: 'x', timestamp: 1, fields: [] }, { id: 7, timestamp: 1, fields: {} }]) {
    assert.equal(isValidEntry(bad), false, JSON.stringify(bad));
  }
});

test('a logo that is not really a PNG or JPEG is refused', async () => {
  assert.equal(await logoIsUsable(new TextEncoder().encode('this is text pretending to be a picture'), 'png'), false);
  assert.equal(await logoIsUsable(new Uint8Array([1, 2, 3]), 'jpg'), false);
});

test('clearAll removes every saved envelope and nothing else', async () => {
  const store = new Map([['other-key', 'kept']]);
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  try {
    const { saveEntry, listEntries, clearAll } = await import('../static/js/envelope-guide/history.js');
    saveEntry({ action: 'downloaded', label: 'A', hadLogo: false, fields: { addressTo: 'Ms A' } });
    saveEntry({ action: 'printed', label: 'B', hadLogo: false, fields: { addressTo: 'Mr B' } });
    assert.equal(listEntries().length, 2);
    clearAll();
    assert.deepEqual(listEntries(), []);
    assert.equal(store.get('other-key'), 'kept');
  } finally { delete globalThis.localStorage; }
});

// A 2 x 2 PNG, enough to embed as a logo.
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVQIW2P8z8DwHwYYGBgYGGAAAAcQAwCkbfqXAAAAAElFTkSuQmCC', 'base64'));

test('the letterhead stays above the address window: DIN Form A shrinks the logo and pulls the masthead up', async () => {
  assert.equal(mastheadBottom('dl-din-5008-a'), 26);
  assert.equal(effectiveLogoSize('dl-din-5008-a', 16), 12);
  assert.equal(effectiveLogoSize('dl-din-5008-a', 30), 12);
  assert.equal(effectiveLogoSize('dl-din-5008-b', 16), 16);
  assert.equal(effectiveLogoSize('dl-din-5008-b', 30), 30);
  assert.equal(effectiveLogoSize('dl-uk', 99), 30, 'requested sizes are limited to 30 mm');
  assert.deepEqual(mastheadBaselines('dl-din-5008-a'), { firm: 19, strapline: 24 });
  assert.deepEqual(mastheadBaselines('dl-din-5008-b'), { firm: 22, strapline: 29 });
  const a = [];
  await makeLetterhead({ envelope: 'dl-din-5008-a', firmName: 'A. Solicitors', strapline: 'Family and children law', addressTo: 'Ms A\nB', logo: { bytes: PNG, type: 'png' }, logoSizeMm: 16, onProblems: (p) => a.push(p) });
  assert.deepEqual(a[0].logoScaled, { from: 16, to: 12 });
  const b = [];
  await makeLetterhead({ envelope: 'dl-din-5008-b', firmName: 'A. Solicitors', addressTo: 'Ms A\nB', logo: { bytes: PNG, type: 'png' }, logoSizeMm: 16, onProblems: (p) => b.push(p) });
  assert.equal(b[0].logoScaled, null);
});

test('in the rendered PDF nothing of the masthead reaches into the Form A address window', async (t) => {
  const bytes = await makeLetterhead({ envelope: 'dl-din-5008-a', firmName: 'A. Solicitors', strapline: 'Family and children law', addressTo: 'Ms A Sample' });
  const words = wordsIn(bytes);
  if (!words) return t.skip('pdftotext is not installed');
  for (const w of words.filter((x) => ['A.', 'Solicitors', 'Family', 'children', 'law'].includes(x.text))) {
    assert.ok(w.bottom <= 27.05, `"${w.text}" reaches ${w.bottom.toFixed(1)} mm, the window starts at 27`);
  }
});

test('a masthead or footer that will not fit is reported, and Hebrew is warned about', async () => {
  const p = [];
  await makeLetterhead({ envelope: DEFAULT_ENVELOPE, firmName: 'A very very long firm name of solicitors and advocates LLP', strapline: 'x'.repeat(300),
    footerLines: ['y'.repeat(300), '2', '3', '4', '5', '6'], addressTo: 'Ms A', onProblems: (q) => p.push(q) });
  assert.equal(p[0].mastheadTooWide.length, 2);
  assert.equal(p[0].footerTooWide.length, 1);
  assert.equal(p[0].maxFooterLines, 5);
  assert.equal(p[0].footerTooTall, true);
  const ok = [];
  await makeLetterhead({ envelope: DEFAULT_ENVELOPE, firmName: 'A. Solicitors', strapline: 'Family law', footerLines: ['One', 'Two'], addressTo: 'Ms A', onProblems: (q) => ok.push(q) });
  assert.deepEqual([ok[0].mastheadTooWide, ok[0].footerTooWide, ok[0].footerTooTall, ok[0].rtl], [[], [], false, false]);
  const heb = [];
  await makeLetterhead({ envelope: DEFAULT_ENVELOPE, addressTo: 'Ms A\nשלום', onProblems: (q) => heb.push(q) });
  assert.equal(heb[0].rtl, true);
});

test('Print follows the guides checkbox exactly like Download and the preview', () => {
  const app = fs.readFileSync(new URL('../static/js/envelope-guide/app.js', import.meta.url), 'utf8');
  assert.ok(!/showGuides:\s*true/.test(app), 'no output forces the guides on');
});

test('a JPEG logo with an EXIF orientation is recognised so it can be turned upright', () => {
  const jpeg = (orientation, little = true) => {
    const u16 = (v) => (little ? [v & 255, v >> 8] : [v >> 8, v & 255]);
    const u32 = (v) => (little ? [v & 255, (v >> 8) & 255, 0, 0] : [0, 0, (v >> 8) & 255, v & 255]);
    const tiff = [...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8), ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0, ...u32(0)];
    const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    const len = body.length + 2;
    return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...body, 0xff, 0xd9]);
  };
  for (let o = 1; o <= 8; o++) {
    assert.equal(jpegOrientation(jpeg(o, true)), o);
    assert.equal(jpegOrientation(jpeg(o, false)), o);
  }
  assert.equal(jpegOrientation(jpeg(9)), 1, 'an invalid value means upright');
  assert.equal(jpegOrientation(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])), 1);
  assert.equal(jpegOrientation(new Uint8Array([1, 2, 3])), 1);
  assert.equal(jpegOrientation(PNG), 1);
});

test('a damaged saved entry restores safely: types are coerced, choices restricted, text cut to its limit', async () => {
  const { cleanFields, FIELD_LIMITS } = await import('../static/js/envelope-guide/history.js');
  const c = cleanFields({ envelope: { x: 1 }, firmName: 42, addressTo: 'x'.repeat(50000), logoShape: 'x"]', logoSizeMm: 'big', accent: 'red', showGuides: 'yes', footerLines: null });
  assert.equal(c.envelope, '');
  assert.equal(c.firmName, '');
  assert.equal(c.addressTo.length, FIELD_LIMITS.addressTo);
  assert.equal(c.logoShape, 'square');
  assert.equal(c.logoSizeMm, 16);
  assert.equal(c.accent, '#1a4f8c');
  assert.equal(c.showGuides, false);
  assert.equal(c.footerLines, '');
  assert.equal(cleanFields(undefined).logoShape, 'square');
  assert.equal(cleanFields({ logoShape: 'circle', logoSizeMm: 99 }).logoSizeMm, 30);
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  try {
    const { saveEntry, listEntries } = await import('../static/js/envelope-guide/history.js');
    saveEntry({ action: 'printed', label: 'L'.repeat(9999), hadLogo: false, fields: { addressTo: 'z'.repeat(500000), logoShape: '"]' } });
    const [entry] = listEntries();
    assert.ok(JSON.stringify([...store.values()]).length < 6000, 'an oversized entry is stored cut down, not whole');
    assert.equal(entry.fields.logoShape, 'square');
    assert.ok(entry.label.length <= 200);
  } finally { delete globalThis.localStorage; }
});
