import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { computeCrop } from '../../openclaw/scripts/viewer/crop.mjs';

// A 1512x861 CSS viewport captured at 1280 wide => scale 0.847.
const IMAGE = { imageWidth: 1280, imageHeight: 729, deviceWidth: 1512 };
const OPTS = { ...IMAGE, minCropCss: 520, padCss: 100, aspect: 1.2 };

describe('computeCrop', () => {
  it('returns null with no focused element, so the caller shows the whole page', () => {
    assert.equal(computeCrop(null, OPTS), null);
  });

  it('centres the crop on the focused field and converts CSS px to image px', () => {
    // A 300x40 input in the middle of the page.
    const crop = computeCrop({ x: 606, y: 400, width: 300, height: 40 }, OPTS)!;
    const scale = 1280 / 1512;
    // width 300 + 2*100 = 500, below the 520 floor, so the floor wins.
    assert.equal(Math.round(crop.sw), Math.round(520 * scale));
    assert.equal(Math.round(crop.sh), Math.round(520 * 1.2 * scale));
    // centred on the field's centre (756, 420) in CSS px.
    assert.equal(Math.round(crop.sx + crop.sw / 2), Math.round(756 * scale));
    assert.equal(Math.round(crop.sy + crop.sh / 2), Math.round(420 * scale));
  });

  it('grows the crop for a field wider than the floor', () => {
    const crop = computeCrop({ x: 100, y: 300, width: 900, height: 40 }, OPTS)!;
    assert.equal(Math.round(crop.sw), Math.round((900 + 200) * (1280 / 1512)));
  });

  it('clamps to the image instead of reading outside it', () => {
    const topLeft = computeCrop({ x: 0, y: 0, width: 100, height: 30 }, OPTS)!;
    assert.equal(topLeft.sx, 0);
    assert.equal(topLeft.sy, 0);

    const bottomRight = computeCrop({ x: 1450, y: 840, width: 60, height: 20 }, OPTS)!;
    assert.ok(bottomRight.sx + bottomRight.sw <= IMAGE.imageWidth + 0.001, 'crop must not exceed image width');
    assert.ok(bottomRight.sy + bottomRight.sh <= IMAGE.imageHeight + 0.001, 'crop must not exceed image height');
  });

  it('never returns a crop larger than the image itself', () => {
    const crop = computeCrop({ x: 0, y: 0, width: 5000, height: 4000 }, OPTS)!;
    assert.equal(crop.sx, 0);
    assert.equal(crop.sy, 0);
    assert.equal(crop.sw, IMAGE.imageWidth);
    assert.equal(crop.sh, IMAGE.imageHeight);
  });

  it('ignores a zero-sized rect, which is what a hidden element reports', () => {
    assert.equal(computeCrop({ x: 0, y: 0, width: 0, height: 0 }, OPTS), null);
  });
});
