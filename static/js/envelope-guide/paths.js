// Where the Envelope Guide finds the two files that live outside its own folder, in this repository.

/** The folder of the Liberation Sans files, fetched only when an address needs more letters than Helvetica has. */
export const FONT_BASE = '/fonts/liberation-sans/';

/** The pdf.js worker that draws the live preview (a one-line file that imports the shared library). */
export const PDFJS_WORKER = '/pdfjs.worker.mjs';
