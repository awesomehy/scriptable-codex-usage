// Render the actual Scriptable tree into a standalone, approximate browser preview.
// No external packages or network calls. iOS typography/layout still needs device QA.
import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = await readFile(new URL('../CodexUsage.js', import.meta.url), 'utf8');
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function capture(family, settings, options = {}) {
  let widget, completed = false;
  class Node {
    constructor(kind = 'stack', value) { this.kind = kind; this.value = value; this.children = []; this.direction = kind === 'widget' ? 'column' : 'row'; }
    add(kind, value) { const child = new Node(kind, value); this.children.push(child); return child; }
    addText(value) { return this.add('text', value); }
    addImage(value) { return this.add('image', value); }
    addStack() { return this.add('stack'); }
    addSpacer(length) { return this.add('spacer', length); }
    layoutVertically() { this.direction = 'column'; }
    layoutHorizontally() { this.direction = 'row'; }
    centerAlignContent() { this.align = 'center'; }
    setPadding(...padding) { this.padding = padding; }
  }
  class Size { constructor(width, height) { Object.assign(this, { width, height }); } }
  class Point { constructor(x, y) { Object.assign(this, { x, y }); } }
  class Rect { constructor(x, y, width, height) { Object.assign(this, { x, y, width, height }); } }
  class Color {
    constructor(hex) { this.hex = '#' + hex; }
    static dynamic(light, dark) { return options.dark ? dark : light; }
  }
  class Path {
    commands = [];
    move(p) { this.commands.push(`M${p.x},${p.y}`); }
    addLine(p) { this.commands.push(`L${p.x},${p.y}`); }
    closeSubpath() { this.commands.push('Z'); }
  }
  class DrawContext {
    paths = [];
    setFillColor(color) { this.fillColor = color; }
    fillRect(rect) { this.paths.push(`<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="${this.fillColor.hex}"/>`); }
    setStrokeColor(color) { this.color = color; }
    setLineWidth(width) { this.width = width; }
    addPath(path) { this.path = path; }
    strokePath() { this.paths.push(`<path d="${this.path.commands.join(' ')}" fill="none" stroke="${this.color.hex}" stroke-width="${this.width}" stroke-linejoin="round" stroke-linecap="round"/>`); }
    setFont(font) { this.font = font; }
    setTextColor(color) { this.textColor = color; }
    setTextAlignedCenter() {}
    drawTextInRect(value, rect) { this.paths.push(`<text x="${rect.x + rect.width / 2}" y="${rect.y + this.font}" text-anchor="middle" fill="${this.textColor.hex}" font-size="${this.font}" font-family="sans-serif">${esc(value)}</text>`); }
    getImage() { return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.size.width} ${this.size.height}">${this.paths.join('')}</svg>`; }
  }
  const api = await vm.runInNewContext(`(async()=>{${source}\nreturn {readSettings, loadUsage, percentLabel, resetLabel, effectiveStatus, footerLabel, renderWidget, quotaRing, layoutColors, DEMO_NOW};})()`, {
    ListWidget: class extends Node { constructor() { super('widget'); } },
    Color, Size, Point, Rect, Path, DrawContext, LinearGradient: class {},
    Font: { systemFont: size => size },
    Device: { screenSize: () => new Size(options.screenWidth || 393, 852) },
    Script: { name: () => 'CodexUsage', setWidget: value => { widget = value; }, complete: () => { completed = true; } },
    config: { runsInApp: false, runsInWidget: true, widgetFamily: family },
    args: { widgetParameter: JSON.stringify(settings) },
    Keychain: { contains: () => false },
    ...options.globals,
  });
  assert.ok(completed && widget, 'Scriptable entry point must produce a widget and complete');
  return { widget, api };
}

function html(node, parentDirection = 'column') {
  const css = [];
  if (node.kind === 'spacer') return `<i style="display:block;${node.value === undefined ? 'flex:1;min-width:0;min-height:0' : `flex:0 0 ${node.value}px`}"></i>`;
  if (node.kind === 'text') {
    return `<span class="native-text" style="font-size:${node.font}px;color:${node.textColor.hex};${node.lineLimit > 1 ? 'white-space:normal' : ''}">${esc(node.value)}</span>`;
  }
  if (node.kind === 'image') {
    return `<img alt="" style="flex:none;width:${node.imageSize.width}px;height:${node.imageSize.height}px" src="data:image/svg+xml,${encodeURIComponent(node.value)}">`;
  }
  css.push('display:flex', `flex-direction:${node.direction}`, 'min-width:0', 'min-height:0');
  if (node.align) css.push(`align-items:${node.align}`);
  if (node.padding) css.push(`padding:${node.padding.map(n => `${n}px`).join(' ')}`);
  if (node.backgroundColor) css.push(`background:${node.backgroundColor.hex}`);
  if (node.backgroundImage) css.push(`background-image:url('data:image/svg+xml,${encodeURIComponent(node.backgroundImage)}')`, 'background-size:cover', 'background-position:center');
  if (node.backgroundGradient) {
    const gradient = node.backgroundGradient;
    css.push(`background:linear-gradient(90deg,${gradient.colors.map((c, i) => `${c.hex} ${gradient.locations[i] * 100}%`).join(',')})`);
  }
  if (node.cornerRadius) css.push(`border-radius:${node.cornerRadius}px`, 'overflow:hidden');
  if (node.size?.height) css.push(`height:${node.size.height}px`, 'flex-shrink:0');
  if (node.size?.width) css.push(`width:${node.size.width}px`);
  if (parentDirection === 'row' && node.children.some(child => child.kind === 'spacer' && child.value === undefined)) css.push('flex:1');
  return `<div class="${node.kind}" style="${css.join(';')}">${node.children.map(child => html(child, node.direction)).join('')}</div>`;
}

