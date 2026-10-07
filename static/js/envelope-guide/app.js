/**
 * Envelope Guide: the page wiring.
 *
 * The preview is the real PDF, redrawn as the fields change and drawn onto a
 * <canvas> with pdf.js rather than shown in a browser-native PDF <iframe>. A
 * native viewer varies by browser (Firefox shows its own PDF.js chrome, with
 * annotation and signature tools that have nothing to do with this page; Brave
 * set to download PDFs shows nothing at all), and it cannot be restyled for the
 * dark-mode "page" look. pdf.js renders identically everywhere, and the result
 * is just pixels this page fully controls.
 */
import { ENVELOPES, A4_MM, resolveEnvelopeId, effectiveLogoSize, MASTHEAD_TOP } from './envelopes.js';
import { makeLetterhead, logoIsUsable } from './envelope.js';
import { prepareLogo } from './logo.js';
import { createRenderScheduler, copyFrame } from '/js/shared/renderScheduler.js';
import { saveEntry, listEntries, deleteEntry, clearAll, cleanFields } from './history.js';
import * as pdfjsLib from '/vendor/pdfjs.mjs';
import { PDFJS_WORKER } from './paths.js';
import { withCode } from './errorCodes.js';

// The pdf.js worker is started from a file inside this tool's own folder (which imports the shared library file), so
// the offline service worker, whose scope is /envelope-guide/, controls it and it starts with the network off.
// One worker serves every preview for the life of the page, rather than one started and thrown away per edit.
pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
let pdfWorker = null;
function previewWorker() {
  if (!pdfWorker) pdfWorker = new pdfjsLib.PDFWorker();
  return pdfWorker;
}

const $ = (id) => document.getElementById(id);
const envSel = $('lh-envelope');
const note = $('lh-envelope-note');

for (const [key, env] of Object.entries(ENVELOPES)) {
  const opt = document.createElement('option');
  opt.value = key;
  opt.textContent = env.label;
  envSel.appendChild(opt);
}

// The uploaded logo, held as bytes in this tab and nowhere else.
let logo = null;
const logoInput = $('lh-logo');
const logoOpts = $('lh-logo-opts');
const logoClear = $('lh-logo-clear');
const logoNote = $('lh-logo-note');

function setLogo(next, message) {
  logo = next;
  logoOpts.hidden = !next;
  logoClear.hidden = !next;
  logoNote.textContent = message || '';
  logoNote.title = '';
  delete logoNote.dataset.error;
}

// A logo file that was not used: the reason, with its error code (errorCodes.js), wrapping rather than cut short.
function refuseLogo(code, message) {
  logoInput.value = '';
  setLogo(null, withCode(message, code));
  logoNote.title = logoNote.textContent;
  logoNote.dataset.error = '';
}

logoInput?.addEventListener('change', async () => {
  const file = logoInput.files?.[0];
  if (!file) return setLogo(null, '');
  // 4 MB is generous for a logo and small enough that a mis-picked photo is
  // caught here rather than as a slow preview.
  if (file.size > 4 * 1024 * 1024) return refuseLogo('EG-LOGO-01', 'That file is over 4 MB. A logo should be far smaller.');
  const type = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : null;
  if (!type) return refuseLogo('EG-LOGO-02', 'PNG or JPG only.');
  const raw = new Uint8Array(await file.arrayBuffer());
  // The file's name and type are only what it says about itself; check it really is that picture,
  // or Download and Print would fail later with no explanation.
  if (!(await logoIsUsable(raw, type))) return refuseLogo('EG-LOGO-03', 'That file is not a valid PNG or JPG picture, so it was not used.');
  // Turned upright and shrunk here, once, so the preview and the PDF show the same picture and a large photo does
  // not add megabytes to every sheet.
  const { bytes, type: keptType } = await prepareLogo(raw, type);
  setLogo({ bytes, type: keptType }, file.name);
  schedule();
});

logoClear?.addEventListener('click', () => {
  logoInput.value = '';
  setLogo(null, '');
  schedule();
});

logoOpts?.addEventListener('input', () => schedule());

const SAMPLE_ADDRESS = 'Ms A Sample\n12 Example Road\nLondon\nN1 1AA';

/** The form's values. The sample address is only a stand-in for the preview: output never gets it. */
function opts(forOutput = false) {
  return {
    logo,
    logoShape: document.querySelector('input[name="lh-logo-shape"]:checked')?.value || 'square',
    logoSizeMm: Number($('lh-logo-size')?.value || 16),
    envelope: envSel.value,
    firmName: $('lh-firm').value,
    strapline: $('lh-strap').value,
    senderLine: $('lh-sender').value,
    addressTo: $('lh-address').value.trim() || (forOutput ? '' : SAMPLE_ADDRESS),
    footerLines: $('lh-footer').value,
    showGuides: $('lh-guides').checked,
    accent: $('lh-accent').value,
  };
}

