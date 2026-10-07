/**
 * The Envelope Guide CLI's request: what a JSON request may contain, and how it is checked.
 *
 * Pure: no file access and no PDF engine, so it can be tested and reused anywhere. Every limit is the one the
 * browser applies (history.js FIELD_LIMITS, the logo's 8 to 30 mm range and 4 MB cap, envelope ids through
 * resolveEnvelopeId), but where the browser quietly cuts or falls back, the CLI reports: a program that sends a
 * request should hear that its text was cut, or its envelope id was not known.
 */
import { RequestError, rejectUnknownKeys } from '../scripts/cli-contract.mjs';
import { ENVELOPES, LEGACY_ENVELOPE_IDS, DEFAULT_ENVELOPE, resolveEnvelopeId } from '../static/js/envelope-guide/envelopes.js';
import { FIELD_LIMITS } from '../static/js/envelope-guide/history.js';

export { RequestError };
export const SCHEMA_VERSION = 1;
export const REQUEST_KEYS = ['schemaVersion', '_comment', 'output', 'envelope', 'firmName', 'strapline', 'senderLine',
  'addressTo', 'footerLines', 'showGuides', 'accent', 'logo'];
export const LOGO_KEYS = ['path', 'shape', 'sizeMm'];
export const LOGO_MAX_BYTES = 4 * 1024 * 1024;

/** The most pixels a logo may have (the page's own limit), read from the file header before anything decodes it. */
export { LOGO_MAX_PIXELS } from '../static/js/envelope-guide/logoSize.js';

/** {width, height} from a JPEG's start-of-frame header, or null. Reads the header only. */
export function jpegSize(bytes) {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) { i += 1; continue; }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null;
    i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
  }
  return null;
}

/** {width, height} from a PNG's IHDR chunk, or null. */
export function pngSize(bytes) {
  if (bytes.length < 24 || bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return null;   // not an IHDR chunk
  const at = (o) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  return { width: at(16), height: at(20) };
}

export function logoSize(bytes, type) { return type === 'jpg' ? jpegSize(bytes) : pngSize(bytes); }
export const LOGO_SIZE_MM = { min: 8, max: 30, default: 16 };
export const MAX_BATCH = 500;
export const ENVELOPE_IDS = Object.keys(ENVELOPES);


const fail = (code, message, path) => { throw new RequestError(code, message, path); };
const show = (v) => JSON.stringify(String(v).slice(0, 60));

function text(value, name, max, warnings) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') fail('invalid_field_type', `${name} must be text.`, name);
  if (value.length > max) {
    warnings.push({ code: 'field_truncated', message: `${name} was longer than ${max} characters and was cut to fit.`, field: name });
    return value.slice(0, max);
  }
  return value;
}

/** A field that is text or a list of lines (joined with newlines), cut to `max` characters. */
function lines(value, name, max, warnings) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) {
    if (value.length > 200) fail('invalid_field_type', `${name} has too many lines.`, name);
    if (value.some((v) => typeof v !== 'string')) fail('invalid_field_type', `${name} must be a list of text lines.`, name);
    return text(value.join('\n'), name, max, warnings);
  }
  return text(value, name, max, warnings);
}

/**
 * Checks one request object and returns the options for makeLetterhead (minus the logo bytes, which the CLI reads
 * from `logo.path`), the logo path, the output name, and any warnings.
 * @throws {RequestError}
 */
