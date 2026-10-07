/**
 * The Envelope Guide command line (envelope-guide-cli/cli.mjs), run for real as a child process: the contract
 * (exit codes, --json, error codes, schemaVersion), every envelope preset, the fields and their limits, logos
 * (accepted and refused), path safety, batches with a bad item, and parity with the browser's makeLetterhead.
 * Anything that needs poppler (text and pixel checks) skips itself when pdftotext or pdftoppm is absent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fx from './fixtures.mjs';
import { ENVELOPES, LEGACY_ENVELOPE_IDS, MM } from '../static/js/envelope-guide/envelopes.js';
import { FIELD_LIMITS } from '../static/js/envelope-guide/history.js';
import { makeLetterhead } from '../static/js/envelope-guide/envelope.js';
import { REQUEST_KEYS, LOGO_KEYS, ENVELOPE_IDS, checkRequest, RequestError } from '../envelope-guide-cli/request.mjs';
import { PDFDocument, PDFArray, PDFRef, decodePDFRawStream } from '/vendor/cantoo-pdf-lib.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'envelope-guide-cli', 'cli.mjs');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(here, '..', 'envelope-guide-cli', 'request.schema.json'), 'utf8'));
const FONT_DIR = path.join(here, '..', 'static', 'fonts', 'liberation-sans');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'egcli-'));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
function cli(args, { input, cwd } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', input, cwd });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* not JSON */ }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
}
function make(dir, request, name = 'req.json') {
  const file = path.join(dir, name);
  fs.writeFileSync(file, typeof request === 'string' ? request : JSON.stringify(request));
  return file;
}
const hasPoppler = spawnSync('pdftotext', ['-v']).status !== null && spawnSync('pdftotext', ['-v']).error === undefined;
function textOf(file) {
  const r = spawnSync('pdftotext', [file, '-'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
}
async function pageInfo(bytes) {
  const doc = await PDFDocument.load(bytes);
  const { width, height } = doc.getPage(0).getSize();
  return { pages: doc.getPageCount(), width, height };
}
const A4 = { width: 210 * MM, height: 297 * MM };
const near = (a, b) => Math.abs(a - b) < 0.5;

// A tiny but real JPEG header: enough for the PDF engine to embed it (it reads the frame size, it does not decode).
function makeJpeg(w = 40, h = 30, orientation = 1) {
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0];
  const exif = orientation === 1 ? [] : [0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0];
  return Buffer.from([0xff, 0xd8, ...exif, ...sof, 0xff, 0xd9]);
}

// ── The contract ────────────────────────────────────────────────────────────

test('--version and --help answer, in plain text and as JSON', () => {
  const v = cli(['--version']);
  assert.equal(v.status, 0);
  assert.equal(v.stdout.trim(), JSON.parse(fs.readFileSync(path.join(here, '..', 'envelope-guide-cli', 'package.json'), 'utf8')).version);
  const vj = cli(['--json', '--version']);
  assert.equal(vj.json.ok, true);
  assert.equal(vj.json.version, v.stdout.trim());
  const h = cli(['--help']);
  assert.equal(h.status, 0);
  assert.match(h.stdout, /Usage:/);
  const presets = cli(['--help', 'envelopes']).stdout;
  for (const id of ENVELOPE_IDS) assert.match(presets, new RegExp(id));
  assert.match(h.stdout, /^Exit codes:\n  0  Done\.\n  1  .*\n  2  The command line was wrong\.\n  3  The input was rejected/m);
});

test('usage mistakes exit 2 with a stable code, in JSON too', () => {
  for (const [args, code] of [
    [[], 'usage_missing_arguments'], [['only-one'], 'usage_missing_arguments'], [['a', 'b', 'c'], 'usage_too_many_arguments'],
    [['--no-such-flag', 'a', 'b'], 'usage_unknown_option'], [['--base-dir'], 'usage_bad_option'], [['--strict=1', 'a', 'b'], 'usage_bad_option'],
  ]) {
    const plain = cli(args);
    assert.equal(plain.status, 2, args.join(' '));
    assert.match(plain.stderr, new RegExp(`failed \\(${code}\\)`), args.join(' '));
    const j = cli(['--json', ...args]);
    assert.equal(j.status, 2, args.join(' '));
    assert.equal(j.json.ok, false);
    assert.equal(j.json.error.code, code, args.join(' '));
  }
});

test('--json puts exactly one JSON object on stdout and nothing on stderr, on success and on failure', () => {
  const d = tmp();
  try {
    const out = path.join(d, 'o.pdf');
    const ok = cli(['--json', make(d, { firmName: 'A' }), out]);
    assert.equal(ok.status, 0);
    assert.equal(ok.stderr, '');
    assert.equal(ok.stdout.trim().split('\n').length, 1);
    assert.equal(ok.json.ok, true);
    assert.equal(ok.json.tool, 'envelope-guide-cli');
    assert.equal(ok.json.schemaVersion, 1);
    assert.equal(ok.json.mode, 'single');
    assert.equal(ok.json.output, out);
    assert.equal(ok.json.pages, 1);
    assert.equal(ok.json.bytes, fs.statSync(out).size);
    assert.deepEqual(ok.json.warnings, []);
    assert.ok(ok.json.layout && Array.isArray(ok.json.layout.unprintable));
    const bad = cli(['--json', make(d, { nope: 1 }, 'bad.json'), out]);
    assert.equal(bad.status, 3);
    assert.equal(bad.stderr, '');
    assert.equal(bad.stdout.trim().split('\n').length, 1);
    assert.equal(bad.json.ok, false);
    assert.equal(bad.json.error.code, 'unknown_key');
  } finally { rm(d); }
});

test('without --json a failure is a one-line message on stderr and the exit code', () => {
  const d = tmp();
  try {
    const r = cli([make(d, '{not json'), path.join(d, 'o.pdf')]);
    assert.equal(r.status, 3);
    assert.match(r.stderr, /failed \(invalid_json\)/);
    assert.equal(fs.existsSync(path.join(d, 'o.pdf')), false, 'nothing is written on failure');
  } finally { rm(d); }
});

// ── Every preset, every field ───────────────────────────────────────────────

test('every envelope preset builds an A4 page with the text on it', async () => {
  const d = tmp();
  try {
    for (const id of ENVELOPE_IDS) {
      const out = path.join(d, `${id}.pdf`);
      const r = cli(['--json', make(d, { envelope: id, firmName: 'Test Firm', strapline: 'Strap', senderLine: 'Sender 1 Road', addressTo: ['Ms A Sample', '12 Example Road', 'London', 'E1 1AA'], footerLines: ['Regulated'], showGuides: true }), out]);
      assert.equal(r.status, 0, `${id}: ${r.stdout}`);
      assert.equal(r.json.envelope, id);
      const info = await pageInfo(fs.readFileSync(out));
      assert.equal(info.pages, 1);
      assert.ok(near(info.width, A4.width) && near(info.height, A4.height), `${id} is A4`);
      if (hasPoppler) {
        const t = textOf(out);
        for (const w of ['Test Firm', 'Strap', 'Sender 1 Road', 'Ms A Sample', '12 Example Road', 'E1 1AA', 'Regulated']) assert.ok(t.includes(w), `${id} shows ${w}`);
        if (ENVELOPES[id].folds.length >= 0) assert.ok(t.includes(`window: ${ENVELOPES[id].label}`), `${id} names its window when guides are on`);
      }
    }
  } finally { rm(d); }
});

test('an empty request builds the default sheet, and defaults are the browser defaults', async () => {
  const d = tmp();
  try {
    const r = cli(['--json', make(d, {}), path.join(d, 'o.pdf')]);
    assert.equal(r.status, 0, r.stdout);
    assert.equal(r.json.envelope, 'dl-din-5008-b');
    assert.equal((await pageInfo(fs.readFileSync(path.join(d, 'o.pdf')))).pages, 1);
  } finally { rm(d); }
});

test('older envelope ids still work and say so; unknown ids are refused', () => {
  const d = tmp();
  try {
    for (const [old, now] of Object.entries(LEGACY_ENVELOPE_IDS)) {
      const r = cli(['--json', make(d, { envelope: old }), path.join(d, 'o.pdf')]);
      assert.equal(r.status, 0);
      assert.equal(r.json.envelope, now);
      assert.ok(r.json.warnings.some((w) => w.code === 'legacy_envelope_id'));
    }
    const bad = cli(['--json', make(d, { envelope: 'c6' }), path.join(d, 'o.pdf')]);
    assert.equal(bad.status, 3);
    assert.equal(bad.json.error.code, 'unknown_envelope');
    assert.equal(bad.json.error.details.path, 'envelope');
  } finally { rm(d); }
});

test('text limits are the browser\'s, and a cut is reported, never silent', () => {
  const d = tmp();
  try {
    const r = cli(['--json', make(d, {
      firmName: 'F'.repeat(FIELD_LIMITS.firmName + 50), strapline: 'S'.repeat(FIELD_LIMITS.strapline + 1), senderLine: 'x'.repeat(FIELD_LIMITS.senderLine + 1),
      addressTo: 'A'.repeat(FIELD_LIMITS.addressTo + 10), footerLines: 'L'.repeat(FIELD_LIMITS.footerLines + 10),
    }), path.join(d, 'o.pdf')]);
    assert.equal(r.status, 0, r.stdout);
    const cut = r.json.warnings.filter((w) => w.code === 'field_truncated').map((w) => w.field).sort();
    assert.deepEqual(cut, ['addressTo', 'firmName', 'footerLines', 'senderLine', 'strapline']);
    // Exactly at the limit is not a cut.
    const exact = cli(['--json', make(d, { firmName: 'F'.repeat(FIELD_LIMITS.firmName) }), path.join(d, 'o2.pdf')]);
    assert.deepEqual(exact.json.warnings.filter((w) => w.code === 'field_truncated'), []);
  } finally { rm(d); }
});

test('an address that is too long or too wide is a warning, and a failure under --strict with nothing written', () => {
  const d = tmp();
  try {
    const tall = { envelope: 'dl-din-5008-b', addressTo: Array.from({ length: 12 }, (_, i) => `Line ${i + 1}`) };
    const w = cli(['--json', make(d, tall), path.join(d, 'a.pdf')]);
    assert.equal(w.status, 0);
    assert.ok(w.json.warnings.some((x) => x.code === 'address_too_tall'));
    assert.equal(w.json.layout.tooTall, true);
    const s = cli(['--json', '--strict', make(d, tall), path.join(d, 'b.pdf')]);
    assert.equal(s.status, 3);
    assert.equal(s.json.error.code, 'layout_problems');
    assert.equal(fs.existsSync(path.join(d, 'b.pdf')), false);
    const wide = cli(['--json', make(d, { addressTo: 'W'.repeat(80) }), path.join(d, 'c.pdf')]);
    assert.ok(wide.json.warnings.some((x) => x.code === 'address_too_wide'));
    const clean = cli(['--json', '--strict', make(d, { addressTo: ['A', 'B'] }), path.join(d, 'e.pdf')]);
    assert.equal(clean.status, 0);
  } finally { rm(d); }
});

test('unicode names build: Welsh, Polish and Turkish letters use the wider font; what no font has is reported', () => {
  const d = tmp();
  try {
    const good = cli(['--json', make(d, { firmName: 'Cyfreithwyr Ŵyr', addressTo: ['Mr Łukasz Wiśniewski', 'Ms Şule Öztürk', 'Ms Zoë O’Brien'] }), path.join(d, 'u.pdf')]);
    assert.equal(good.status, 0, good.stdout);
    assert.deepEqual(good.json.layout.unprintable, []);
    if (hasPoppler) assert.ok(textOf(path.join(d, 'u.pdf')).includes('Łukasz Wiśniewski'));
    const cjk = cli(['--json', make(d, { addressTo: '你好 Ms A' }), path.join(d, 'c.pdf')]);
    assert.equal(cjk.status, 0);
    assert.ok(cjk.json.warnings.some((x) => x.code === 'unprintable_characters'));
    const rtl = cli(['--json', make(d, { addressTo: 'مرحبا' }), path.join(d, 'r.pdf')]);
    assert.ok(rtl.json.warnings.some((x) => x.code === 'right_to_left_text'));
  } finally { rm(d); }
});

test('address and footer may be a string with newlines or a list of lines, with the same result', async () => {
  const d = tmp();
  try {
    cli([make(d, { addressTo: 'A\nB\nC', footerLines: 'X\nY' }, 'a.json'), path.join(d, 'a.pdf')]);
    cli([make(d, { addressTo: ['A', 'B', 'C'], footerLines: ['X', 'Y'] }, 'b.json'), path.join(d, 'b.pdf')]);
    assert.equal(await stream(fs.readFileSync(path.join(d, 'a.pdf'))), await stream(fs.readFileSync(path.join(d, 'b.pdf'))));
  } finally { rm(d); }
});

test('wrong types and values are refused with a code and the field name', () => {
  const d = tmp();
  try {
    const cases = [
      [{ firmName: 5 }, 'invalid_field_type', 'firmName'], [{ addressTo: { a: 1 } }, 'invalid_field_type', 'addressTo'],
      [{ addressTo: ['ok', 3] }, 'invalid_field_type', 'addressTo'], [{ showGuides: 'yes' }, 'invalid_field_type', 'showGuides'],
      [{ accent: 'blue' }, 'invalid_field_value', 'accent'], [{ accent: '#12345' }, 'invalid_field_value', 'accent'],
      [{ firmName: 'two\nlines' }, 'invalid_field_value', 'firmName'], [{ envelope: 7 }, 'invalid_field_type', 'envelope'],
      [{ logo: 'x.png' }, 'invalid_field_type', 'logo'], [{ logo: {} }, 'invalid_field_type', 'logo.path'],
      [{ logo: { path: 'x.png', shape: 'star' } }, 'invalid_field_value', 'logo.shape'], [{ logo: { path: 'x.png', sizeMm: '16' } }, 'invalid_field_type', 'logo.sizeMm'],
      [{ logo: { path: 'x.png', extra: 1 } }, 'unknown_key', 'logo.extra'], [{ schemaVersion: 2 }, 'unsupported_schema_version', 'schemaVersion'],
      [{ output: '../x.pdf' }, 'invalid_output_name', 'output'], [{ output: 'x.txt' }, 'invalid_output_name', 'output'],
    ];
    for (const [req, code, field] of cases) {
      const r = cli(['--json', make(d, req), path.join(d, 'o.pdf')]);
      assert.equal(r.status, 3, JSON.stringify(req));
      assert.equal(r.json.error.code, code, JSON.stringify(req));
      assert.equal(r.json.error.details?.path, field, JSON.stringify(req));
    }
    assert.equal(cli(['--json', make(d, '[]', 'e.json'), path.join(d, 'o')]).json.error.code, 'invalid_request');
    assert.equal(cli(['--json', make(d, '"text"', 'e.json'), path.join(d, 'o.pdf')]).json.error.code, 'invalid_request');
    assert.equal(cli(['--json', make(d, 'null', 'e.json'), path.join(d, 'o.pdf')]).json.error.code, 'invalid_request');
  } finally { rm(d); }
});

// ── Logos ───────────────────────────────────────────────────────────────────

test('PNG and JPEG logos, square and circle, at several sizes, all build; the size is clamped with a warning', async () => {
  const d = tmp();
  try {
    fs.writeFileSync(path.join(d, 'logo.png'), fx.makePng(60, 40));
    fs.writeFileSync(path.join(d, 'logo.dat'), makeJpeg(60, 40));   // the extension is not looked at
    const sizes = [];
    for (const logo of ['logo.png', 'logo.dat']) {
      for (const shape of ['square', 'circle']) {
        const out = path.join(d, `${logo}-${shape}.pdf`);
        const r = cli(['--json', make(d, { firmName: 'Firm', logo: { path: logo, shape, sizeMm: 20 } }), out]);
        assert.equal(r.status, 0, r.stdout);
        sizes.push(fs.statSync(out).size);
        assert.equal((await pageInfo(fs.readFileSync(out))).pages, 1);
      }
    }
    const plain = cli(['--json', make(d, { firmName: 'Firm' }), path.join(d, 'plain.pdf')]);
    assert.ok(fs.statSync(path.join(d, 'plain.pdf')).size < Math.min(...sizes), 'a logo adds to the file');
    const big = cli(['--json', make(d, { logo: { path: 'logo.png', sizeMm: 99 } }), path.join(d, 'big.pdf')]);
    assert.equal(big.status, 0);
    assert.ok(big.json.warnings.some((w) => w.code === 'logo_size_clamped' && /30/.test(w.message)));
    const small = cli(['--json', make(d, { logo: { path: 'logo.png', sizeMm: 2 } }), path.join(d, 'small.pdf')]);
    assert.ok(small.json.warnings.some((w) => w.code === 'logo_size_clamped' && /8/.test(w.message)));
    // On DIN Form A the window starts high, so a large logo is scaled down and that is reported.
    const scaled = cli(['--json', make(d, { envelope: 'dl-din-5008-a', logo: { path: 'logo.png', sizeMm: 30 } }), path.join(d, 'sc.pdf')]);
    assert.ok(scaled.json.warnings.some((w) => w.code === 'logo_scaled'));
    assert.equal(cli(['--json', '--strict', make(d, { envelope: 'dl-din-5008-a', logo: { path: 'logo.png', sizeMm: 30 } }), path.join(d, 'sc2.pdf')]).status, 0, 'a scaled logo is an adaptation, not a strict failure');
    const rotated = fs.writeFileSync(path.join(d, 'rot.jpg'), makeJpeg(60, 40, 6));
    void rotated;
    const r = cli(['--json', make(d, { logo: { path: 'rot.jpg' } }), path.join(d, 'rot.pdf')]);
    assert.equal(r.status, 0);
    assert.ok(!r.json.warnings.some((w) => w.code === 'logo_orientation_not_applied'), 'a rotated JPEG is drawn upright, so there is nothing to warn about');
  } finally { rm(d); }
});

test('bad logos are refused: too big, not a picture, corrupt, missing, a folder', () => {
  const d = tmp();
  try {
    fs.writeFileSync(path.join(d, 'big.png'), Buffer.concat([fx.makePng(4, 4), Buffer.alloc(4 * 1024 * 1024)]));
    fs.writeFileSync(path.join(d, 'note.png'), 'this is not a picture at all');
    fs.writeFileSync(path.join(d, 'corrupt.png'), Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('garbage garbage garbage')]));
    fs.writeFileSync(path.join(d, 'corrupt.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02]));
    fs.writeFileSync(path.join(d, 'gif.png'), Buffer.from('GIF89a......'));
    fs.mkdirSync(path.join(d, 'folder'));
    for (const [p, code] of [['big.png', 'logo_too_large'], ['note.png', 'logo_unsupported_type'], ['gif.png', 'logo_unsupported_type'],
      ['corrupt.png', 'logo_invalid'], ['corrupt.jpg', 'logo_invalid'], ['missing.png', 'logo_not_found'], ['folder', 'logo_not_found']]) {
      const r = cli(['--json', make(d, { logo: { path: p } }), path.join(d, 'o.pdf')]);
      assert.equal(r.status, 3, p);
      assert.equal(r.json.error.code, code, p);
      assert.equal(fs.existsSync(path.join(d, 'o.pdf')), false, `${p}: nothing written`);
    }
  } finally { rm(d); }
});

test('a logo path can never leave the base folder: dot dots, absolute paths, symbolic links', () => {
  const d = tmp();
  const outside = tmp();
  try {
    fs.writeFileSync(path.join(outside, 'secret.png'), fx.makePng(8, 8));
    const inner = path.join(d, 'req'); fs.mkdirSync(inner);
    fs.writeFileSync(path.join(d, 'up.png'), fx.makePng(8, 8));
    fs.symlinkSync(path.join(outside, 'secret.png'), path.join(inner, 'link.png'));
    fs.symlinkSync(outside, path.join(inner, 'dirlink'));
    for (const p of ['../up.png', path.join(outside, 'secret.png'), 'link.png', 'dirlink/secret.png', '/etc/passwd', '..']) {
      const r = cli(['--json', make(inner, { logo: { path: p } }), path.join(d, 'o.pdf')]);
      assert.equal(r.status, 3, p);
      assert.equal(r.json.error.code, 'path_outside_base', p);
      assert.equal(fs.existsSync(path.join(d, 'o.pdf')), false);
    }
    // Inside the folder is fine, and --base-dir widens it on purpose.
    fs.writeFileSync(path.join(inner, 'ok.png'), fx.makePng(8, 8));
    assert.equal(cli(['--json', make(inner, { logo: { path: 'ok.png' } }), path.join(d, 'ok.pdf')]).status, 0);
    assert.equal(cli(['--json', '--base-dir', d, make(inner, { logo: { path: 'up.png' } }), path.join(d, 'up.pdf')]).status, 0);
    assert.equal(cli(['--json', '--base-dir', path.join(d, 'nope'), make(inner, {}), path.join(d, 'x.pdf')]).json.error.code, 'base_dir_not_found');
    assert.equal(cli(['--json', make(inner, { logo: { path: 'a\0b.png' } }), path.join(d, 'z.pdf')]).status, 3);
  } finally { rm(d); rm(outside); }
});

// ── Input and output places ─────────────────────────────────────────────────

test('the request can arrive on standard input, and a missing or oversize request is refused', () => {
  const d = tmp();
  try {
    fs.writeFileSync(path.join(d, 'logo.png'), fx.makePng(8, 8));
    const viaStdin = cli(['--json', '-', path.join(d, 'o.pdf')], { input: JSON.stringify({ firmName: 'Piped', logo: { path: 'logo.png' } }), cwd: d });
    assert.equal(viaStdin.status, 0, viaStdin.stdout);
    assert.equal(cli(['--json', path.join(d, 'nope.json'), path.join(d, 'o.pdf')]).json.error.code, 'request_not_found');
    const huge = make(d, ' '.repeat(2 * 1024 * 1024 + 1), 'huge.json');
    assert.equal(cli(['--json', huge, path.join(d, 'o.pdf')]).json.error.code, 'request_too_large');
    assert.equal(cli(['--json', '-', path.join(d, 'o.pdf')], { input: '{', cwd: d }).json.error.code, 'invalid_json');
  } finally { rm(d); }
});

test('the output must be a .pdf file whose folder exists (single), or a folder (batch)', () => {
  const d = tmp();
  try {
    const req = make(d, {});
    assert.equal(cli(['--json', req, path.join(d, 'o.txt')]).json.error.code, 'invalid_output_name');
    assert.equal(cli(['--json', req, path.join(d, 'no', 'such', 'o.pdf')]).json.error.code, 'output_dir_missing');
    assert.equal(cli(['--json', make(d, [{}], 'b.json'), path.join(d, 'made', 'here')]).status, 0);
    assert.ok(fs.existsSync(path.join(d, 'made', 'here', 'envelope-001.pdf')), 'a batch folder is created');
  } finally { rm(d); }
});

// ── Batches ─────────────────────────────────────────────────────────────────

test('a batch writes one PDF per request; a bad request is reported and skipped, the others still written, exit 3', () => {
  const d = tmp();
  try {
    const out = path.join(d, 'out');
    const r = cli(['--json', make(d, [
      { addressTo: 'One', output: 'first.pdf' },
      { envelope: 'nope' },
      { addressTo: 'Three', envelope: 'c5' },
      { addressTo: 'Four', output: 'FIRST.pdf' },
      { addressTo: 'Five', logo: { path: '../up.png' } },
    ]), out]);
    assert.equal(r.status, 3);
    assert.equal(r.json.ok, false);
    assert.equal(r.json.mode, 'batch');
    assert.equal(r.json.succeeded, 2);
    assert.equal(r.json.failed, 3);
    assert.equal(r.json.error.code, 'items_failed');
    assert.deepEqual(r.json.items.map((i) => i.ok), [true, false, true, false, false]);
    assert.equal(r.json.items[1].error.code, 'unknown_envelope');
    assert.equal(r.json.items[3].error.code, 'duplicate_output');
    assert.equal(r.json.items[4].error.code, 'path_outside_base');
    assert.deepEqual(fs.readdirSync(out).sort(), ['envelope-003.pdf', 'first.pdf'], 'good ones written, named by position or by output');
    assert.equal(r.json.items[0].output, path.join(out, 'first.pdf'));
  } finally { rm(d); }
});

test('a clean batch is ok with exit 0, deterministic names, and one item per request', async () => {
  const d = tmp();
  try {
    const out = path.join(d, 'out');
    const req = Array.from({ length: 12 }, (_, i) => ({ addressTo: [`Recipient ${i + 1}`, '1 Road', 'London'], envelope: ENVELOPE_IDS[i % ENVELOPE_IDS.length] }));
    const r = cli(['--json', make(d, req), out]);
    assert.equal(r.status, 0);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.succeeded, 12);
    assert.equal(r.json.failed, 0);
    assert.deepEqual(fs.readdirSync(out).sort(), Array.from({ length: 12 }, (_, i) => `envelope-${String(i + 1).padStart(3, '0')}.pdf`));
    if (hasPoppler) assert.ok(textOf(path.join(out, 'envelope-007.pdf')).includes('Recipient 7'));
    // Again into the same folder: the same names, overwritten, not piled up.
    assert.equal(cli(['--json', make(d, req), out]).status, 0);
    assert.equal(fs.readdirSync(out).length, 12);
    const bytes = await pageInfo(fs.readFileSync(path.join(out, 'envelope-012.pdf')));
    assert.equal(bytes.pages, 1);
  } finally { rm(d); }
});

