/**
 * Window-envelope geometry.
 *
 * Every measurement is in MILLIMETRES from the top-left of a portrait A4
 * sheet, because that is how envelope and paper standards are written and
 * how anyone checking this against a spec sheet will hold it. The PDF is
 * drawn in points; the conversion happens once, at the drawing call.
 *
 * WHY THIS IS A TABLE AND NOT A NUMBER. "Window envelope" is not one thing.
 * DIN 5008 alone has two address-field positions (Form A at 27 mm and Form B
 * at 45 mm from the top), and using the wrong one puts the address behind
 * the paper or folds the sheet in the wrong place. C5 and C4 take the sheet
 * folded differently again, which moves the whole field.
 *
 * The sizes below are the published standards. A manufacturer's envelope can
 * differ (cheap ones do), which a test sheet printed with the window and fold
 * guides shows.
 */

/**
 * Each preset also says where the sender line and the addressee sit INSIDE the
 * window, as millimetres below the window's top edge:
 *   senderBaseline  the small return-address line (a rule is drawn just under it)
 *   addressBaseline the first line of the addressee
 *   linePitch       the distance between address lines (DIN 5008 sets 4.233 mm, so six
 *                   lines fit the 27.3 mm recipient zone)
 * DIN 5008 puts the recipient zone 17.7 mm below the top of the address field
 * (field at 45 mm gives 62.7 mm, field at 27 mm gives 44.7 mm), so the DIN
 * presets start the addressee 17.7 mm down plus the height of the first line.
 * The UK and ISO presets have no such standard, and the addressee sits 9.5 mm
 * down, low enough that a sheet that rides a little high in the envelope still
 * shows the whole address. On UK envelopes the window top falls anywhere from
 * 45 to 57 mm down the sheet.
 * `folds` are the fold marks in mm from the top of the sheet.
 */
export const ENVELOPES = {
  'dl-din-5008-b': {
    // DIN 5008 Form B (the 45 mm address field), named as the current
    // edition of the standard names it.
    label: 'DL, DIN 5008 Form B',
    note: 'The common European window envelope. Address field starts 45 mm down.',
    fold: 'Tri-fold (three panels)',
    folds: [105, 210],
    window: { x: 20, y: 45, w: 85, h: 45 },
    senderBaseline: 14.6,
    addressBaseline: 21.3,
    linePitch: 4.233,
  },
  'dl-din-5008-a': {
    label: 'DL, DIN 5008 Form A',
    note: 'For a shorter letterhead. Address field starts 27 mm down.',
    fold: 'Tri-fold (three panels)',
    folds: [87, 192],
    window: { x: 20, y: 27, w: 85, h: 45 },
    senderBaseline: 14.6,
    addressBaseline: 21.3,
    linePitch: 4.233,
  },
  'dl-uk': {
    label: 'DL, UK Common',
    note: 'The usual UK 110 × 220 mm window position. Not a legal standard (the UK has none), so check against your own stock. Address field starts 47 mm down.',
    fold: 'Tri-fold (three panels)',
    folds: [99, 198],   // 297 / 3
    window: { x: 20, y: 47, w: 90, h: 40 },
    senderBaseline: 4.2,
    addressBaseline: 9.5,
    linePitch: 4.6,
  },
  'c5': {
    label: 'C5 (162 × 229 mm)',
    note: 'The window sits higher because the sheet is only halved.',
    fold: 'Half-fold',
    folds: [148.5],     // 297 / 2
    window: { x: 20, y: 42, w: 90, h: 40 },
    senderBaseline: 4.2,
    addressBaseline: 9.5,
    linePitch: 4.6,
  },
  'c4': {
    label: 'C4 (229 × 324 mm)',
    note: 'The address sits where it falls on the flat sheet.',
    fold: 'Unfolded',
    folds: [],
    window: { x: 20, y: 55, w: 90, h: 40 },
    senderBaseline: 4.2,
    addressBaseline: 9.5,
    linePitch: 4.6,
  },
};

/** The preset a new sheet starts on. */
export const DEFAULT_ENVELOPE = 'dl-din-5008-b';

/**
 * Older envelope ids that history entries saved in people's browsers
 * (envelope-guide-history-v1) can still hold. 'dl-din-a' names the 45 mm
 * field, which is Form B. 'dl-din-b' names the 50 mm field of the earlier
 * edition of the standard; the closest current layout is Form B (45 mm), 5 mm
 * away, where Form A (27 mm) is 23 mm away. Nothing is lost: a restored entry
 * opens on the mapped preset.
 */
export const LEGACY_ENVELOPE_IDS = {
  'dl-din-a': 'dl-din-5008-b',
  'dl-din-b': 'dl-din-5008-b',
};

/** Maps any saved or unknown id to a preset that exists. */
export function resolveEnvelopeId(id) {
  if (ENVELOPES[id]) return id;
  if (LEGACY_ENVELOPE_IDS[id]) return LEGACY_ENVELOPE_IDS[id];
  return DEFAULT_ENVELOPE;
}

/** A4 in millimetres. */
export const A4_MM = { w: 210, h: 297 };

/** Millimetres to PDF points. */
export const MM = 72 / 25.4;

/**
 * Where the sheet folds, in millimetres from the top. Printing a faint mark
 * at these positions is the single most useful thing a letterhead can carry:
 * a letter folded a few millimetres out puts the address off the window even
 * when the address block itself is perfectly placed.
 */
export function foldMarks(key) {
  return ENVELOPES[resolveEnvelopeId(key)].folds.slice();
}

/** The masthead (logo, firm name, strapline) starts this far down the sheet, in mm. */
export const MASTHEAD_TOP = 14;

/** The lowest the masthead may reach, in mm from the top: just above the address window, so nothing of it shows through. */
export function mastheadBottom(key) {
  return ENVELOPES[resolveEnvelopeId(key)].window.y - 1;
}

/**
 * The logo size actually used: the size asked for (8 to 30 mm), made smaller when it would reach into the address
 * window of a preset whose window starts high on the sheet (DIN 5008 Form A, 27 mm). The preview and the PDF both use it.
 */
export function effectiveLogoSize(key, sizeMm) {
  const asked = Math.max(8, Math.min(30, Number(sizeMm) || 16));
  return Math.max(8, Math.min(asked, mastheadBottom(key) - MASTHEAD_TOP));
}

/** Baselines of the firm name and the strapline, in mm from the top, pulled up when the window starts high. */
export function mastheadBaselines(key) {
  const top = ENVELOPES[resolveEnvelopeId(key)].window.y;
  return { firm: Math.min(22, top - 8), strapline: Math.min(29, top - 3) };
}