// Everything opts() returns except the logo bytes: what a history entry
// stores and what Restore writes back.
function fieldsForHistory() {
  const o = opts();
  const { logo, ...rest } = o;
  return rest;
}

// ── Problems shown under the Addressee ─────────────────────────────────────
const problemsEl = $('lh-problems');
let outputError = '';
let lastProblems = null;

// A line quoted in a message is cut short, so an enormous pasted line is never echoed whole into the page.
const quote = (text) => (text.length > 60 ? text.slice(0, 57) + '...' : text);

function showProblems() {
  const messages = [];
  if (!$('lh-address').value.trim()) {
    messages.push('Enter an addressee to download or print. The preview shows a sample.');
  }
  const p = lastProblems;
  if (p) {
    if (p.unprintable.length) {
      messages.push(`These characters cannot be printed and will show as "?": ${p.unprintable.slice(0, 20).join(' ')}`);
    }
    if (p.rtl) {
      messages.push('Hebrew, Arabic and other right-to-left text cannot be set correctly here: it would print in the wrong order. Use a left-to-right version of the text.');
    }
    if (p.tooWide.length) {
      messages.push(`A line is wider than the window and will run past its edge: "${quote(p.tooWide[0])}". Shorten it or split it over two lines.`);
    }
    if (p.tooTall) {
      messages.push(`The window holds ${p.maxLines} address lines and there are more, so the last ones will fall outside it.`);
    }
    if (p.logoScaled) {
      messages.push(`The logo was made smaller (${p.logoScaled.to} mm instead of ${p.logoScaled.from} mm) so none of it shows through this envelope's window.`);
    }
    if (p.mastheadTooWide?.length) {
      messages.push(`The firm name or strapline is too long for the top of the page and will run off the edge: "${quote(p.mastheadTooWide[0])}". Shorten it.`);
    }
    if (p.footerTooWide?.length) {
      messages.push(`A footer line is wider than the page margins: "${quote(p.footerTooWide[0])}". Split it over two lines.`);
    }
    if (p.footerTooTall) {
      messages.push(`The footer holds ${p.maxFooterLines} lines before it reaches the edge of the page and there are more.`);
    }
  }
  if (outputError) messages.push(outputError);
  problemsEl.textContent = messages.join(' ');
  problemsEl.hidden = messages.length === 0;
}

// Download or Print failed: the reason goes under the Addressee with its code, and the shared reporter offers a report.
function failOutput({ code, message, error, title }) {
  outputError = withCode(message, code);
  window.cfBugReport?.report({ error, title, code });
}

const lhDownloadBtn = $('lh-download');
const lhPrintBtn = $('lh-print');
let busy = false;
function updateOutputButtons() {
  const blank = !$('lh-address').value.trim();
  for (const btn of [lhDownloadBtn, lhPrintBtn]) {
    btn.disabled = blank || busy;
    btn.title = blank ? 'Enter an addressee first' : btn.dataset.title || '';
  }
}
lhDownloadBtn.dataset.title = lhDownloadBtn.title;
lhPrintBtn.dataset.title = lhPrintBtn.title;

function deriveLabel() {
  // There is no label field, since nobody reliably remembers to set one
  // before sending: the label is always the address's first line.
  const firstLine = $('lh-address').value.split('\n').map((l) => l.trim()).find(Boolean);
  return firstLine || 'Untitled envelope';
}

const canvas = $('lh-canvas');

