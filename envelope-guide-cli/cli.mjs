#!/usr/bin/env node
/**
 * Envelope Guide CLI
 * Copyright (c) 2026 CaseForge
 * Licensed under the Mozilla Public License Version 2.0 (the "License"); you may not use this file except in
 * compliance with the License. You may obtain a copy of the License at http://mozilla.org/MPL/2.0/.
 *
 * cli.mjs
 * Makes the Envelope Guide sheet (masthead, sender line, the address block placed for a window envelope, footer)
 * as a PDF from a JSON request, with the same makeLetterhead() the browser page calls: no browser, no server.
 *
 *   envelope-guide [--json] [--strict] [--base-dir <dir>] <request.json | -> <output>
 *
 * A request object writes the PDF at <output>. A JSON array of request objects is a batch: <output> is a folder
 * and each request writes its own PDF into it (its "output" name, else envelope-001.pdf, envelope-002.pdf, ...).
 * The command line contract (exit codes, --json, error codes) is the one the other CaseForge command line tools
 * keep: see scripts/cli-contract.mjs and README.md here. Every input is data: JSON.parse only, no eval, and a
 * logo path must resolve, symbolic links included, to a file inside the base folder (the request file's folder
 * unless --base-dir says otherwise).
 */
import { readFile, writeFile, mkdir, realpath, stat } from 'node:fs/promises';
import { dirname, resolve, join, sep } from 'node:path';
import { EXIT, CliError, parseArgs, readName, readVersion, runCli, helpResult, readStdinText } from '../scripts/cli-contract.mjs';
import { checkRequest, layoutWarnings, sniffLogo, logoSize, LOGO_MAX_PIXELS, RequestError, SCHEMA_VERSION, LOGO_MAX_BYTES, MAX_BATCH, ENVELOPE_IDS } from './request.mjs';

const TOOL = readName(new URL('./package.json', import.meta.url));
const VERSION = readVersion(new URL('./package.json', import.meta.url));
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const FONT_DIR = process.env.ENVELOPE_GUIDE_FONT_DIR
  || new URL('../static/fonts/liberation-sans/', import.meta.url).pathname;

/** The tool's description of itself (help, topics, README tables): docs.mjs. */
const buildHelpDoc = async () => (await import('./docs.mjs')).buildDoc({ version: VERSION });

/** A logo file inside the base folder, checked the way the browser checks an upload. Throws RequestError. */
async function readLogo(engine, baseReal, logoPath, field = 'logo.path') {
  if (logoPath.includes('\0')) throw new RequestError('invalid_field_value', 'logo.path has an invalid character.', field);
  // Lexical check first, so a path that climbs out is refused the same way whether or not the file exists.
  const wanted = resolve(baseReal, logoPath);
  if (wanted !== baseReal && !wanted.startsWith(baseReal + sep)) {
    throw new RequestError('path_outside_base', `The logo ${JSON.stringify(logoPath.slice(0, 80))} is outside the base folder, so it was not read.`, field);
  }
  let real;
  try { real = await realpath(wanted); } catch {
    throw new RequestError('logo_not_found', `The logo ${JSON.stringify(logoPath.slice(0, 80))} was not found.`, field);
  }
  if (real !== baseReal && !real.startsWith(baseReal + sep)) {
    throw new RequestError('path_outside_base', `The logo ${JSON.stringify(logoPath.slice(0, 80))} resolves outside the base folder, so it was not read.`, field);
  }
  const info = await stat(real);
  if (!info.isFile()) throw new RequestError('logo_not_found', `The logo ${JSON.stringify(logoPath.slice(0, 80))} is not a file.`, field);
  if (info.size > LOGO_MAX_BYTES) throw new RequestError('logo_too_large', 'The logo is over 4 MB. A logo should be far smaller.', field);
  const bytes = new Uint8Array(await readFile(real));
  const type = sniffLogo(bytes);
  if (!type) throw new RequestError('logo_unsupported_type', 'The logo must be a PNG or a JPEG picture (the file name is not looked at, the contents are).', field);
  // A picture with more pixels than any logo needs is refused from its header, before anything decodes it.
  const dims = logoSize(bytes, type);
  if (dims && dims.width * dims.height > LOGO_MAX_PIXELS) {
    throw new RequestError('logo_too_many_pixels', `The logo has ${(dims.width * dims.height / 1e6).toFixed(0)} million pixels; the most accepted is ${LOGO_MAX_PIXELS / 1e6} million. A logo should be far smaller.`, field);
  }
  if (!(await engine.logoIsUsable(bytes, type))) throw new RequestError('logo_invalid', 'The logo is not a valid PNG or JPEG picture, so it was not used.', field);
  // A rotated JPEG (EXIF orientation 2 to 8) is drawn upright by a transform: the browser redraws it on a canvas, which Node has not.
  const orientation = type === 'jpg' ? engine.jpegOrientation(bytes) : 1;
  return { logo: { bytes, type, orientation }, warnings: [] };
}

