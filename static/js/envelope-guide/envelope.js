/**
 * The envelope guide sheet: an A4 page with the address block placed so it
 * shows through the chosen envelope's window.
 *
 * The drawing function is makeLetterhead(): the sheet is the first page of a
 * letter, masthead and all, with the address placed for the window.
 *
 * Runs entirely in the browser, like the rest of these tools. Nothing is
 * uploaded; the firm's own address is exactly the sort of thing that should
 * not need to be.
 */
import {
  PDFDocument, rgb, StandardFonts,
  pushGraphicsState, popGraphicsState, moveTo, appendBezierCurve, closePath, clip, endPath,
  concatTransformationMatrix, drawObject,
} from '/vendor/cantoo-pdf-lib.js';
import { orientationMatrix, uprightSize } from '/js/shared/exif-orientation.js';
import { missingFrom, drawable } from '/js/shared/font-fallback.js';
import { FONT_BASE } from './paths.js';
import { ENVELOPES, A4_MM, MM, foldMarks, resolveEnvelopeId, DEFAULT_ENVELOPE, MASTHEAD_TOP, effectiveLogoSize, mastheadBaselines } from './envelopes.js';

const INK = rgb(0.12, 0.16, 0.20);
const MUTED = rgb(0.42, 0.46, 0.50);

/** mm from the top -> PDF y (points from the bottom). */
const yAt = (mm) => (A4_MM.h - mm) * MM;

// ── Fonts ──────────────────────────────────────────────────────────────────
// The built-in Helvetica covers Western European text (WinAnsi) and nothing more: Welsh w and y
// with a circumflex, Polish and Turkish letters and the like would print as "?" with no warning.
// So when any text needs more than that, the sheet is drawn in Liberation Sans instead (SIL OFL,
// the metric match for Arial, already shipped for BundleTool's footers), fetched only then so the
// usual sheet costs nothing extra. A character no font here has is replaced by "?" and reported.
const LIBERATION = FONT_BASE;
let liberationBytes = null;

async function loadLiberation(supplied) {
  if (supplied) return supplied;
  if (!liberationBytes) {
    liberationBytes = Promise.all(['LiberationSans-Regular.ttf', 'LiberationSans-Bold.ttf'].map(async (name) => {
      const response = await fetch(LIBERATION + name);
      if (!response.ok) throw new Error(`Could not load ${name}`);
      return new Uint8Array(await response.arrayBuffer());
    })).then(([regular, bold]) => ({ regular, bold })).catch((error) => { liberationBytes = null; throw error; });
  }
  return liberationBytes;
}

/**
 * Chooses the fonts for a sheet: Helvetica when it can draw every character, otherwise Liberation
 * Sans. Returns the fonts and the characters that neither can draw.
 */
async function chooseFonts(doc, texts, supplied) {
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const all = texts.join('\n');
  if (missingFrom(all, helvetica).length === 0) {
    return { reg: helvetica, bold: helveticaBold, unprintable: [], unicode: false };
  }
  try {
    const { regular, bold } = await loadLiberation(supplied);
    const { default: fontkitModule } = await import('/vendor/pdf-lib-fontkit.js');
    doc.registerFontkit(fontkitModule);
    const reg = await doc.embedFont(regular, { subset: true });
    const bld = await doc.embedFont(bold, { subset: true });
    return { reg, bold: bld, unprintable: missingFrom(all, reg), unicode: true };
  } catch {
    // The wider font could not be loaded (offline, blocked): keep Helvetica and say what it cannot draw.
    return { reg: helvetica, bold: helveticaBold, unprintable: missingFrom(all, helvetica), unicode: false };
  }
}

/** Hebrew and Arabic scripts run right to left; the sheet draws every line left to right, so they would print reversed. */
const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u;

/** The longest a masthead or footer line may run, in mm: the page minus the 20 mm margins. */
const MARGIN_MM = 20;
/**
 * Draws an embedded image so that it shows upright inside the box (x, y, w, h) for an EXIF orientation of
 * 1 to 8 (1 draws it as stored). Done with a transform, not by redrawing pixels, so it needs no canvas;
 * the arithmetic lives in the shared static/js/shared/exif-orientation.js, which BundleTool's photo pages use too.
 */