const states = {};
for (const layout of ['original', 'dark', 'gradient', 'dashboard']) for (const theme of ['light', 'dark']) for (const scenario of ['demo', 'stale', 'empty', 'error']) for (const window of ['weekly', 'session']) {
  const key = [layout, theme, scenario, window].join('/');
  states[key] = {};
  for (const family of ['small', 'medium', 'large']) {
    const { widget } = await capture(family, { layout, theme, scenario, window });
    states[key][family] = html(widget);
  }
}

// Verify the meaningful data-state boundaries, independently of layout markup.
const { api } = await capture('medium', {});
assert.equal(api.percentLabel(null), '—');
assert.equal(api.percentLabel(0), '0% left');
assert.equal(api.percentLabel(100), '100% left');
assert.equal(api.percentLabel(99.9), '99% left');
assert.equal(api.percentLabel(-1), '—');
assert.equal(api.percentLabel(NaN), '—');
assert.equal(api.resetLabel(new Date(api.DEMO_NOW - 1).toISOString(), api.DEMO_NOW), '重置时间已到 · 待刷新');
const settings = api.readSettings('{"scenario":"demo"}');
const demo = await api.loadUsage(settings);
assert.equal(api.effectiveStatus(demo, settings, api.DEMO_NOW + 30 * 60000), 'stale');
assert.ok(api.footerLabel(demo, 'stale', false).includes('10/24 23:58'));
assert.ok(api.footerLabel(await api.loadUsage({ scenario: 'error' }), 'error', false).includes('尚无成功刷新'));
assert.equal(api.readSettings('{"refreshMinutes":1,"refreshSeconds":5}').refreshSeconds, 600);
const invalid = await capture('small', { theme: 'invalid' });
assert.ok(html(invalid.widget).includes('参数有误'));

// Run the complete entry point with raw URL parameters and verify per-element links.
const descendants = node => [node, ...node.children.flatMap(descendants)];
// Local selections reach all sizes; unknown percentages draw only the track, never 0%.
for (const layout of ['original', 'dark', 'gradient', 'dashboard']) for (const family of ['small', 'medium', 'large']) for (const screenWidth of [375, 393]) {
  const { widget, api } = await capture(family, { scenario: 'demo', openURL: 'chatgpt://' }, { screenWidth, globals: {
    Keychain: { contains: key => key === 'CodexUsage.preferences.v1', get: () => JSON.stringify({ layout, refreshSeconds: 30 }) },
  } });
  assert.equal(widget.url, 'chatgpt://');
  assert.equal(api.readSettings('').layout, layout);
  assert.ok(descendants(widget).some(node => node.value?.toString().includes('23:58')));
  const colors = api.layoutColors({ layout, theme: 'light' });
  for (const value of [null, 0, 0.5, 100]) {
    const svg = api.quotaRing(value, colors, 52);
    assert.equal((svg.match(/<path /g) || []).length, value > 0 ? 2 : 1);
    assert.ok(svg.includes(value === null ? '—' : value === 0.5 ? '&lt;1%' : value + '%'));
  }
  if (family !== 'small') {
    const update = descendants(widget).find(node => node.value === '更新 ↗');
    assert.equal(JSON.parse(new URL(update.url).searchParams.get('parameter')).layout, undefined);
  }
}
for (const family of ['small', 'medium', 'large']) for (const target of ['chatgpt://', 'myapp://view?q=a%26b#details']) {
  const { widget } = await capture(family, {}, { globals: { args: { widgetParameter: target } } });
  assert.equal(widget.url, target);
  if (family !== 'small') {
    const update = descendants(widget).find(node => node.value === '更新 ↗');
    const link = new URL(update.url);
    assert.equal(link.protocol, 'scriptable:');
    assert.equal(link.searchParams.get('action'), 'update');
    assert.equal(JSON.parse(link.searchParams.get('parameter')).openURL, target);
    assert.equal(JSON.parse(link.searchParams.get('parameter')).refreshSeconds, undefined);
  }
}