let fontCache;
async function loadFonts() {
  if (fontCache !== undefined) return fontCache;
  try {
    const dir = String(FONT_DIR).replace(/\/?$/, '/');
    fontCache = {
      regular: new Uint8Array(await readFile(dir + 'LiberationSans-Regular.ttf')),
      bold: new Uint8Array(await readFile(dir + 'LiberationSans-Bold.ttf')),
    };
  } catch { fontCache = null; }
  return fontCache;
}

/** Builds one request into bytes. Returns {bytes, layout, warnings}; throws RequestError (input) or CliError. */
async function buildOne(engine, baseReal, raw, strict) {
  const { opts, logoPath, output, warnings } = checkRequest(raw);
  let logo = null;
  if (logoPath) {
    const read = await readLogo(engine, baseReal, logoPath);
    logo = read.logo;
    warnings.push(...read.warnings);
  }
  let layout = null;
  let bytes;
  try {
    bytes = await engine.makeLetterhead({ ...opts, logo, fonts: await loadFonts(), onProblems: (p) => { layout = p; } });
  } catch (err) {
    throw new CliError('build_failed', `The sheet could not be built: ${String(err?.message ?? err).slice(0, 200)}`, { exit: EXIT.BUILD });
  }
  const found = layoutWarnings(layout ?? {});
  warnings.push(...found);
  if (strict && found.some((w) => w.code !== 'logo_scaled')) {
    throw new CliError('layout_problems', `Layout problems (--strict): ${found.filter((w) => w.code !== 'logo_scaled').map((w) => w.code).join(', ')}.`, { details: { problems: found.filter((w) => w.code !== 'logo_scaled') } });
  }
  return { bytes, output, envelope: opts.envelope, layout, warnings };
}