test('an empty batch and one over the limit are refused', () => {
  const d = tmp();
  try {
    assert.equal(cli(['--json', make(d, []), path.join(d, 'o')]).json.error.code, 'invalid_request');
    const many = cli(['--json', make(d, new Array(501).fill({})), path.join(d, 'o')]);
    assert.equal(many.status, 3);
    assert.equal(many.json.error.code, 'invalid_request');
  } finally { rm(d); }
});

// ── Schema and parity ───────────────────────────────────────────────────────

test('the JSON Schema names exactly the keys and envelopes the CLI accepts', () => {
  const req = SCHEMA.$defs.request;
  assert.deepEqual(Object.keys(req.properties).sort(), [...REQUEST_KEYS].sort());
  assert.deepEqual(Object.keys(req.properties.logo.properties).sort(), [...LOGO_KEYS].sort());
  assert.deepEqual([...req.properties.envelope.enum].sort(), [...ENVELOPE_IDS].sort());
  assert.equal(req.additionalProperties, false);
  assert.equal(req.properties.logo.additionalProperties, false);
  assert.equal(req.properties.firmName.maxLength, FIELD_LIMITS.firmName);
  assert.equal(req.properties.strapline.maxLength, FIELD_LIMITS.strapline);
  assert.equal(req.properties.senderLine.maxLength, FIELD_LIMITS.senderLine);
  assert.equal(req.properties.addressTo.oneOf[0].maxLength, FIELD_LIMITS.addressTo);
  assert.equal(req.properties.footerLines.oneOf[0].maxLength, FIELD_LIMITS.footerLines);
  assert.equal(SCHEMA.$id.endsWith('-1.json'), true);
  assert.throws(() => checkRequest({ zzz: 1 }), (e) => e instanceof RequestError && e.code === 'unknown_key');
});