export function checkRequest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('invalid_request', 'A request must be a JSON object.');
  rejectUnknownKeys(raw, REQUEST_KEYS);
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== SCHEMA_VERSION) {
    fail('unsupported_schema_version', `schemaVersion is ${JSON.stringify(raw.schemaVersion)}; this version reads schemaVersion ${SCHEMA_VERSION}.`, 'schemaVersion');
  }
  const warnings = [];

  let envelope = DEFAULT_ENVELOPE;
  if (raw.envelope !== undefined) {
    if (typeof raw.envelope !== 'string') fail('invalid_field_type', 'envelope must be text.', 'envelope');
    if (ENVELOPES[raw.envelope]) envelope = raw.envelope;
    else if (LEGACY_ENVELOPE_IDS[raw.envelope]) {
      envelope = resolveEnvelopeId(raw.envelope);
      warnings.push({ code: 'legacy_envelope_id', message: `The envelope id ${show(raw.envelope)} is an old name; ${show(envelope)} was used.`, field: 'envelope' });
    } else fail('unknown_envelope', `Unknown envelope ${show(raw.envelope)}. Known: ${ENVELOPE_IDS.join(', ')}.`, 'envelope');
  }

  const opts = {
    envelope,
    firmName: text(raw.firmName, 'firmName', FIELD_LIMITS.firmName, warnings),
    strapline: text(raw.strapline, 'strapline', FIELD_LIMITS.strapline, warnings),
    senderLine: text(raw.senderLine, 'senderLine', FIELD_LIMITS.senderLine, warnings),
    addressTo: lines(raw.addressTo, 'addressTo', FIELD_LIMITS.addressTo, warnings),
    footerLines: lines(raw.footerLines, 'footerLines', FIELD_LIMITS.footerLines, warnings),
    showGuides: false,
    accent: '#1a4f8c',
    logoShape: 'square',
    logoSizeMm: LOGO_SIZE_MM.default,
  };
  for (const k of ['firmName', 'strapline', 'senderLine']) {
    if (/[\r\n]/.test(opts[k])) fail('invalid_field_value', `${k} must be one line.`, k);
  }
  if (raw.showGuides !== undefined) {
    if (typeof raw.showGuides !== 'boolean') fail('invalid_field_type', 'showGuides must be true or false.', 'showGuides');
    opts.showGuides = raw.showGuides;
  }
  if (raw.accent !== undefined) {
    if (typeof raw.accent !== 'string' || !/^#[0-9a-f]{6}$/i.test(raw.accent)) fail('invalid_field_value', 'accent must be a colour like #1a4f8c.', 'accent');
    opts.accent = raw.accent;
  }

  let logoPath = null;
  if (raw.logo !== undefined && raw.logo !== null) {
    const l = raw.logo;
    if (typeof l !== 'object' || Array.isArray(l)) fail('invalid_field_type', 'logo must be an object with a path.', 'logo');
    for (const k of Object.keys(l)) if (!LOGO_KEYS.includes(k)) fail('unknown_key', `Unknown key ${show(k)} in logo.`, `logo.${k}`);
    if (typeof l.path !== 'string' || !l.path) fail('invalid_field_type', 'logo.path must be a file name.', 'logo.path');
    logoPath = l.path;
    if (l.shape !== undefined) {
      if (l.shape !== 'square' && l.shape !== 'circle') fail('invalid_field_value', 'logo.shape must be "square" or "circle".', 'logo.shape');
      opts.logoShape = l.shape;
    }
    if (l.sizeMm !== undefined) {
      if (typeof l.sizeMm !== 'number' || !Number.isFinite(l.sizeMm)) fail('invalid_field_type', 'logo.sizeMm must be a number.', 'logo.sizeMm');
      const clamped = Math.max(LOGO_SIZE_MM.min, Math.min(LOGO_SIZE_MM.max, l.sizeMm));
      if (clamped !== l.sizeMm) warnings.push({ code: 'logo_size_clamped', message: `logo.sizeMm ${l.sizeMm} is outside ${LOGO_SIZE_MM.min} to ${LOGO_SIZE_MM.max} and was set to ${clamped}.`, field: 'logo.sizeMm' });
      opts.logoSizeMm = clamped;
    }
  }

  let output = null;
  if (raw.output !== undefined) {
    if (typeof raw.output !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,100}\.pdf$/.test(raw.output) || raw.output.includes('..')) {
      fail('invalid_output_name', 'output must be a plain file name ending in .pdf (letters, digits, dot, dash, underscore and space).', 'output');
    }
    output = raw.output;
  }
  return { opts, logoPath, output, warnings };
}

/** What a layout report from makeLetterhead means, as warnings a caller can act on. */
export function layoutWarnings(problems) {
  const w = [];
  if (problems.unprintable?.length) w.push({ code: 'unprintable_characters', message: `No font can draw ${problems.unprintable.map((c) => JSON.stringify(c)).join(' ')}; each was replaced with "?".` });
  if (problems.rtl) w.push({ code: 'right_to_left_text', message: 'Right-to-left text is drawn left to right, so it prints reversed.' });
  if (problems.tooWide?.length) w.push({ code: 'address_too_wide', message: `${problems.tooWide.length} address or sender line(s) are wider than the envelope window.` });
  if (problems.tooTall) w.push({ code: 'address_too_tall', message: `The address has more than the ${problems.maxLines} lines this window holds.` });
  if (problems.mastheadTooWide?.length) w.push({ code: 'masthead_too_wide', message: 'The firm name or strapline runs past the right margin.' });
  if (problems.footerTooWide?.length) w.push({ code: 'footer_too_wide', message: `${problems.footerTooWide.length} footer line(s) run past the margins.` });
  if (problems.footerTooTall) w.push({ code: 'footer_too_tall', message: `The footer has more than the ${problems.maxFooterLines} lines that fit above the printer's dead zone.` });
  if (problems.logoScaled) w.push({ code: 'logo_scaled', message: `The logo was made smaller (${problems.logoScaled.to} mm instead of ${problems.logoScaled.from} mm) so none of it shows through this envelope's window.` });
  return w;
}

/** Sniffs a logo's type from its first bytes; the file name says nothing. */
export function sniffLogo(bytes) {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  return null;
}
