import assert from 'node:assert/strict';
import test from 'node:test';

import { galleryLayout } from '../src/iconifyWebView/IconsView/galleryLayout.ts';

await test('gallery stays finite in a viewport narrower than an icon', () => {
  const layout = galleryLayout(100, 20, 200, 0);
  assert.equal(layout.start, 0);
  assert.equal(layout.end, 6);
  assert.equal(layout.translateY, 0);
  assert.equal(layout.totalHeight, 9584);
});
await test('gallery includes both icon labels and gaps in its row height', () => {
  const layout = galleryLayout(100, 224, 200, 960);
  assert.equal(layout.start, 27);
  assert.equal(layout.end, 45);
  assert.equal(layout.translateY, 864);
  assert.equal(layout.totalHeight, 3248);
});
await test('gallery bounds overscan to the data and handles an empty data set', () => {
  assert.deepEqual(galleryLayout(0, 0, 0, 0), { start: 0, end: 0, translateY: 0, totalHeight: 0 });
  const layout = galleryLayout(7, 224, 200, 10000);
  assert.equal(layout.start, 6);
  assert.equal(layout.end, 7);
});
