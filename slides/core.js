/* Shared, dependency-free document model and renderer. Also used by the projector. */
(function (root) {
  'use strict';
  const WIDTH = 1280, HEIGHT = 720;
  const fonts = ['Arial', 'Noto Sans JP', 'Noto Serif JP', 'Yu Gothic', 'Yu Mincho', 'Meiryo', 'sans-serif', 'serif'];
  // Retain immutable strings (especially embedded images) across history entries.
  // JSON stringify/parse would allocate a fresh base64 copy on every keystroke.
  const clone = value => Array.isArray(value) ? value.map(clone) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) : value;
  const id = () => root.crypto?.randomUUID?.() || `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const number = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
  const color = (value, fallback = '#172b36') => /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
  function image(value) {
    if (typeof value !== 'string' || value.length > 16 * 1024 * 1024 || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/.test(value)) throw new Error('画像は PNG・JPEG・WebP・GIF（1枚約12MB以下）にしてください。');
    return value;
  }
  function textDoc(text = '') {
    return { type: 'doc', content: text.split('\n').map(line => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })) };
  }
  function cleanDoc(doc) {
    let count = 0;
    function visit(node, depth = 0) {
      if (++count > 20000 || depth > 24) throw new Error('文字データが大きすぎます。');
      if (!node || !['doc', 'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'hardBreak', 'text'].includes(node.type)) return null;
      if (node.type === 'text') {
        const result = { type: 'text', text: String(node.text || '').slice(0, 50000) };
        if (!result.text) return null;
        result.marks = (Array.isArray(node.marks) ? node.marks : []).flatMap(mark => {
          if (['bold', 'italic', 'underline', 'strike'].includes(mark.type)) return [{ type: mark.type }];
          if (mark.type !== 'textStyle') return [];
          const attrs = {};
          if (/^#[0-9a-f]{6}$/i.test(mark.attrs?.color || '')) attrs.color = mark.attrs.color;
          if (fonts.includes(mark.attrs?.fontFamily)) attrs.fontFamily = mark.attrs.fontFamily;
          if (/^\d+(\.\d+)?px$/.test(mark.attrs?.fontSize || '')) attrs.fontSize = `${number(parseFloat(mark.attrs.fontSize), 44, 8, 240)}px`;
          return [{ type: 'textStyle', attrs }];
        });
        return result;
      }
      const result = { type: node.type === 'heading' ? 'paragraph' : node.type };
      if (result.type === 'paragraph') result.attrs = { textAlign: ['left', 'center', 'right', 'justify'].includes(node.attrs?.textAlign) ? node.attrs.textAlign : 'left' };
      if (node.type !== 'hardBreak') result.content = (Array.isArray(node.content) ? node.content : []).map(child => visit(child, depth + 1)).filter(Boolean);
      const allowed = { doc: ['paragraph', 'bulletList', 'orderedList'], paragraph: ['text', 'hardBreak'], bulletList: ['listItem'], orderedList: ['listItem'], listItem: ['paragraph', 'bulletList', 'orderedList'], hardBreak: [] }[result.type];
      if ((result.content || []).some(child => !allowed.includes(child.type))) throw new Error('文字データの段落構造が正しくありません。');
      if (['bulletList', 'orderedList'].includes(result.type) && !result.content.length) return null;
      if (result.type === 'listItem' && result.content[0]?.type !== 'paragraph') result.content.unshift({ type: 'paragraph', content: [] });
      if (result.type === 'doc' && !result.content.length) result.content.push({ type: 'paragraph', content: [] });
      return result;
    }
    const result = visit(doc);
    if (result?.type !== 'doc') throw new Error('文字データの形式が正しくありません。');
    return result;
  }
  function element(type, extra = {}) {
    return { id: id(), type, x: 100, y: 100, width: type === 'text' ? 700 : 320, height: type === 'text' ? 160 : 220, rotation: 0, opacity: 1, fontSize: 44, fontFamily: 'Yu Gothic', color: '#172b36', fill: '#d9eee8', lineHeight: 1.5, ...extra };
  }
  function slide(name = 'スライド') { return { id: id(), name, background: '#ffffff', elements: [], notes: '' }; }
  function deck(name = '新しいプレゼンテーション') {
    const first = slide('タイトル');
    first.elements = [element('text', { x: 110, y: 220, width: 1060, height: 150, fontSize: 68, content: textDoc('ここにタイトルを入力') }), element('text', { x: 115, y: 400, width: 1000, height: 90, fontSize: 30, color: '#657c83', content: textDoc('ダブルクリックで文字を編集できます') })];
    return { format: 'assembly-slides', version: 1, id: id(), name, slides: [first] };
  }
  function validate(raw) {
    if (!raw || raw.format !== 'assembly-slides' || raw.version !== 1 || !Array.isArray(raw.slides) || raw.slides.length < 1 || raw.slides.length > 500) throw new Error('対応するスライド資料（バージョン1、1〜500枚）を選択してください。');
    const seen = new Set();
    const unique = value => { const key = typeof value === 'string' && value.length < 100 && !seen.has(value) ? value : id(); seen.add(key); return key; };
    return { format: 'assembly-slides', version: 1, id: typeof raw.id === 'string' ? raw.id.slice(0, 100) : id(), name: String(raw.name || '無題').slice(0, 200), slides: raw.slides.map(s => {
      if (!s || !Array.isArray(s.elements) || s.elements.length > 200) throw new Error('1枚に配置できる要素は200個までです。');
      return { id: unique(s.id), name: String(s.name || 'スライド').slice(0, 200), background: color(s.background, '#ffffff'), ...(s.backgroundImage ? { backgroundImage: image(s.backgroundImage) } : {}), notes: String(s.notes || '').slice(0, 50000), elements: s.elements.map(e => {
        if (!e || !['text', 'rect', 'ellipse', 'line', 'image'].includes(e.type)) throw new Error('対応していない要素が含まれています。');
        return element(e.type, { id: unique(e.id), x: number(e.x, 100, -2560, 2560), y: number(e.y, 100, -1440, 1440), width: number(e.width, 320, e.type === 'text' ? 20 : 1, 5120), height: number(e.height, 160, e.type === 'text' ? 8 : 1, 2880), rotation: number(e.rotation, 0, -360, 360), opacity: number(e.opacity, 1, 0, 1), fontSize: number(e.fontSize, 44, 8, 240), fontFamily: fonts.includes(e.fontFamily) ? e.fontFamily : 'Yu Gothic', color: color(e.color), fill: color(e.fill, '#d9eee8'), lineHeight: number(e.lineHeight, 1.5, 0.8, 3), ...(typeof e.group === 'string' ? { group: e.group.slice(0, 100) } : {}), ...(e.type === 'text' ? { content: cleanDoc(e.content || textDoc()) } : {}), ...(e.type === 'image' ? { src: image(e.src), fit: e.fit === 'cover' ? 'cover' : 'contain' } : {}) });
      }) };
    }) };
  }
  function renderText(doc, target) {
    const d = target.ownerDocument;
    const tags = { paragraph: 'p', heading: 'p', bulletList: 'ul', orderedList: 'ol', listItem: 'li', hardBreak: 'br' };
    function append(node, parent) {
      if (node.type === 'text') {
        let child = d.createTextNode(node.text);
        for (const mark of node.marks || []) {
          const tag = { bold: 'strong', italic: 'em', underline: 'u', strike: 's', textStyle: 'span' }[mark.type];
          if (!tag) continue;
          const span = d.createElement(tag);
          if (mark.type === 'textStyle') Object.assign(span.style, mark.attrs);
          span.append(child); child = span;
        }
        parent.append(child); return;
      }
      const child = node.type === 'doc' ? parent : d.createElement(tags[node.type] || 'p');
      if (node.attrs?.textAlign) child.style.textAlign = node.attrs.textAlign;
      (node.content || []).forEach(item => append(item, child));
      if (child !== parent) { if (!child.childNodes.length && node.type !== 'hardBreak') child.append(d.createElement('br')); parent.append(child); }
    }
    target.replaceChildren(); append(doc, target);
  }
  function styleElement(node, e) {
    Object.assign(node.style, { left: `${e.x}px`, top: `${e.y}px`, width: `${e.width}px`, height: `${e.height}px`, transform: `rotate(${e.rotation}deg)`, opacity: e.opacity, fontSize: `${e.fontSize}px`, fontFamily: `${e.fontFamily}, sans-serif`, color: e.color, lineHeight: e.lineHeight });
  }
  function renderSlide(s, canvas) {
    const d = canvas.ownerDocument;
    canvas.classList.add('slide-canvas');
    canvas.style.backgroundColor = s.background;
    canvas.style.backgroundImage = s.backgroundImage ? `url("${s.backgroundImage}")` : 'none';
    canvas.replaceChildren();
    for (const e of s.elements) {
      const node = d.createElement('div'); node.className = `slide-element slide-${e.type}`; node.dataset.elementId = e.id;
      styleElement(node, e);
      if (e.type === 'text') { const body = d.createElement('div'); body.className = 'slide-text-body'; renderText(e.content, body); node.append(body); }
      else if (e.type === 'image') { const img = d.createElement('img'); img.src = e.src; img.alt = ''; img.draggable = false; img.style.objectFit = e.fit; node.append(img); }
      else node.style.backgroundColor = e.fill;
      canvas.append(node);
    }
  }
  function fitCanvas(canvas, host, padding = 0) {
    const scale = Math.max(0.01, Math.min((host.clientWidth - padding) / WIDTH, (host.clientHeight - padding) / HEIGHT));
    canvas.style.transform = `translate(-50%, -50%) scale(${scale})`;
    return scale;
  }
  class History {
    constructor(value) { this.entries = [clone(value)]; this.index = 0; }
    push(value) { this.entries.splice(this.index + 1); this.entries.push(clone(value)); if (this.entries.length > 60) this.entries.shift(); this.index = this.entries.length - 1; }
    undo() { if (this.index > 0) this.index--; return clone(this.entries[this.index]); }
    redo() { if (this.index < this.entries.length - 1) this.index++; return clone(this.entries[this.index]); }
    get canUndo() { return this.index > 0; }
    get canRedo() { return this.index < this.entries.length - 1; }
  }
  const api = { WIDTH, HEIGHT, fonts, clone, id, number, color, image, textDoc, cleanDoc, element, slide, deck, validate, renderSlide, renderText, styleElement, fitCanvas, History };
  root.SlideCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
