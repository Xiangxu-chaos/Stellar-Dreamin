/**
 * verifyImageStandard.mjs —— 图片功能移除后的标准校验
 * ============================================================================
 * 现状：图片功能已彻底移除，卡片统一使用「暂无配图」占位块。零随机图库。
 *
 * 覆盖：
 *   一、禁随机图：全库不得出现 picsum / unsplash random / 任何随机图库
 *   二、数据规范：每条材料都有 imageUrl 字段，且值一律为 ""（无真实图链）
 *   三、图片相关逻辑已下线：无抓图 / 无外部图链接加载
 *   四、渲染行为：任何卡片都渲染占位块，绝不渲染 img
 *   五、布局铁律：aspect-ratio 16/9 + max-height + overflow:hidden + 灰色占位
 *   六、边界：components/pages 无 fetch/localStorage
 * ============================================================================
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const pass = [];
const fail = [];
function ok(name, cond, extra = '') {
  (cond ? pass : fail).push(`${cond ? '\u2714' : '\u2718'} ${name}${extra ? ' — ' + extra : ''}`);
}

/* ---------------- DOM / BOM 最小 shim ---------------- */
class TextNode { constructor(t) { this.nodeType = 3; this._t = String(t); } get textContent() { return this._t; } set textContent(v) { this._t = String(v); } }

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.parentNode = null;
    this._cls = new Set();
    this._ev = {};
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    const self = this;
    this.classList = {
      add(...c) { c.forEach((x) => self._cls.add(x)); },
      remove(...c) { c.forEach((x) => self._cls.delete(x)); },
      toggle(c, f) { const on = f === undefined ? !self._cls.has(c) : !!f; if (on) self._cls.add(c); else self._cls.delete(c); return on; },
      contains(c) { return self._cls.has(c); },
    };
  }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.children.push(n); return n; }
  append(...ns) { ns.forEach((n) => { if (n) this.appendChild(n); }); }
  removeChild(n) { const i = this.children.indexOf(n); if (i >= 0) { this.children.splice(i, 1); n.parentNode = null; } return n; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceChildren(...ns) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this.append(...ns); }
  setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'class') this.className = v; }
  getAttribute(k) { return this.attributes[k] ?? null; }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener(t, fn) { (this._ev[t] = this._ev[t] || []).push(fn); }
  removeEventListener(t, fn) { const a = this._ev[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
  dispatch(t, ev = {}) {
    let node = this;
    while (node) {
      const list = (node._ev && node._ev[t]) || [];
      for (const fn of list) {
        let stopped = false;
        fn({ target: this, currentTarget: node, stopPropagation() { stopped = true; }, preventDefault() {}, ...ev });
        if (stopped) return;
      }
      node = node.parentNode;
    }
  }
  click() { this.dispatch('click', {}); }
  get textContent() { if (this._text !== undefined) return this._text; return this.children.map((c) => c.textContent || '').join(''); }
  set textContent(v) { this._text = String(v); this.children = []; }
  _find(sel, first) {
    const out = [];
    const test = (n) => {
      if (n.nodeType !== 1) return false;
      if (sel.startsWith('.')) return n._cls.has(sel.slice(1));
      if (sel.startsWith('#')) return n.attributes.id === sel.slice(1);
      return n.tagName === sel.toUpperCase();
    };
    const walk = (n) => { for (const c of n.children || []) { if (test(c)) { out.push(c); if (first) return true; } if (walk(c) && first) return true; } return false; };
    walk(this);
    return first ? (out[0] || null) : out;
  }
  querySelector(s) { return this._find(s, true); }
  querySelectorAll(s) { return this._find(s, false); }
  contains(n) { let p = n; while (p) { if (p === this) return true; p = p.parentNode; } return false; }
  get firstChild() { return this.children[0] || null; }
  insertAdjacentElement(_pos, n) { return this.appendChild(n); }
}

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
  setItem: (k, v) => store.set(String(k), String(v)),
  removeItem: (k) => store.delete(String(k)),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i],
  get length() { return store.size; },
};

const body = new El('body');
globalThis.window = {
  addEventListener() {}, removeEventListener() {}, location: { reload() {}, href: 'http://127.0.0.1:8777/' },
  scrollTo() {}, innerWidth: 1440, innerHeight: 900, localStorage: globalThis.localStorage,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  requestAnimationFrame: (fn) => setTimeout(() => fn(0), 0),
};
globalThis.document = {
  createElement: (t) => new El(t),
  createTextNode: (t) => new TextNode(t),
  createElementNS: (_ns, t) => new El(t),
  body, documentElement: new El('html'),
  querySelector: (s) => body.querySelector(s), querySelectorAll: (s) => body.querySelectorAll(s),
  addEventListener() {}, removeEventListener() {},
};
globalThis.Node = El; globalThis.HTMLElement = El; globalThis.Element = El;
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });

globalThis.fetch = async (url) => {
  const u = String(url).replace(/^file:\/\/\/?/, '');
  const p = path.isAbsolute(u) ? u : path.join(ROOT, u.replace(/^\//, ''));
  if (!existsSync(p)) return { ok: false, status: 404, async json() { throw new Error('404 ' + p); }, async text() { return ''; } };
  const t = readFileSync(p, 'utf8');
  return { ok: true, status: 200, async json() { return JSON.parse(t); }, async text() { return t; } };
};

const flush = (ms = 30) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 载入被测模块 ---------------- */
const ds = (await import('../src/services/dataService.js')).default;
const dms = (await import('../src/services/domainMaterialService.js')).default;
const { resolveImage, pickImage } = await import('../src/services/domainMaterialService.js');
const { createWordCard } = await import('../src/components/wordCard.js');

const CSS = readFileSync(path.join(ROOT, 'src/styles/components.css'), 'utf8');

/* ==========================================================================
 * 一、禁随机图库
 * ======================================================================= */
function collect(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) collect(p, out);
    else out.push(p);
  }
  return out;
}
const allSrcFiles = collect(path.join(ROOT, 'src'));
const jsFiles = allSrcFiles.filter((f) => f.endsWith('.js'));
const jsonFiles = allSrcFiles.filter((f) => f.endsWith('.json'));

const RANDOM_HOSTS = /picsum\.photos|unsplash\.com|placekitten|loremflickr|dummyimage|placehold\.(co|it)|source\.unsplash|randomuser\.me|thecatapi|dog\.ceo/i;
const randomHits = [];
for (const f of [...jsFiles, ...jsonFiles]) {
  const src = readFileSync(f, 'utf8');
  // 注释里的「禁令说明」不算违规，只看代码/数据行
  const code = src.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
  if (RANDOM_HOSTS.test(code)) randomHits.push(path.relative(ROOT, f));
}
ok('全库无随机图库引用（代码 / 数据）', randomHits.length === 0, randomHits.join(', '));
ok('mockImages.json 不存在（随机图测试文件已删除）', !existsSync(path.join(ROOT, 'src/data/mockImages.json')));

const dmsSrc = readFileSync(path.join(ROOT, 'src/services/domainMaterialService.js'), 'utf8');
ok('domainMaterialService 无 loadMockImages', !/function\s+loadMockImages/.test(dmsSrc));
ok('domainMaterialService 无 getMockImage', !/function\s+getMockImage/.test(dmsSrc));
ok('domainMaterialService 无 fromMock 统计字段', !/fromMock/.test(dmsSrc));

const wbsSrc = readFileSync(path.join(ROOT, 'src/services/wordBankService.js'), 'utf8');
ok('wordBankService 无 MOCK_IMAGES_FILE', !/MOCK_IMAGES_FILE/.test(wbsSrc));

/* ==========================================================================
 * 二、数据规范：imageUrl 字段存在且一律为 ""
 * ======================================================================= */
const DOMAIN_FILES = ['slayTheSpire.json', 'hollowKnight.json', 'honorOfKings.json', 'valorant.json'];
let totalEntries = 0, missingField = 0, nonEmpty = 0;
const nonEmptyOwners = [];
const badUrls = [];

for (const f of DOMAIN_FILES) {
  const j = JSON.parse(readFileSync(path.join(ROOT, 'src/data/domainMaterials', f), 'utf8'));
  for (const [word, m] of Object.entries(j.materials)) {
    totalEntries++;
    if (!Object.prototype.hasOwnProperty.call(m, 'imageUrl')) { missingField++; badUrls.push(`${f}/${word} 缺字段`); continue; }
    if (m.imageUrl) {
      nonEmpty++;
      nonEmptyOwners.push(`${f}/${word}`);
      if (RANDOM_HOSTS.test(m.imageUrl)) badUrls.push(`${f}/${word} 指向随机图库`);
    }
  }
}
ok(`全部 ${totalEntries} 条材料都有 imageUrl 字段（占位保留）`, missingField === 0, missingField ? `${missingField} 条缺失` : '');
ok('所有词条 imageUrl 已清空为 ""', nonEmpty === 0, nonEmpty ? `${nonEmpty} 条非空：${nonEmptyOwners.slice(0, 5).join(', ')}` : '');
ok('无任何 imageUrl 指向随机图库', badUrls.length === 0, badUrls.slice(0, 5).join('; '));