// The logo, drawn as its own DOM layer instead of baked into the preview
// canvas's PDF (see envelope.js's renderLogo param), so dark mode can invert
// the canvas unconditionally without also inverting a firm's real brand
// colours. Positioned as percentages of .lh-paper, matching envelope.js's
// own mm placement (20mm left, 14mm top, logoSizeMm square) 1:1, since
// .lh-paper's aspect ratio is locked to the real A4 ratio of 210:297.
const logoOverlay = $('lh-logo-overlay');
const logoOverlayImg = $('lh-logo-overlay-img');
let logoOverlayUrl = null;
let logoOverlayBytes = null;   // the bytes the overlay image was built from: unchanged bytes keep the same image
function updateLogoOverlay(o) {
  if (!o.logo?.bytes?.length) {
    logoOverlay.hidden = true;
    return;
  }
  const sizeMm = effectiveLogoSize(o.envelope, o.logoSizeMm);
  logoOverlay.style.left = (20 / A4_MM.w) * 100 + '%';
  logoOverlay.style.top = (MASTHEAD_TOP / A4_MM.h) * 100 + '%';
  logoOverlay.style.width = (sizeMm / A4_MM.w) * 100 + '%';
  logoOverlay.style.height = (sizeMm / A4_MM.h) * 100 + '%';
  logoOverlay.classList.toggle('lh-logo-overlay--circle', o.logoShape === 'circle');
  // Rebuilding the image on every redraw would make the logo blink while typing. Only a different logo replaces it.
  if (o.logo.bytes !== logoOverlayBytes) {
    const mime = o.logo.type === 'jpg' ? 'image/jpeg' : 'image/png';
    if (logoOverlayUrl) URL.revokeObjectURL(logoOverlayUrl);
    logoOverlayUrl = URL.createObjectURL(new Blob([o.logo.bytes], { type: mime }));
    logoOverlayImg.src = logoOverlayUrl;
    logoOverlayBytes = o.logo.bytes;
  }
  logoOverlay.hidden = false;
}

let renderToken = 0;
let previousPdf = null;   // the last drawn preview's document, freed before the next
// The sheet is drawn on this off-screen canvas and copied onto the visible one in a single step once it is
// complete. Setting a canvas's width or height clears it, so doing that (or drawing) on the visible canvas
// before the new page is ready would make the preview go blank for the length of every redraw.
const backCanvas = document.createElement('canvas');
const backCtx = backCanvas.getContext('2d');
let hasFrame = false;     // a sheet has been shown at least once: from then on a failed redraw keeps it on screen

// A preview that failed: with nothing drawn yet, the "could not be drawn" note and its code take the canvas's place;
// either way the shared reporter offers a bug report with the same code.
function failPreview({ code, error, title }) {
  if (!hasFrame) {
    canvas.hidden = true;
    $('lh-noviewer').hidden = false;
    $('lh-noviewer-code').textContent = withCode('', code).trim();
  }
  window.cfBugReport?.report({ error, title, code });
}

async function render() {
  const env = ENVELOPES[envSel.value];
  note.textContent = env ? env.note : '';
  const o = opts();
  updateLogoOverlay(o);
  // Same race BundleTool's cover editor guards against: makeLetterhead()
  // is async, so an unfinished render can still be in flight when a newer
  // one starts (autofill firing 'input' right after the initial render(),
  // fast typing outrunning the debounce). Without this token, an older
  // call's page could still land on the canvas after a newer one.
  const token = ++renderToken;
  // renderLogo: false. The logo is drawn as its own overlay (above), so
  // this canvas never contains it, and dark mode's invert filter (tool.css)
  // can apply unconditionally without wrecking a firm's real brand colours.
  // The PDF that is downloaded or printed (below, in the download and print
  // handlers) is unaffected: both call makeLetterhead(opts()) directly, with
  // the default renderLogo: true, so the real file always embeds it.
  let bytes;
  try {
    bytes = await makeLetterhead({ ...o, renderLogo: false, onProblems: (p) => { lastProblems = p; } });
  } catch (err) {
    if (token !== renderToken) return;
    failPreview({ code: 'EG-PREVIEW-01', error: err, title: 'Envelope sheet could not be built' });
    return;
  }
  if (token !== renderToken) return; // a newer edit superseded this render
  showProblems();
  try {
    if (previousPdf) { previousPdf.destroy(); previousPdf = null; }
    const pdf = await pdfjsLib.getDocument({ data: bytes, worker: previewWorker(), isEvalSupported: false }).promise;
    previousPdf = pdf;
    if (token !== renderToken) return;
    const page = await pdf.getPage(1);
    if (token !== renderToken) return;
    // Render at the box's real device-pixel size, not the PDF's own point
    // size, or the canvas looks soft on anything above 1x DPI.
    const box = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const unscaled = page.getViewport({ scale: 1 });
    const scale = (box.width * dpr) / unscaled.width;
    const viewport = page.getViewport({ scale });
    backCanvas.width = viewport.width;
    backCanvas.height = viewport.height;
    // The paper is white in both themes, because real paper is white. Beige
    // belongs to the CHROME around it (.lh-paper's own container background,
    // tool.css, and the drawer and settings panel), not the sheet pdf.js
    // draws here. Always 'white', unconditionally: dark mode's "black page"
    // look comes entirely from the CSS invert filter (which only gives a
    // clean result starting from real black and white), never from this
    // render call's own fill colour, so this line needs no light/dark branch.
    await page.render({ canvasContext: backCtx, viewport, background: 'white' }).promise;
    if (token !== renderToken) return;
    // One synchronous step, so the browser never paints a cleared or half-drawn canvas in between.
    copyFrame(backCanvas, canvas);
    hasFrame = true;
    canvas.hidden = false;
    $('lh-noviewer').hidden = true;
  } catch (err) {
    failPreview({ code: 'EG-PREVIEW-02', error: err, title: 'Envelope preview did not render' });
  }
}