async function run(ctx, argv) {
  const args = parseArgs(argv, {
    flags: ['--json', '--strict', '--help', '--version', '--schema'], options: ['--base-dir'], short: { h: '--help', V: '--version' },
  });
  if (args.flags.version) return { body: { version: VERSION, schemaVersion: SCHEMA_VERSION }, text: VERSION };
  const help = await helpResult(args, buildHelpDoc);
  if (help) return help;
  if (args.positionals.length < 2) throw new CliError('usage_missing_arguments', 'Needs <request.json> and <output>. Run with --help.', { exit: EXIT.USAGE });
  if (args.positionals.length > 2) throw new CliError('usage_too_many_arguments', 'Takes exactly two arguments: <request.json> <output>.', { exit: EXIT.USAGE });
  const [requestArg, outputArg] = args.positionals;
  const strict = args.flags.strict === true;

  // ── The request ──
  let text; let requestDir;
  if (requestArg === '-') {
    text = await readStdinText(MAX_REQUEST_BYTES);
    requestDir = process.cwd();
  } else {
    try {
      if ((await stat(resolve(requestArg))).size > MAX_REQUEST_BYTES) throw new CliError('request_too_large', 'The request is larger than 2 MB.');
      text = await readFile(resolve(requestArg), 'utf8');
    } catch (err) {
      if (err instanceof CliError) throw err;
      throw new CliError('request_not_found', `The request ${requestArg} could not be read (${err.code ?? 'error'}).`);
    }
    requestDir = dirname(resolve(requestArg));
  }
  let raw;
  try { raw = JSON.parse(text); } catch { throw new CliError('invalid_json', 'The request is not valid JSON.'); }
  const batch = Array.isArray(raw);
  if (batch && (raw.length === 0 || raw.length > MAX_BATCH)) {
    throw new CliError('invalid_request', `A batch holds 1 to ${MAX_BATCH} requests; this has ${raw.length}.`);
  }
  let baseReal;
  try { baseReal = await realpath(resolve(args.options['base-dir'] ?? requestDir)); } catch { throw new CliError('base_dir_not_found', 'The base folder does not exist.'); }

  // ── Output location ──
  const outputPath = resolve(outputArg);
  if (batch) {
    try { await mkdir(outputPath, { recursive: true }); } catch { throw new CliError('output_dir_missing', `The folder ${outputArg} could not be created.`); }
  } else {
    if (!/\.pdf$/i.test(outputPath)) throw new CliError('invalid_output_name', 'For a single request <output> must be a file name ending in .pdf. For a batch (a JSON array) it is a folder.');
    try { if (!(await stat(dirname(outputPath))).isDirectory()) throw new Error('not a directory'); } catch { throw new CliError('output_dir_missing', `The folder for ${outputArg} does not exist.`); }
  }

  await import('../scripts/node-compat.mjs');
  const engine = { ...(await import('../static/js/envelope-guide/envelope.js')), ...(await import('../static/js/envelope-guide/logo.js')) };

  if (!batch) {
    let built;
    try { built = await buildOne(engine, baseReal, raw, strict); } catch (err) {
      if (err instanceof RequestError) throw new CliError(err.code, err.message, { details: err.path ? { path: err.path } : null });
      throw err;
    }
    try { await writeFile(outputPath, built.bytes); } catch (err) {
      throw new CliError('output_write_failed', `${outputArg} could not be written (${err.code ?? 'error'}).`, { exit: EXIT.BUILD });
    }
    ctx.log(`wrote ${outputArg} (${built.bytes.length} bytes)`);
    for (const w of built.warnings) ctx.warnings.push(w);
    return { body: { schemaVersion: SCHEMA_VERSION, mode: 'single', output: outputPath, bytes: built.bytes.length, pages: 1, envelope: built.envelope, layout: built.layout } };
  }

  // ── A batch: each request stands alone. A bad one is reported and skipped; the good ones are still written. ──
  const items = [];
  const used = new Set();
  let inputFailures = 0; let buildFailures = 0;
  for (let i = 0; i < raw.length; i++) {
    const index = i;
    try {
      const built = await buildOne(engine, baseReal, raw[i], strict);
      const name = built.output ?? `envelope-${String(i + 1).padStart(3, '0')}.pdf`;
      if (used.has(name.toLowerCase())) throw new RequestError('duplicate_output', `The output name ${JSON.stringify(name)} is used by an earlier request.`, 'output');
      used.add(name.toLowerCase());
      const file = join(outputPath, name);
      try { await writeFile(file, built.bytes); } catch (err) {
        throw new CliError('output_write_failed', `${name} could not be written (${err.code ?? 'error'}).`, { exit: EXIT.BUILD });
      }
      items.push({ index, ok: true, output: file, bytes: built.bytes.length, pages: 1, envelope: built.envelope, layout: built.layout, warnings: built.warnings });
    } catch (err) {
      const known = err instanceof RequestError || err instanceof CliError;
      const exit = err instanceof CliError ? err.exit : known ? EXIT.INPUT : EXIT.BUILD;
      if (exit === EXIT.BUILD) buildFailures++; else inputFailures++;
      items.push({
        index, ok: false,
        error: { code: known ? err.code : 'build_failed', message: known ? err.message : `The sheet could not be built: ${String(err?.message ?? err).slice(0, 200)}`, ...(err.path ? { path: err.path } : {}), ...(err.details ? { details: err.details } : {}) },
      });
    }
  }
  const failed = inputFailures + buildFailures;
  const body = { schemaVersion: SCHEMA_VERSION, mode: 'batch', output: outputPath, succeeded: items.length - failed, failed, items };
  if (failed === 0) { ctx.log(`wrote ${items.length} sheet(s) into ${outputArg}`); return { body }; }
  ctx.log(`${failed} of ${items.length} request(s) failed; the others were written`);
  return {
    exit: inputFailures > 0 ? EXIT.INPUT : EXIT.BUILD,
    body,
    error: { code: 'items_failed', message: `${failed} of ${items.length} requests failed; the others were written. See items.` },
  };
}

const argv = process.argv.slice(2);
await runCli({ tool: TOOL, version: VERSION, json: argv.includes('--json'), main: (ctx) => run(ctx, argv) });