/* 材料文件内容完整性（清理 imageUrl 不得破坏原有字段） */
let lostExample = 0;
for (const f of DOMAIN_FILES) {
  const j = JSON.parse(readFileSync(path.join(ROOT, 'src/data/domainMaterials', f), 'utf8'));
  for (const m of Object.values(j.materials)) {
    if (typeof m.example !== 'string' || !m.example.trim()) lostExample++;
    if (typeof m.exampleZh !== 'string' || !m.exampleZh.trim()) lostExample++;
  }
}
ok('所有材料仍保留 example / exampleZh（清理未破坏数据）', lostExample === 0, lostExample ? `${lostExample} 处丢失` : '');

/* ==========================================================================
 * 三、图片相关逻辑已下线：无抓图 / 无外部图链接加载
 * ======================================================================= */
/* resolveImage 仍作为数据层工具存在，但真实数据里已无图可解析 ——
   所有词条解析结果都必须是空串（占位块）。 */
await dms.preloadAll();
ok('无任何图 → 空串（占位块）',
  (await resolveImage('slay_the_spire', '__none__', null)) === '');
ok('空 imageUrl 材料 → 空串（占位块）',
  (await resolveImage('slay_the_spire', 'relic', { imageUrl: '' })) === '');

const matReal = await dms.getMaterial('slay_the_spire', 'relic');
ok('真实材料 imageUrl 为空（无真实图链）', Boolean(matReal) && matReal.imageUrl === '', matReal ? JSON.stringify(matReal.imageUrl) : 'null');

const words = [{ word: 'relic' }, { word: 'barrier' }];
await dms.attachMaterials('slay_the_spire', words);
ok('attachMaterials 对全部词条解析出空串（占位块）',
  words.every((w) => w.image === ''), JSON.stringify(words.map((w) => w.image)));

ok('pickImage 对空材料返回空串（占位块）', pickImage({}) === '' && pickImage({ material: { imageUrl: '' } }) === '');

