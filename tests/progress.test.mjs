import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = (await readFile(new URL('../CodexUsage.js', import.meta.url), 'utf8'))
  .replace('try { await main(); } finally { Script.complete(); }', '');

function renderer() {
  class Color {
    constructor(hex) { this.hex = hex; }
    static dynamic(light, dark) { return { dynamic: true, light, dark }; }
  }
  class Size { constructor(width, height) { Object.assign(this, { width, height }); } }
  class Rect { constructor(x, y, width, height) { Object.assign(this, { x, y, width, height }); } }
  class DrawContext {
    fills = [];
    setFillColor(color) { assert.ok(!color.dynamic, 'DrawContext cannot use dynamic colors'); this.color = color; }
    fillRect(rect) { this.fills.push({ rect, color: this.color }); }
    getImage() { return { size: this.size, opaque: this.opaque, respectScreenScale: this.respectScreenScale, fills: this.fills }; }
  }
  class Stack {
    children = [];
    addStack() { const stack = new Stack(); this.children.push(stack); return stack; }
    layoutHorizontally() {}
    setPadding() {}
    addSpacer() {}
  }
  const api = vm.runInNewContext(`${source}\n;({progressBar, layoutColors, percentLabel})`, {
    Color, Size, Rect, DrawContext,
    // The progress foreground must be ready without delegating it to a gradient renderer.
    LinearGradient: class { constructor() { throw new Error('Progress must not create a gradient'); } },
    Device: { isUsingDarkAppearance() { throw new Error('Appearance queries are unsupported in widgets'); } },
  });
  return { ...api, parent: () => new Stack() };
}

test('39% is painted into an image synchronously, with theme-aware track and static foreground', () => {
  const api = renderer();
  for (const layout of ['original', 'dark', 'gradient']) for (const theme of ['light', 'dark', 'auto']) {
    const colors = api.layoutColors({ layout, theme });
    const bar = api.progressBar(api.parent(), 39, colors);
    assert.equal(api.percentLabel(39), '39% left');
    assert.equal(bar.backgroundColor, colors.track);
    assert.equal(bar.backgroundGradient, undefined);
    assert.equal(bar.backgroundImage, undefined);
    assert.equal(bar.children[0].backgroundColor, undefined);
    const image = bar.children[0].backgroundImage;
    assert.equal(image.opaque, false);
    assert.equal(image.respectScreenScale, false);
    assert.equal(image.size.width, image.size.height);
    assert.equal(image.fills.length, 1);
    const { rect, color } = image.fills[0];
    assert.equal(rect.x, 0);
    assert.equal(rect.y, 0);
    assert.equal(rect.height, image.size.height);
    assert.equal(rect.width / image.size.width, 0.39);
    assert.equal(color.dynamic, undefined);
    assert.equal(color.hex, layout === 'gradient' ? 'FFFFFF' : layout !== 'dark' && theme === 'light' ? '0088FF' : '0A84FF');
    // A square raster filled from top to bottom preserves the ratio when a
    // horizontal native background stretches or aspect-fills and crops vertically.
    for (const width of [110, 132, 158, 270, 308, 342]) {
      const scale = Math.max(width / image.size.width, 4 / image.size.height);
      assert.equal(Math.round(rect.width * scale / width * 100), 39);
    }
  }
});

test('unknown and zero have no foreground; fractional and full percentages keep their meaning', () => {
  const api = renderer(), colors = api.layoutColors({ layout: 'dark', theme: 'auto' });
  for (const value of [null, undefined, NaN, -1, 101, '39', 0]) {
    const bar = api.progressBar(api.parent(), value, colors);
    assert.equal(bar.backgroundImage, undefined);
    assert.equal(bar.children.length, 0);
    assert.equal(bar.backgroundColor, colors.track);
    assert.equal(api.percentLabel(value), value === 0 ? '0% left' : '—');
  }
  for (const value of [0.5, 1, 29, 39, 99.9]) {
    const image = api.progressBar(api.parent(), value, colors).children[0].backgroundImage;
    assert.ok(Math.abs(image.fills[0].rect.width / image.size.width - value / 100) < 1e-12);
  }
  const full = api.progressBar(api.parent(), 100, colors);
  assert.equal(full.backgroundImage, undefined);
  assert.equal(full.backgroundColor, colors.blue);
});
