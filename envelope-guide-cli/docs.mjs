/**
 * Envelope Guide CLI: the tool describing itself (`envelope-guide --help`, its topics, the README tables). One
 * description, built from the request module's own tables (fields, limits, envelope presets); only the one-line
 * meaning of each field, error and warning is written here, and the CLI help tests fail when a field,
 * a preset, a thrown code or an example is missing or out of date.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ENVELOPES } from '../static/js/envelope-guide/envelopes.js';
import { FIELD_LIMITS } from '../static/js/envelope-guide/history.js';
import { REQUEST_KEYS, LOGO_KEYS, LOGO_MAX_BYTES, LOGO_SIZE_MM, MAX_BATCH, ENVELOPE_IDS, LOGO_MAX_PIXELS } from './request.mjs';

export const ERRORS = [
  { code: 'request_not_found', exit: 3, meaning: 'The request file could not be read.' },
  { code: 'request_too_large', exit: 3, meaning: 'The request is over 2 MB.' },
  { code: 'invalid_json', exit: 3, meaning: 'The request is not valid JSON.' },
  { code: 'invalid_request', exit: 3, meaning: 'The request is not a JSON object (or a non-empty array of objects for a batch), or a batch has too many items.' },
  { code: 'unknown_key', exit: 3, meaning: 'The request, or its logo object, has a key this version does not know.' },
  { code: 'unsupported_schema_version', exit: 3, meaning: 'schemaVersion is present and is not 1.' },
  { code: 'unknown_envelope', exit: 3, meaning: 'The envelope id is not one of the presets (see --help envelopes).' },
  { code: 'invalid_field_type', exit: 3, meaning: 'A field has the wrong kind of value (a number where text is wanted, and so on).' },
  { code: 'invalid_field_value', exit: 3, meaning: 'A field has a value it may not have (a colour that is not #rrggbb, a logo shape that is not square or circle, a name over one line).' },
  { code: 'invalid_output_name', exit: 3, meaning: 'An output name is not a plain file name ending in .pdf.' },
  { code: 'duplicate_output', exit: 3, meaning: 'Two requests in a batch would write the same file.' },
  { code: 'base_dir_not_found', exit: 3, meaning: 'The base folder for logo paths does not exist.' },
  { code: 'path_outside_base', exit: 3, meaning: 'A logo path climbs out of the base folder, by .., an absolute path or a symbolic link.' },
  { code: 'logo_not_found', exit: 3, meaning: 'The logo file is not there, or is not a file.' },
  { code: 'logo_too_large', exit: 3, meaning: 'The logo file is over 4 MB.' },
  { code: 'logo_too_many_pixels', exit: 3, meaning: 'The logo picture has more pixels than the limit, judged from its header before anything decodes it.' },
  { code: 'logo_unsupported_type', exit: 3, meaning: 'The logo is not a PNG or a JPEG (the file\'s bytes are checked, not its name).' },
  { code: 'logo_invalid', exit: 3, meaning: 'The logo is damaged or cannot be embedded.' },
  { code: 'output_dir_missing', exit: 3, meaning: 'The folder the output file would go in does not exist.' },
  { code: 'layout_problems', exit: 3, meaning: 'With --strict: the layout has a problem (see the layout warnings) and nothing was written for that sheet.' },
  { code: 'items_failed', exit: 3, meaning: 'A batch: at least one request failed. The others were still written; items[] says which.' },
  { code: 'build_failed', exit: 1, meaning: 'The sheet could not be built, though the request was accepted.' },
  { code: 'output_write_failed', exit: 1, meaning: 'The finished PDF could not be written.' },
];
export const WARNINGS = [
  { code: 'field_truncated', meaning: 'A text field was longer than the page allows and was cut (firmName, strapline, senderLine 200; addressTo 2000; footerLines 1000 characters).' },
  { code: 'legacy_envelope_id', meaning: 'An old envelope id (dl-din-a, dl-din-b) was accepted and mapped to today\'s preset.' },
  { code: 'logo_size_clamped', meaning: 'logo.sizeMm was outside 8 to 30 mm and was set to the nearest limit.' },
  { code: 'logo_scaled', meaning: 'The logo was made smaller so none of it shows through the window.' },
  { code: 'address_too_tall', meaning: 'The address has more lines than the window holds.' },
  { code: 'address_too_wide', meaning: 'An address or sender line is wider than the window.' },
  { code: 'masthead_too_wide', meaning: 'The firm name or strapline runs past the right margin.' },
  { code: 'footer_too_wide', meaning: 'A footer line runs past the margins.' },
  { code: 'footer_too_tall', meaning: 'The footer has more lines than fit above the printer\'s dead zone.' },
  { code: 'unprintable_characters', meaning: 'No font can draw some characters; each is drawn as ?.' },
  { code: 'right_to_left_text', meaning: 'Right-to-left text is drawn left to right, so it prints reversed.' },
  { code: 'engine_warning', meaning: 'The PDF engine warned about something.' },
];

const FIELD_TEXT = {
  schemaVersion: ['number', 'Optional. 1.'],
  _comment: ['text', 'Ignored. For your own notes.'],
  output: ['file name', 'Batch only: the name of this sheet\'s PDF, a plain name ending in .pdf with no folder in front (the folder is the command line\'s <output>). Left out, sheets are named envelope-001.pdf, envelope-002.pdf and so on.'],
  envelope: [`one of ${ENVELOPE_IDS.join(', ')}`, 'The window envelope the address is placed for. Default dl-din-5008-b. See --help envelopes.'],
  firmName: ['one line of text', `The masthead name at the top left, up to ${FIELD_LIMITS.firmName} characters.`],
  strapline: ['one line of text', `A line under the firm name, up to ${FIELD_LIMITS.strapline} characters.`],
  senderLine: ['one line of text', `The small return address above the window, up to ${FIELD_LIMITS.senderLine} characters.`],
  addressTo: ['text or a list of lines', `The address for the window, one line per newline or list item, up to ${FIELD_LIMITS.addressTo} characters.`],
  footerLines: ['text or a list of lines', `Lines at the foot of the sheet, up to ${FIELD_LIMITS.footerLines} characters.`],
  showGuides: ['true or false', 'true prints the window outline and full-width fold lines. Default false.'],
  accent: ['colour #rrggbb', 'The colour of the firm name, the rule under the sender line and the guides. Default #1a4f8c.'],
  logo: ['object', 'A logo picture: { path, shape, sizeMm }.'],
};
const LOGO_TEXT = {
  path: ['file name', `A PNG or JPEG of at most ${LOGO_MAX_BYTES / 1024 / 1024} MB and ${LOGO_MAX_PIXELS / 1e6} million pixels, inside the base folder (the request file's folder, or --base-dir). Bytes are checked, not the name. Embedded as it is.`],
  shape: ['square or circle', 'square (default) or circle (the logo is cropped to a circle).'],
  sizeMm: [`number ${LOGO_SIZE_MM.min} to ${LOGO_SIZE_MM.max}`, `The logo's height and width in millimetres. Default ${LOGO_SIZE_MM.default}; outside the range it is clamped with a warning.`],
};

const readJson = (relative) => JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8'));

const REQUEST_EXAMPLE = {
  schemaVersion: 1, envelope: 'c5', firmName: 'A. Solicitors', strapline: 'Family and children law',
  senderLine: 'A. Solicitors, 1 Example Street, London E1 1AA', addressTo: ['Ms A Sample', '12 Example Road', 'London', 'E1 1AA'],
  footerLines: ['Regulated by the SRA'],
};

export const EXAMPLES = [
  { title: 'One envelope sheet', args: ['--json', 'request.json', 'envelope.pdf'], files: { 'request.json': REQUEST_EXAMPLE } },
  {
    title: 'A batch: one PDF per request, into a folder',
    args: ['--json', 'batch.json', 'sheets'],
    files: { 'batch.json': [{ ...REQUEST_EXAMPLE, output: 'ms-sample.pdf' }, { ...REQUEST_EXAMPLE, envelope: 'c4', addressTo: ['Mr B Example', '4 Sample Lane', 'Leeds', 'LS1 1AA'], output: 'mr-example.pdf' }] },
    note: 'The folder is made if it does not exist. A bad request does not stop the others; the answer lists every item.',
  },
  { title: 'The request from standard input (use - in place of the file name)', args: ['--json', '-', 'stdin.pdf'], stdinFile: 'request.json', files: { 'request.json': REQUEST_EXAMPLE }, note: 'A logo path in a request read from standard input is looked for in the current folder, or in --base-dir.' },
  { title: 'Refuse any layout problem instead of warning about it', args: ['--json', '--strict', 'request.json', 'strict.pdf'], files: { 'request.json': REQUEST_EXAMPLE }, note: 'With --strict a request whose text is too wide or whose address is too tall fails with layout_problems and writes nothing.' },
];

export function buildDoc({ version }) {
  const envelopeRows = ENVELOPE_IDS.map((id) => {
    const e = ENVELOPES[id];
    return { name: id, text: `${e.label}. ${e.fold}. Window ${e.window.w} × ${e.window.h} mm, ${e.window.y} mm down. ${e.note}` };
  });
  const requestRows = [
    ...REQUEST_KEYS.map((k) => ({ name: k, text: `${FIELD_TEXT[k][0]}. ${FIELD_TEXT[k][1]}` })),
    ...LOGO_KEYS.map((k) => ({ name: `logo.${k}`, text: `${LOGO_TEXT[k][0]}. ${LOGO_TEXT[k][1]}` })),
  ];
  return {
    tool: 'envelope-guide', version,
    summary: ['make the Envelope Guide sheet as a PDF from a JSON request',
      'The same sheet as the Envelope Guide page: masthead, sender line, and the address placed to show through a window envelope.'],
    usage: ['envelope-guide [--json] [--strict] [--base-dir <dir>] <request.json | -> <output>', 'envelope-guide --schema | --version', 'envelope-guide --help [topic]'],
    options: [
      ['--json', 'Write exactly one JSON object to stdout, on success and on failure, and nothing else.'],
      ['--strict', 'Treat layout problems (text too wide, address too tall, unprintable characters) as failures.'],
      ['--base-dir <d>', 'The folder a logo path must stay inside (default: the request file\'s folder, or the current folder for standard input).'],
      ['--schema', 'Print the request\'s JSON Schema.'],
      ['--help [topic]', `A short overview, or the detail of a topic: ${[...Object.keys({ request: 1, envelopes: 1 }), 'errors', 'examples', 'schema'].join(', ')}.`],
      ['--version', 'Print the version.'],
    ],
    inputs: [
      `<request.json> is one request object (writes the PDF at <output>) or an array of up to ${MAX_BATCH} requests (a batch: <output> is a folder, one PDF per request). A - reads the request from standard input.`,
      `A logo is a PNG or JPEG of at most ${LOGO_MAX_BYTES / 1024 / 1024} MB, inside the base folder. Requests are data only: nothing in one is run.`,
    ],
    errors: ERRORS, warnings: WARNINGS,
    topics: {
      request: { title: 'The request: field, kind, meaning (the full format is in --schema)', rows: requestRows },
      envelopes: { title: 'Envelope presets (the request\'s "envelope"): id, then the envelope', rows: envelopeRows },
    },
    examples: EXAMPLES,
    schema: readJson('./request.schema.json'),
    requestRows, envelopeRows,
  };
}