/* 组件层面：不得出现任何 <img> 渲染逻辑 */
const wcSrc = readFileSync(path.join(ROOT, 'src/components/wordCard.js'), 'utf8');
const wcCode = wcSrc.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
ok('wordCard 不再创建 img 元素', !/h\(\s*['"]img/.test(wcCode));
ok('wordCard 不再有 onError / referrerPolicy（图片加载逻辑）', !/onError|referrerPolicy/.test(wcCode));
ok('wordCard 不再有 image 入参', !/\bimage\b\s*[,}]/.test(wcCode.replace(/buildFigure|buildPlaceholder/g, '')));

const dmSrc = readFileSync(path.join(ROOT, 'src/components/detailModal.js'), 'utf8');
const dmCode = dmSrc.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
ok('detailModal 不再创建 img 元素', !/h\(\s*['"]img/.test(dmCode));
ok('detailModal 已移除图片 URL 编辑', !/粘贴图片 URL|保存图片/.test(dmCode));
ok('detailModal 已移除本地上传逻辑（FileReader / File）', !/readAsDataURL|FileReader/.test(dmCode));
ok('detailModal 已移除 MAX_UPLOAD_BYTES 常量', !/MAX_UPLOAD_BYTES/.test(dmSrc));

const hpSrc = readFileSync(path.join(ROOT, 'src/pages/homePage.js'), 'utf8');
ok('homePage 已移除配图保存 / 上传回调', !/onSaveImage|onUploadImage|onClearUpload/.test(hpSrc));
ok('homePage 已移除 refreshCardImage', !/refreshCardImage/.test(hpSrc));

/* ==========================================================================
 * 四、渲染行为：任何卡片都渲染占位块，绝不渲染 img
 * ======================================================================= */
const card1 = createWordCard({
  word: { word: 'relic', translation: '遗物', type: 'core' },
  material: { example: 'A relic.', exampleZh: '一件遗物。' },
  domain: { id: 'slay_the_spire', name: '杀戮尖塔', icon: 'tower' },
});
await flush(10);
ok('卡片渲染占位块 .wordcard__ph-figure', Boolean(card1.querySelector('.wordcard__ph-figure')));
ok('卡片不渲染任何 img', card1.querySelectorAll('.wordcard__img').length === 0 && card1.querySelectorAll('img').length === 0);
ok('占位块文案为「暂无配图」',
  (card1.querySelector('.wordcard__ph-figure')?.textContent || '').includes('暂无配图'));

/* 即便调用方仍传入 image（旧数据兼容），也不得渲染成 img */
const card2 = createWordCard({
  word: { word: 'barrier', translation: '屏障', type: 'core' },
  material: { example: 'A barrier.', exampleZh: '一道屏障。' },
  image: 'https://example.com/x.png',
  domain: { id: 'slay_the_spire', name: '杀戮尖塔', icon: 'tower' },
});
await flush(10);
ok('忽略外部 image 入参，仍渲染占位块',
  Boolean(card2.querySelector('.wordcard__ph-figure')) && card2.querySelectorAll('img').length === 0);

/* ==========================================================================
 * 五、布局铁律：16/9 + max-height + overflow:hidden + 灰色占位
 * ======================================================================= */
const figBlock = CSS.match(/\.wordcard__figure\s*\{[\s\S]*?\}/);
ok('.wordcard__figure 有 aspect-ratio: 16 / 9', Boolean(figBlock) && /aspect-ratio:\s*16\s*\/\s*9/.test(figBlock[0]));
ok('.wordcard__figure 有 max-height', Boolean(figBlock) && /max-height:\s*\d+px/.test(figBlock[0]));
ok('.wordcard__figure 有 overflow: hidden', Boolean(figBlock) && /overflow:\s*hidden/.test(figBlock[0]));
ok('.wordcard__figure 不再使用固定 height', Boolean(figBlock) && !/(^|[^-])height:\s*\d+px/.test(figBlock[0]));
ok('.wordcard__figure 使用灰色占位背景', Boolean(figBlock) && /background:\s*rgba\(\s*128\s*,\s*132\s*,\s*148/.test(figBlock[0]));

const phBlock = CSS.match(/\.wordcard__ph-figure\s*\{[\s\S]*?\}/);
ok('.wordcard__ph-figure 铺满容器',
  Boolean(phBlock) && /width:\s*100%/.test(phBlock[0]) && /height:\s*100%/.test(phBlock[0]));
ok('.wordcard__ph-figure 有 overflow: hidden', Boolean(phBlock) && /overflow:\s*hidden/.test(phBlock[0]));

const detailFig = CSS.match(/\.detail__figure\s*\{[\s\S]*?\}/);
ok('.detail__figure 有 aspect-ratio: 16 / 9', Boolean(detailFig) && /aspect-ratio:\s*16\s*\/\s*9/.test(detailFig[0]));
ok('.detail__figure 有 max-height', Boolean(detailFig) && /max-height:\s*\d+px/.test(detailFig[0]));
ok('.detail__figure 有 overflow: hidden', Boolean(detailFig) && /overflow:\s*hidden/.test(detailFig[0]));
ok('.detail__figure 使用灰色占位背景', Boolean(detailFig) && /background:\s*rgba\(\s*128\s*,\s*132\s*,\s*148/.test(detailFig[0]));
ok('CSS 中不再存在 .wordcard__img 规则', !/\.wordcard__img\s*\{/.test(CSS));
ok('CSS 中不再存在 .detail__figure img 规则', !/\.detail__figure\s+img\s*\{/.test(CSS));
ok('CSS 中不再存在 .image-editor 规则', !/\.image-editor\s*\{/.test(CSS));

/* ==========================================================================
 * 六、边界铁律
 * ======================================================================= */
const layerFiles = [
  ...collect(path.join(ROOT, 'src/components')),
  ...collect(path.join(ROOT, 'src/pages')),
].filter((f) => f.endsWith('.js'));
const fetchViolations = [], lsViolations = [];
for (const f of layerFiles) {
  const src = readFileSync(f, 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
  if (/[^.\w]fetch\s*\(/.test(code)) fetchViolations.push(path.relative(ROOT, f));
  if (/localStorage\s*\./.test(code)) lsViolations.push(path.relative(ROOT, f));
}
ok('components/pages 无 fetch 调用', fetchViolations.length === 0, fetchViolations.join(', '));
ok('components/pages 无 localStorage 直接访问', lsViolations.length === 0, lsViolations.join(', '));

const cfgSrc = readFileSync(path.join(ROOT, 'src/config/interestsConfig.js'), 'utf8');
ok('interestsConfig 保留「所有领域材料必须支持 imageUrl 字段，用于卡片配图」规范',
  cfgSrc.includes('所有领域材料必须支持 imageUrl 字段，用于卡片配图'));
ok('interestsConfig 写明 imageUrl 必须占位不可省略', /不允许省略\s*imageUrl\s*字段/.test(cfgSrc));
ok('interestsConfig 写明严禁随机图库', /严禁接入任何随机图库/.test(cfgSrc));

/* ==========================================================================
 * 汇总
 * ======================================================================= */
console.log('\n===== verifyImageStandard =====');
for (const line of pass) console.log(line);
for (const line of fail) console.log(line);
console.log(`\n通过 ${pass.length} / ${pass.length + fail.length}`);
if (fail.length) { console.error(`\n❌ 有 ${fail.length} 条断言失败`); process.exit(1); }
console.log('✅ 全部通过');