// The redraw follows each edit straight away, one at a time, latest fields winning (see renderScheduler.js).
const scheduler = createRenderScheduler(render);
const schedule = () => scheduler.request();

for (const el of document.querySelectorAll('.lh-form input, .lh-form textarea, .lh-form select')) {
  el.addEventListener('input', schedule);
  el.addEventListener('change', schedule);
}

// Tap guard: both handlers below await makeLetterhead() (PDF generation)
// before doing anything visible, so without it a fast double-click or
// double-tap would fire twice before the first click has produced any
// feedback: two stacked downloads, or two print dialogs. Opening the history
// and clearing the logo do not need this: both are synchronous and
// idempotent, so a repeat click is harmless.
lhDownloadBtn.addEventListener('click', async () => {
  if (busy || !$('lh-address').value.trim()) return;
  busy = true; updateOutputButtons(); outputError = '';
  try {
    const bytes = await makeLetterhead({ ...opts(true), onProblems: (p) => { lastProblems = p; } });
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `envelope-guide-${envSel.value}.pdf`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
    saveEntry({ action: 'downloaded', label: deriveLabel(), hadLogo: !!logo, fields: fieldsForHistory() });
  } catch (err) {
    failOutput({ code: 'EG-DOWNLOAD-01', message: 'The sheet could not be built, so nothing was downloaded. Try removing the logo.', error: err, title: 'Envelope sheet could not be downloaded' });
  } finally {
    busy = false; updateOutputButtons(); showProblems();
  }
});

lhPrintBtn.addEventListener('click', async () => {
  if (busy || !$('lh-address').value.trim()) return;
  busy = true; updateOutputButtons(); outputError = '';
  try {
    // Print goes through a fresh object URL in a hidden frame rather than
    // printing the preview: the preview is a canvas drawn without the logo,
    // not the PDF itself.
    const bytes = await makeLetterhead({ ...opts(true), onProblems: (p) => { lastProblems = p; } });
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    const cleanUp = () => { f.remove(); URL.revokeObjectURL(url); };
    f.onload = () => {
      try {
        f.contentWindow.addEventListener('afterprint', cleanUp);
        f.contentWindow.print();
      } catch (_) { window.open(url); }
      setTimeout(cleanUp, 120000);   // a browser that never reports afterprint still gets tidied
    };
    f.src = url;
    document.body.appendChild(f);
    saveEntry({ action: 'printed', label: deriveLabel(), hadLogo: !!logo, fields: fieldsForHistory() });
  } catch (err) {
    failOutput({ code: 'EG-PRINT-01', message: 'The sheet could not be built, so nothing was printed. Try removing the logo.', error: err, title: 'Envelope sheet could not be printed' });
  } finally {
    busy = false; updateOutputButtons(); showProblems();
  }
});
$('lh-address').addEventListener('input', () => { outputError = ''; updateOutputButtons(); showProblems(); });
updateOutputButtons();
showProblems();

// Writes a set of saved fields back into the form. Every value goes through cleanFields first (right types, text cut to
// its limit, a choice restricted to what exists), so one damaged saved entry can never throw halfway through.
function applyFields(fields) {
  const f = cleanFields(fields);
  envSel.value = resolveEnvelopeId(f.envelope);   // a saved entry can hold an older envelope id
  $('lh-firm').value = f.firmName;
  $('lh-strap').value = f.strapline;
  $('lh-sender').value = f.senderLine;
  $('lh-address').value = f.addressTo;
  $('lh-footer').value = f.footerLines;
  $('lh-guides').checked = f.showGuides;
  $('lh-accent').value = f.accent;
  $('lh-logo-size').value = f.logoSizeMm;
  const shapeInput = document.querySelector(`input[name="lh-logo-shape"][value="${f.logoShape}"]`);
  if (shapeInput) shapeInput.checked = true;
}