// All sizes schedule the saved local interval; server retry deadlines still win.
const clock = Date.parse('2026-10-24T15:58:00Z');
class Clock extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
for (const family of ['small', 'medium', 'large']) for (const seconds of [1, 30, 86400]) {
  const { widget, api } = await capture(family, { scenario: 'demo' }, { globals: {
    Date: Clock,
    Keychain: { contains: key => key === 'CodexUsage.preferences.v1', get: () => JSON.stringify({ refreshSeconds: seconds }) },
  } });
  assert.equal(widget.refreshAfterDate.getTime(), clock + seconds * 1000);
  const settings = api.readSettings('{"scenario":"demo"}');
  const snapshot = await api.loadUsage(settings);
  snapshot.retryAt = clock + 2 * 86400000;
  assert.equal(api.renderWidget(snapshot, settings, family, clock).refreshAfterDate.getTime(), snapshot.retryAt);
}

const output = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Codex Usage · Scriptable 预览</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f5f5f7;color:#171719;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}main{max-width:1140px;margin:0 auto;padding:44px 36px}h1{font-size:28px;font-weight:600;letter-spacing:-.7px;margin:0 0 10px}p{color:#6b6b72;line-height:1.7;margin:0 0 25px}.controls{display:flex;flex-wrap:wrap;gap:14px;margin:24px 0 30px}label{font-size:12px;color:#6b6b72}select{display:block;margin-top:7px;min-width:150px;padding:10px 12px;border:1px solid #dddde2;border-radius:10px;background:white;color:#171719;font:14px inherit}.stage{background:radial-gradient(ellipse at 17% 100%,#dbc7c0,transparent 58%),linear-gradient(140deg,#4583a6,#527a99 52%,#727691);border-radius:28px;padding:34px;display:flex;align-items:flex-start;gap:28px;flex-wrap:wrap}.device-label{font-size:12px;letter-spacing:.3px;color:#fff9;margin-bottom:14px}.widget{width:164px;height:164px;border-radius:29px;overflow:hidden;box-shadow:0 2px 8px #00000004}.medium .widget{width:344px;height:164px}.large .widget{width:344px;height:364px}.native-text{display:block;flex-shrink:0;line-height:1.2;font-weight:400;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;letter-spacing:-.15px}.note{margin:22px 0 0;font-size:12px;max-width:850px}.links{display:flex;gap:20px;margin-top:18px}a{color:#087bce;text-decoration:none}a:hover{text-decoration:underline}.legend{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#6b6b72;margin-bottom:4px}.dot{height:6px;width:6px;border-radius:50%;background:#0088ff}
@media(max-width:600px){main{padding:25px 16px}.stage{padding:22px 14px;gap:24px}.medium .widget,.large .widget{width:min(344px,calc(100vw - 60px))}h1{font-size:24px}}
</style></head><body><main>
<div class="legend"><span class="dot"></span>Scriptable · 1.0.5</div>
<h1>Codex 额度，一眼可见。</h1><p>四种可选布局；在脚本菜单中选择，也可用 Parameter 单独指定。</p>
<div class="controls"><label>布局<select id="layout"><option value="original">原版浅色</option><option value="dark">简洁深色</option><option value="gradient">渐变卡片</option><option value="dashboard">仪表盘</option></select></label><label>主题<select id="theme"><option value="light">浅色 · 原版风格</option><option value="dark">深色</option></select></label><label>数据状态<select id="scenario"><option value="demo">示例数据</option><option value="stale">示例 · 数据过期</option><option value="empty">尚未接入</option><option value="error">示例 · 请求失败</option></select></label><label>小号 / 中号额度窗口<select id="window"><option value="weekly">Weekly</option><option value="session">Session</option></select></label></div>
<div class="stage"><section class="small"><div class="device-label">小号 · 单个额度窗口</div><div id="small"></div></section><section class="medium"><div class="device-label">中号 · 单个额度窗口</div><div id="medium"></div></section><section class="large"><div class="device-label">大号 · 两个额度窗口</div><div id="large"></div></section></div>
<p class="note">本页使用示例数据，示例时钟固定为 2026-10-24 23:58。首次在 Scriptable 运行时填写自己的接口地址和 API Key，桌面参数留空即可。预览由实际脚本生成的组件树转换而来；浏览器与 iOS 字体、布局会有差别，请以 Scriptable 内预览为准。</p>
<div class="links"><a href="CodexUsage.js" download="CodexUsage.js">下载 Scriptable 脚本</a><a href="README.md">安装与参数说明</a></div>
</main><script>
const states=${JSON.stringify(states).replace(/</g, '\\u003c')};
function update(){const key=['layout','theme','scenario','window'].map(id=>document.getElementById(id).value).join('/');for(const family of ['small','medium','large'])document.getElementById(family).innerHTML=states[key][family];}
document.querySelectorAll('select').forEach(select=>select.addEventListener('change',update));update();
</script></body></html>`;
await writeFile(new URL('../preview.html', import.meta.url), output, 'utf8');
console.log('Generated preview.html from 192 native widget trees. Data-state checks passed.');
export { capture, html };
