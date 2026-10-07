/**
 * Envelope Guide's error codes. Every error the page shows carries one, after its message and in the bug report, so
 * a report points straight at the place that raised it: `EG-<AREA>-<NN>`, where the area is LOGO (the logo file),
 * PREVIEW (the live preview), DOWNLOAD, PRINT or PAGE (anything no handler caught).
 *
 * A code never changes meaning once it is given out; one that is no longer raised moves to RETIRED_CODES and is never
 * used for anything else. Each code is raised from exactly one place. A code is a fixed string in the source: nothing
 * typed into the form, and no file name, ever goes into one. The address problems listed under the Addressee (a line
 * too wide, a character that cannot print) are guidance about what was typed, not errors, and carry none.
 * A scan of the source in the test suite keeps all of this true.
 */

export const ERROR_CODES = Object.freeze({
  'EG-LOGO-01': 'The logo file is over 4 MB, so it was not used.',
  'EG-LOGO-02': 'The logo file is not a PNG or JPG, so it was not used.',
  'EG-LOGO-03': 'The logo file says it is a PNG or JPG but is not a valid picture, so it was not used.',
  'EG-PREVIEW-01': 'The sheet could not be built for the preview.',
  'EG-PREVIEW-02': 'The sheet was built but the preview could not draw it.',
  'EG-DOWNLOAD-01': 'The sheet could not be built for Download PDF, so nothing was downloaded.',
  'EG-PRINT-01': 'The sheet could not be built for Print, so nothing was printed.',
  'EG-PAGE-01': 'Something failed on the page that no other check caught.',
});

/** Codes no longer raised. Each keeps its meaning above and is never given to anything else. */
export const RETIRED_CODES = Object.freeze([]);

const FORMAT = /^EG-[A-Z]{2,8}-\d{2}$/;

/** The code as it is shown, or '' for anything that is not a registered code. */
export function shownCode(code) {
  return typeof code === 'string' && FORMAT.test(code) && Object.hasOwn(ERROR_CODES, code) ? code : '';
}

/** A message with its code after it, the way the page shows both. */
export function withCode(message, code) {
  const shown = shownCode(code);
  return shown ? `${message} Error code ${shown}.` : message;
}