function drawUpright(page, img, orientation, x, y, w, h) {
  if (orientation === 1) { page.drawImage(img, { x, y, width: w, height: h }); return; }
  const name = page.node.newXObject('Logo', img.ref);
  const m = orientationMatrix(orientation, img.width, img.height, x, y, w, h);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...m), drawObject(name), popGraphicsState());
}

/** Footer lines print from 24 mm above the bottom edge upward; the last must stay inside a printer's usable area. */
const FOOTER_FIRST_MM = 24;
const FOOTER_PITCH_MM = 3.6;
const FOOTER_LIMIT_MM = 8;   // a baseline this close to the bottom edge or nearer is in most printers' dead zone

export async function makeLetterhead(opts) {
  const {
    envelope = DEFAULT_ENVELOPE,
    firmName = '', strapline = '',
    addressTo = '',
    senderLine = '',
    footerLines = [],
    showGuides = false,
    accent = '#1a4f8c',
    logo = null,          // { bytes: Uint8Array, type: 'png'|'jpg', orientation?: 1..8 }
                          // orientation is a JPEG's EXIF value the caller could not apply to the pixels
                          // (the command line has no canvas): the picture is drawn turned upright instead.
    logoShape = 'square', // 'square' | 'circle'
    logoSizeMm = 16,
    onProblems = null,    // called with {unprintable, tooWide, tooTall, maxLines} after the sheet is laid out
    fonts: suppliedFonts = null, // {regular, bold} font bytes; the tests pass these, the page fetches them
    renderLogo = true,    // false for the on-screen preview canvas only:
                           // see static/js/envelope-guide/app.js's render(),
                           // which draws the real logo as a separate DOM
                           // overlay instead, so dark mode can invert this
                           // canvas unconditionally without touching a
                           // firm's real brand colours.
  } = opts;

  const env = ENVELOPES[resolveEnvelopeId(envelope)];
  const doc = await PDFDocument.create();
  const page = doc.addPage([A4_MM.w * MM, A4_MM.h * MM]);
  const footList = (Array.isArray(footerLines) ? footerLines : String(footerLines).split('\n'));
  const chosen = await chooseFonts(doc, [firmName, strapline, addressTo, senderLine, ...footList], suppliedFonts);
  const { reg, bold } = chosen;
  const problems = { unprintable: chosen.unprintable, tooWide: [], tooTall: false, maxLines: 0,
    rtl: RTL.test([firmName, strapline, addressTo, senderLine, ...footList].join('\n')),
    logoScaled: null, mastheadTooWide: [], footerTooWide: [], footerTooTall: false, maxFooterLines: 0 };

  const hex = (h) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(h).trim());
    if (!m) return rgb(0.1, 0.31, 0.55);
    const n = parseInt(m[1], 16);
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  };
  const ACCENT = hex(accent);

  // ── Masthead ───────────────────────────────────────────────────────────
  // The logo sits left, the words move right to clear it. A circular crop is
  // drawn as a clipping path rather than by masking the image: pdf-lib has no
  // image mask, and the alternative (rounding the corners on a canvas before
  // embedding) would put a canvas dependency into a module that otherwise
  // has none, and would rasterise at whatever the screen's DPI happens to be.
  // A vector clip stays sharp at any print resolution.
  let textX = 20 * MM;
  if (logo?.bytes?.length) {
    const asked = Math.max(8, Math.min(30, Number(logoSizeMm) || 16));
    const size = effectiveLogoSize(envelope, logoSizeMm);
    // On a preset whose window starts high (DIN Form A) the logo is made smaller so none of it shows through the window.
    if (size < asked) problems.logoScaled = { from: asked, to: Math.round(size * 10) / 10 };
    const box = size * MM;
    if (renderLogo) {
      const img = logo.type === 'jpg' ? await doc.embedJpg(logo.bytes) : await doc.embedPng(logo.bytes);
      // Contain, never stretch: a logo distorted to fill a square stops being
      // the firm's logo.
      const turn = logo.type === 'jpg' && logo.orientation >= 2 && logo.orientation <= 8 ? logo.orientation : 1;
      const [iw, ih] = uprightSize(turn, img.width, img.height);   // the picture's size once it is upright
      const scale = Math.min(box / iw, box / ih);
      const w = iw * scale;
      const h = ih * scale;
      const x = 20 * MM + (box - w) / 2;
      const top = MASTHEAD_TOP;
      const y = yAt(top + size) + (box - h) / 2;

      if (logoShape === 'circle') {
        const cx = 20 * MM + box / 2;
        const cy = yAt(top + size) + box / 2;
        const r = box / 2;
        // A real clipping path, built from pdf-lib's own operator helpers.
        // pushOperators type-checks its arguments, so hand-rolled operator
        // objects are rejected outright, which is a good deal better than
        // writing a malformed content stream that only shows up in a viewer.
        // 0.5523 is the standard four-Bezier circle approximation.
        const k = r * 0.5523;
        page.pushOperators(
          pushGraphicsState(),
          moveTo(cx + r, cy),
          appendBezierCurve(cx + r, cy + k, cx + k, cy + r, cx, cy + r),
          appendBezierCurve(cx - k, cy + r, cx - r, cy + k, cx - r, cy),
          appendBezierCurve(cx - r, cy - k, cx - k, cy - r, cx, cy - r),
          appendBezierCurve(cx + k, cy - r, cx + r, cy - k, cx + r, cy),
          closePath(),
          clip(),
          endPath(),
        );
        // Cover, not contain, inside a circle: a contained image leaves the
        // circle's corners empty and the crop reads as an accident.
        const cscale = Math.max(box / iw, box / ih);
        drawUpright(page, img, turn, cx - (iw * cscale) / 2, cy - (ih * cscale) / 2, iw * cscale, ih * cscale);
        page.pushOperators(popGraphicsState());
      } else {
        drawUpright(page, img, turn, x, y, w, h);
      }
    }
    textX = 20 * MM + box + 6 * MM;
  }

  const baselines = mastheadBaselines(envelope);
  const roomMm = A4_MM.w - MARGIN_MM - textX / MM;   // from the text's left edge to the right margin
  if (firmName) {
    const shown = drawable(firmName, bold);
    page.drawText(shown, { x: textX, y: yAt(baselines.firm), size: 18, font: bold, color: ACCENT });
    if (bold.widthOfTextAtSize(shown, 18) / MM > roomMm) problems.mastheadTooWide.push(firmName);
  }
  if (strapline) {
    const shown = drawable(strapline, reg);
    page.drawText(shown, { x: textX, y: yAt(baselines.strapline), size: 9, font: reg, color: MUTED });
    if (reg.widthOfTextAtSize(shown, 9) / MM > roomMm) problems.mastheadTooWide.push(strapline);
  }

  // ── The sender line ────────────────────────────────────────────────────
  // The small line above the address, INSIDE the window so it shows through
  // it, with a hairline rule beneath. It is a postal convention rather than
  // decoration: it tells the Post Office where to return an undeliverable
  // letter without opening it. (Above the window, an envelope in the right
  // place would hide it.)
  if (senderLine) {
    page.drawText(drawable(senderLine, reg), {
      x: env.window.x * MM, y: yAt(env.window.y + env.senderBaseline), size: 6, font: reg, color: MUTED,
    });
    page.drawLine({
      start: { x: env.window.x * MM, y: yAt(env.window.y + env.senderBaseline + 1.4) },
      end: { x: (env.window.x + env.window.w) * MM, y: yAt(env.window.y + env.senderBaseline + 1.4) },
      thickness: 0.4, color: MUTED,
    });
  }

  // ── The address block, inside the window ───────────────────────────────
  const lines = String(addressTo).split('\n').map((l) => l.trim()).filter(Boolean);
  let y = env.window.y + env.addressBaseline;
  for (const line of lines) {
    const shown = drawable(line, reg);
    page.drawText(shown, { x: env.window.x * MM, y: yAt(y), size: 10, font: reg, color: INK });
    if (reg.widthOfTextAtSize(shown, 10) / MM > env.window.w) problems.tooWide.push(line);
    y += env.linePitch;
  }
  // The last line's baseline, plus room for its descenders, must still be inside the window.
  problems.maxLines = Math.max(1, Math.floor((env.window.h - 1 - env.addressBaseline) / env.linePitch) + 1);
  problems.tooTall = lines.length > problems.maxLines;
  if (senderLine && reg.widthOfTextAtSize(drawable(senderLine, reg), 6) / MM > env.window.w) problems.tooWide.push(senderLine);

  // ── Guides: the window outline and the fold marks ──────────────────────
  // Printed only when asked. The point of the guide sheet is to hold it
  // against a real envelope and see whether the window agrees.
  if (showGuides) {
    page.drawRectangle({
      x: env.window.x * MM,
      y: yAt(env.window.y + env.window.h),
      width: env.window.w * MM,
      height: env.window.h * MM,
      borderColor: ACCENT, borderWidth: 0.6, borderDashArray: [3, 3],
    });
    page.drawText(`window: ${env.label}`, {
      x: env.window.x * MM, y: yAt(env.window.y + env.window.h + 3),
      size: 6, font: reg, color: ACCENT,
    });
  }
  // Guide mode draws the fold marks as a dashed line across the full page
  // width, the same treatment as the window box above, and the thing that
  // makes them usable: held up to a light (or against a real envelope, as
  // with the window guide), a full line across the page shows whether a fold
  // landed where it should. Outside guide mode they stay a short, subtle 5mm
  // edge tick: an always-on fold reference that is not meant to dominate the
  // page the way the print-only guide does.
  for (const mm of foldMarks(envelope)) {
    page.drawLine({
      start: { x: 0, y: yAt(mm) },
      end: { x: showGuides ? A4_MM.w * MM : 5 * MM, y: yAt(mm) },
      thickness: 0.5,
      color: showGuides ? ACCENT : MUTED,
      dashArray: showGuides ? [3, 3] : undefined,
    });
  }

  // ── Footer ─────────────────────────────────────────────────────────────
  const foot = (Array.isArray(footerLines) ? footerLines : String(footerLines).split('\n'))
    .map((l) => l.trim()).filter(Boolean);
  if (foot.length) {
    page.drawLine({
      start: { x: 20 * MM, y: yAt(A4_MM.h - 28) },
      end: { x: (A4_MM.w - 20) * MM, y: yAt(A4_MM.h - 28) },
      thickness: 0.5, color: ACCENT,
    });
    let fy = A4_MM.h - FOOTER_FIRST_MM;
    problems.maxFooterLines = Math.floor((A4_MM.h - FOOTER_LIMIT_MM - fy) / FOOTER_PITCH_MM) + 1;
    problems.footerTooTall = foot.length > problems.maxFooterLines;
    for (const line of foot) {
      const shown = drawable(line, reg);
      const w = reg.widthOfTextAtSize(shown, 7.5);
      if (w / MM > A4_MM.w - 2 * MARGIN_MM) problems.footerTooWide.push(line);
      page.drawText(shown, {
        x: (A4_MM.w * MM - w) / 2, y: yAt(fy), size: 7.5, font: reg, color: MUTED,
      });
      fy += FOOTER_PITCH_MM;
    }
  }

  if (onProblems) onProblems(problems);
  return doc.save();
}

/**
 * Says whether a logo file can be placed on the sheet: its bytes must really be a PNG or a JPEG.
 * @returns {Promise<boolean>}
 */
export async function logoIsUsable(bytes, type) {
  try {
    const doc = await PDFDocument.create();
    if (type === 'jpg') await doc.embedJpg(bytes); else await doc.embedPng(bytes);
    return true;
  } catch {
    return false;
  }
}
