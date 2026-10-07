/**
 * Envelope Guide history: a running log of downloaded and printed envelopes,
 * kept in localStorage only. Never uploaded, the same "nothing leaves this
 * device" posture as the rest of the tool; localStorage only means it is
 * *remembered* on this device rather than held in the live form alone.
 *
 * Logo bytes are deliberately NOT stored: a handful of uploaded logos would
 * dominate localStorage's ~5-10MB budget fast, unlike the plain-text fields
 * below (a few hundred bytes each). Restoring an entry that had a logo
 * brings back every other field and flags the gap instead of silently
 * dropping it.
 */

const KEY = 'envelope-guide-history-v1';
// Matches BundleTool's own BUNDLE_MAX_COUNT (bundletoolAutosave.js). The
// closer analogue is its "finished bundles" cap, not its 20-snapshot
// autosave and crash-recovery cap: both record a completed download or print,
// not an in-progress editing checkpoint.
const MAX_ENTRIES = 15;

// The longest each field may be: the page's own maxlength limits, applied again when an entry is saved or read so a
// hand-edited or oversized entry can neither fill the browser's storage nor be echoed whole into the page.
export const FIELD_LIMITS = { firmName: 200, strapline: 200, senderLine: 200, addressTo: 2000, footerLines: 1000 };

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

/** The saved fields as safe values of the right types: text cut to its limit, a choice restricted to what exists. */
export function cleanFields(f) {
  const o = f && typeof f === 'object' ? f : {};
  const size = Number(o.logoSizeMm);
  return {
    envelope: str(o.envelope, 40),
    firmName: str(o.firmName, FIELD_LIMITS.firmName),
    strapline: str(o.strapline, FIELD_LIMITS.strapline),
    senderLine: str(o.senderLine, FIELD_LIMITS.senderLine),
    addressTo: str(o.addressTo, FIELD_LIMITS.addressTo),
    footerLines: str(o.footerLines, FIELD_LIMITS.footerLines),
    showGuides: o.showGuides === true,
    accent: typeof o.accent === 'string' && /^#[0-9a-f]{6}$/i.test(o.accent) ? o.accent : '#1a4f8c',
    logoShape: o.logoShape === 'circle' ? 'circle' : 'square',
    logoSizeMm: Number.isFinite(size) ? Math.max(8, Math.min(30, size)) : 16,
  };
}

/**
 * True for a stored entry the page can use: an object with an id, a time and a fields object.
 * Anything else (a null, a string, an entry from a different version of the tool or one edited by
 * hand) is dropped instead of breaking Rewind and Restore for every other entry.
 */
export function isValidEntry(e) {
  return !!e && typeof e === 'object' && typeof e.id === 'string' && e.id !== ''
    && Number.isFinite(e.timestamp) && !!e.fields && typeof e.fields === 'object' && !Array.isArray(e.fields);
}

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter(isValidEntry).map((e) => ({ ...e, label: typeof e.label === 'string' ? e.label.slice(0, 200) : null, fields: cleanFields(e.fields) }))
      : [];
  } catch {
    return [];
  }
}

function writeAll(entries) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Storage full or disabled (private browsing): history silently stops
    // accumulating rather than breaking the download or print it rides
    // along with.
  }
}

/**
 * @param {{action: 'downloaded'|'printed', label: string, hadLogo: boolean, fields: object}} entry
 */
export function saveEntry({ action, label, hadLogo, fields }) {
  const entries = readAll();
  const record = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    action,
    label: label ? String(label).slice(0, 200) : null,
    hadLogo: !!hadLogo,
    fields: cleanFields(fields),
  };
  entries.unshift(record);
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  writeAll(entries);
  return record;
}

export function listEntries() {
  return readAll();
}

/** Removes every saved envelope from this browser (the "Clear history" button). */
export function clearAll() {
  try { localStorage.removeItem(KEY); } catch { /* storage disabled: there is nothing stored to remove */ }
}

export function deleteEntry(id) {
  writeAll(readAll().filter((e) => e.id !== id));
}
