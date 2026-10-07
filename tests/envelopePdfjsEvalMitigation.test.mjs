/**
 * CVE-2024-4367: pdf.js before 4.2.67 can execute attacker-controlled code via eval() reached
 * from a crafted font inside a PDF. The vendored pdf.js is 4.0.379, so every call site that loads
 * a document the person did not write themselves must carry isEvalSupported: false, or the
 * mitigation NOTICE describes would not hold.
 *
 * Scans every file in Envelope Guide's own JS directory rather than naming one file, so a new
 * call site (or one written as getDocument(opts) instead of an inline object literal) cannot pass
 * silently. Kept separate from pdfjsEvalMitigation.test.mjs so that file never walks another
 * product's directory.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

test('every pdf.js getDocument() call in Envelope Guide passes isEvalSupported: false', () => {
  const dir = fileURLToPath(new URL('../static/js/envelope-guide', import.meta.url));
  let callsFound = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.js')) continue;
    const file = `${dir}/${name}`;
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/getDocument\(/g)) {
      const rest = text.slice(m.index);
      const open = rest.indexOf('(');
      let depth = 0, end = -1;
      for (let i = open; i < rest.length; i++) {
        if (rest[i] === '(') depth++;
        else if (rest[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
      }
      assert.ok(end > -1, `${name}: getDocument( call has no matching close paren`);
      const args = rest.slice(open + 1, end);
      callsFound++;
      assert.match(args, /^\s*\{/, `${name}: getDocument() is not called with an inline object literal, so this scan cannot verify it: ${args.slice(0, 80)}`);
      assert.match(args, /isEvalSupported:\s*false/, `${name}: ${args.slice(0, 120)}`);
    }
  }
  assert.ok(callsFound > 0, 'no getDocument() call found anywhere in static/js/envelope-guide: the scan itself may be broken');
});