/** All of a page's content stream bytes, decoded, so two sheets can be compared without their dates and ids. */
async function stream(bytes) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r instanceof PDFRef ? r : r)) : [contents];
  return streams.map((s) => Buffer.from(decodePDFRawStream(s).decode()).toString('latin1')).join('\n');
}

test('parity: the CLI draws the same page as the browser\'s makeLetterhead for the same input', async () => {
  const d = tmp();
  try {
    const fonts = {
      regular: new Uint8Array(fs.readFileSync(path.join(FONT_DIR, 'LiberationSans-Regular.ttf'))),
      bold: new Uint8Array(fs.readFileSync(path.join(FONT_DIR, 'LiberationSans-Bold.ttf'))),
    };
    const png = fx.makePng(60, 40);
    fs.writeFileSync(path.join(d, 'logo.png'), png);
    const cases = [
      { envelope: 'dl-din-5008-b', firmName: 'A. Solicitors', strapline: 'Family law', senderLine: 'A. Solicitors, 1 Road, London', addressTo: 'Ms A\n1 Road\nLondon', footerLines: ['Regulated'], showGuides: true, accent: '#ff5500' },
      { envelope: 'c5', addressTo: 'X\nY' },
      { envelope: 'c4', firmName: 'Only a firm' },
      { envelope: 'dl-din-5008-a', firmName: 'Łukasz Ŵyr', addressTo: 'Zoë' },
      { envelope: 'dl-uk', firmName: 'Logo', logoShape: 'circle', logoSizeMm: 22, addressTo: 'Z', _logo: true },
      { envelope: 'dl-uk', firmName: 'Logo', logoShape: 'square', logoSizeMm: 12, addressTo: 'Z', _logo: true },
    ];
    for (const [i, c] of cases.entries()) {
      const { _logo, logoShape, logoSizeMm, ...fields } = c;
      const request = { ...fields, ...(_logo ? { logo: { path: 'logo.png', shape: logoShape, sizeMm: logoSizeMm } } : {}) };
      const out = path.join(d, `cli-${i}.pdf`);
      const r = cli(['--json', make(d, request, `r${i}.json`), out]);
      assert.equal(r.status, 0, r.stdout);
      const direct = await makeLetterhead({
        ...fields, footerLines: fields.footerLines ?? [], logoShape: logoShape ?? 'square', logoSizeMm: logoSizeMm ?? 16,
        logo: _logo ? { bytes: new Uint8Array(png), type: 'png' } : null, fonts,
      });
      assert.equal(await stream(fs.readFileSync(out)), await stream(direct), `case ${i}: the drawing instructions are identical`);
      const a = await pageInfo(fs.readFileSync(out)); const b = await pageInfo(direct);
      assert.deepEqual(a, b);
      if (spawnSync('pdftoppm', ['-v']).error === undefined) {
        const render = (bytes, name) => { const f = path.join(d, name); fs.writeFileSync(f, bytes); spawnSync('pdftoppm', ['-r', '40', '-png', '-singlefile', f, f.replace(/\.pdf$/, '')]); return fs.readFileSync(f.replace(/\.pdf$/, '.png')); };
        assert.ok(render(fs.readFileSync(out), `pa${i}.pdf`).equals(render(direct, `pb${i}.pdf`)), `case ${i}: the rendered pixels are identical`);
      }
    }
  } finally { rm(d); }
});