// The typed sheet is kept for the life of this tab (sessionStorage: it dies with the tab and is never shared), so
// reloading for an app update, or by accident, does not lose it.
const DRAFT_KEY = 'envelope-guide-draft-v1';
function saveDraft() {
  try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(fieldsForHistory())); } catch (_) { /* storage blocked: no draft */ }
}
function restoreDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (raw) applyFields(JSON.parse(raw));
  } catch (_) { /* a damaged draft is ignored */ }
}
restoreDraft();
for (const el of document.querySelectorAll('.lh-form input, .lh-form textarea, .lh-form select')) {
  el.addEventListener('input', saveDraft);
  el.addEventListener('change', saveDraft);
}
updateOutputButtons();
showProblems();

// ── History: browse and restore envelopes already downloaded or printed ──
const historyModal = $('lh-history-modal');
const historyList = $('lh-history-list');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderHistory() {
  const entries = listEntries();
  disarmClear();
  $('lh-history-clear').hidden = !entries.length;
  if (!entries.length) {
    historyList.innerHTML = '<p class="lh-history-empty">Nothing downloaded or printed yet.</p>';
    return;
  }
  historyList.innerHTML = entries.map((e) => {
    const when = new Date(e.timestamp);
    const stamp = when.toLocaleDateString([], { day: 'numeric', month: 'short' })
      + ' at ' + when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const verb = e.action === 'printed' ? 'Printed' : 'Downloaded';
    const logoNote = e.hadLogo ? ' · had a logo (not restored, re-add it)' : '';
    return `<div class="lh-history-item" data-id="${esc(e.id)}">
      <div class="lh-history-item-main">
        <span class="lh-history-item-label">${esc(e.label || 'Untitled envelope')}</span>
        <span class="lh-history-item-meta">${verb} ${esc(stamp)}${logoNote}</span>
      </div>
      <div class="lh-history-item-actions">
        <button type="button" class="lh-btn lh-btn-xs lh-history-restore" data-id="${esc(e.id)}">Restore</button>
        <button type="button" class="lh-btn lh-btn-xs lh-history-delete" data-id="${esc(e.id)}" aria-label="Delete">Delete</button>
      </div>
    </div>`;
  }).join('');
}

// Clear history: two clicks. The first turns the button into the question and the second, within six
// seconds, wipes every saved envelope from this browser.
const clearBtn = $('lh-history-clear');
const clearIdle = clearBtn.textContent;
let clearTimer = null;
function disarmClear() { clearTimeout(clearTimer); clearTimer = null; clearBtn.textContent = clearIdle; }
clearBtn.addEventListener('click', () => {
  if (!clearTimer) {
    clearBtn.textContent = 'Click again to clear every saved envelope';
    clearTimer = setTimeout(disarmClear, 6000);
    return;
  }
  clearAll();
  renderHistory();
  $('lh-history-close').focus({ preventScroll: true });
});

function openHistory() {
  renderHistory();
  historyModal.hidden = false;
  // Move focus into the dialog, and give it back to the button that opened it on close, so a
  // keyboard user is neither left behind the overlay nor dropped at the top of the page.
  $('lh-history-close').focus({ preventScroll: true });
}

function closeHistory() {
  historyModal.hidden = true;
  $('lh-history-open').focus({ preventScroll: true });
}

$('lh-history-open').addEventListener('click', openHistory);
$('lh-history-close').addEventListener('click', closeHistory);
historyModal.addEventListener('click', (e) => { if (e.target === historyModal) closeHistory(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !historyModal.hidden) closeHistory();
});

historyList.addEventListener('click', (e) => {
  const restoreBtn = e.target.closest('.lh-history-restore');
  const deleteBtn = e.target.closest('.lh-history-delete');
  if (restoreBtn) {
    const entries = listEntries();
    const entry = entries.find((x) => x.id === restoreBtn.dataset.id);
    if (!entry) return;
    applyFields(entry.fields);
    saveDraft();
    if (entry.hadLogo) {
      setLogo(null, 'This entry had a logo, which was not restored. Add it again if you want it back.');
    } else if (logo) {
      logoInput.value = '';
      setLogo(null, '');   // the entry had no logo, so the sheet it restores has none
    }
    updateOutputButtons();
    closeHistory();
    schedule();
  } else if (deleteBtn) {
    deleteEntry(deleteBtn.dataset.id);
    renderHistory();
  }
});

scheduler.request();

// The canvas's pixel buffer is fixed at render time, so a viewport change
// (most commonly the .lh-grid breakpoint at 860px switching between one and
// two columns and resizing this box) needs an actual re-render, not just a
// resize, or the preview stays soft or the wrong size.
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(schedule, 150);
});
