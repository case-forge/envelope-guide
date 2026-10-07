/** The pure sizing rules for a logo (static/js/envelope-guide/logoSize.js), shared by the page and the CLI. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOGO_MAX_EDGE, LOGO_MAX_PIXELS, logoTargetSize, logoShrinkSteps } from '../static/js/envelope-guide/logoSize.js';

test('a picture at or under 600 pixels on its longest edge is never touched, and none is ever enlarged', () => {
  assert.equal(LOGO_MAX_EDGE, 600);
  assert.equal(logoTargetSize(600, 400), null);
  assert.equal(logoTargetSize(150, 100), null);
  assert.equal(logoTargetSize(1, 1), null);
  assert.equal(logoTargetSize(400, 600), null);
});

test('a larger picture keeps its shape, with the longest edge at 600 and no side under one pixel', () => {
  assert.deepEqual(logoTargetSize(4000, 3000), { width: 600, height: 450 });
  assert.deepEqual(logoTargetSize(3000, 4000), { width: 450, height: 600 });
  assert.deepEqual(logoTargetSize(601, 601), { width: 600, height: 600 });
  assert.deepEqual(logoTargetSize(100000, 10), { width: 600, height: 1 });
});

test('unusable sizes give no target', () => {
  for (const [w, h] of [[0, 100], [100, 0], [NaN, 5], [Infinity, 5], [-1, 900]]) assert.equal(logoTargetSize(w, h), null, `${w}x${h}`);
});

test('the shrink goes down in halves and ends exactly on the target', () => {
  const steps = logoShrinkSteps(4000, 3000, { width: 600, height: 450 });
  assert.deepEqual(steps, [{ width: 2000, height: 1500 }, { width: 1000, height: 750 }, { width: 600, height: 450 }]);
  assert.deepEqual(logoShrinkSteps(1000, 800, { width: 600, height: 480 }), [{ width: 600, height: 480 }], 'less than a factor of two is one step');
  const last = logoShrinkSteps(12345, 6789, logoTargetSize(12345, 6789)).at(-1);
  assert.deepEqual(last, logoTargetSize(12345, 6789));
});

test('the pixel limit is 40 million', () => { assert.equal(LOGO_MAX_PIXELS, 40e6); });
