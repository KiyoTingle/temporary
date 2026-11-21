import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, Color, FontFamily, FontSize } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Moveable from 'moveable';
import Selecto from 'selecto';
import './core.js';
import { openStorage } from './storage.js';

const C = globalThis.SlideCore;
const $ = id => document.getElementById(id);
let deck = C.deck(), current = 0, selected = new Set(), history;
let editor = null, editingId = null, textTimer, saveTimer, toastTimer;
let storage, revision = 0, savedRevision = -1, saveQueue = Promise.resolve(), ready = false;
let copiedStyle = null;
let clipboard = null, imagePurpose = 'element', draggedSlide = null, scale = 1, gesture = false;
let standaloneWindow = null, published = null;
const canvas = $('canvas'), stage = $('stage-scroll'), space = $('stage-space');
const currentSlide = () => deck.slides[current];
const selection = () => currentSlide().elements.filter(e => selected.has(e.id));
function bounds(items) {
  const x = Math.min(...items.map(e => e.x)), y = Math.min(...items.map(e => e.y));
  return { x, y, width: Math.max(...items.map(e => e.x + e.width)) - x, height: Math.max(...items.map(e => e.y + e.height)) - y };
}
function units(items) {
  const groups = new Map();
  items.forEach(e => { const key = e.group || e.id; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(e); });
  return [...groups.values()].map(elements => ({ ...bounds(elements), elements }));
}
const nodeFor = id => Array.from(canvas.children).find(node => node.dataset.elementId === id);
function notify(message, error = false) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 9000 : 3800);
}
function bridge() {
  try { return window.opener && !window.opener.closed && window.opener.location.origin === location.origin ? window.opener.SlideProjection : null; }
  catch { return null; }
}
function changed() {
  revision++;
  $('save-status').textContent = storage ? '保存待ち…' : '自動保存できません';
  clearTimeout(saveTimer); saveTimer = setTimeout(save, 450);
}
function save() {
  clearTimeout(saveTimer);
  if (!storage) return Promise.resolve();
  const snapshot = C.clone(deck), version = revision;
  $('save-status').textContent = '保存中…';
  saveQueue = saveQueue.catch(() => {}).then(() => storage.save(snapshot)).then(() => {
    savedRevision = version;
    if (revision === version) $('save-status').textContent = 'この端末に保存済み';
  }).catch(error => {
    $('save-status').textContent = '保存失敗・ファイル保存を';
    notify(`自動保存できません。資料を保存してバックアップしてください。${error.message || ''}`, true);
  });
  return saveQueue;
}
function flushText() {
  if (!textTimer) return;
  clearTimeout(textTimer); textTimer = null;
  history.push(deck); changed(); renderRail(); updateHistory();
}
function finishEditing() {
  flushText();
  if (!editor) return;
  const node = nodeFor(editingId), data = currentSlide().elements.find(e => e.id === editingId);
  editor.destroy(); editor = null; editingId = null;
  if (node && data) { node.classList.remove('editing'); const body = document.createElement('div'); body.className = 'slide-text-body'; C.renderText(data.content, body); node.replaceChildren(body); }
  updateSelection();
}
function commit(mutator, { keepEditing = false } = {}) {
  if (!keepEditing) finishEditing();
  else flushText();
  mutator(); history.push(deck); changed();
  if (keepEditing) { renderRail(); updateProperties(); updateHistory(); }
  else render();
}
function fit() {
  const value = $('zoom').value;
  const fitting = value === 'fit';
  // Remove scrollbars before measuring. Classic Windows scrollbars change clientWidth/Height.
  stage.classList.toggle('is-fit', fitting);
  scale = fitting ? Math.max(.08, Math.min((stage.clientWidth - 70) / C.WIDTH, (stage.clientHeight - 50) / C.HEIGHT)) : Number(value);
  space.style.width = fitting ? '100%' : `${C.WIDTH * scale + 70}px`;
  space.style.height = fitting ? '100%' : `${C.HEIGHT * scale + 50}px`;
  canvas.style.transform = `translate(-50%, -50%) scale(${scale})`;
  moveable.zoom = 1 / scale;
  moveable.updateRect();
}
function renderRail() {
  const list = $('slide-list');
  const hadFocus = list.contains(document.activeElement);
  list.replaceChildren();
  deck.slides.forEach((s, index) => {
    const item = document.createElement('div'); item.className = `slide-item${index === current ? ' active' : ''}`; item.draggable = true; item.dataset.slideId = s.id;
    item.tabIndex = 0; item.setAttribute('role', 'button'); item.setAttribute('aria-label', `${index + 1}. ${s.name}`); item.setAttribute('aria-pressed', String(index === current));
    const number = document.createElement('span'); number.className = 'slide-number'; number.textContent = index + 1;
    const thumb = document.createElement('div'); thumb.className = 'slide-thumb'; const miniature = document.createElement('div'); C.renderSlide(s, miniature); thumb.append(miniature);
    const label = document.createElement('span'); label.className = 'slide-label'; label.textContent = s.name;
    item.append(number, thumb, label); list.append(item);
    // Scale thumbnails after insertion, without constructing editor instances.
    miniature.style.transform = `translate(-50%, -50%) scale(${(thumb.clientWidth || 150) / C.WIDTH})`;
    item.addEventListener('click', () => { selectSlide(index); focusThumbnail(); });
    item.addEventListener('keydown', event => {
      if (event.isComposing) return;
      let destination = index;
      let action;
      switch (event.key) {
        case 'ArrowUp': destination = Math.max(0, index - 1); break;
        case 'ArrowDown': destination = Math.min(deck.slides.length - 1, index + 1); break;
        case 'Delete': case 'Backspace': action = 'delete-slide'; break;
        case 'd': case 'D':
          if (!event.ctrlKey && !event.metaKey) return;
          action = 'duplicate-slide'; break;
        case 'Enter': case ' ': break;
        default: return;
      }
      event.preventDefault();
      event.stopPropagation();
      selectSlide(destination);
      focusThumbnail();
      if (action) actions[action]();
    });
    item.addEventListener('dragstart', event => { finishEditing(); draggedSlide = s.id; event.dataTransfer.setData('text/plain', s.id); event.dataTransfer.effectAllowed = 'move'; });
    item.addEventListener('dragover', event => { if (draggedSlide) { event.preventDefault(); item.classList.add('drag-over'); } });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('dragend', () => { draggedSlide = null; document.querySelectorAll('.drag-over').forEach(n => n.classList.remove('drag-over')); });
    item.addEventListener('drop', event => {
      event.preventDefault(); if (!draggedSlide || draggedSlide === s.id) return;
      const sourceId = draggedSlide; draggedSlide = null;
      commit(() => { const active = currentSlide().id; const from = deck.slides.findIndex(v => v.id === sourceId); const to = deck.slides.findIndex(v => v.id === s.id); const [moved] = deck.slides.splice(from, 1); deck.slides.splice(to, 0, moved); current = deck.slides.findIndex(v => v.id === active); });
    });
  });
  if (hadFocus) focusThumbnail();
  $('page-status').textContent = `${current + 1} / ${deck.slides.length}`;
}
function focusThumbnail() { $('slide-list').querySelector('.slide-item.active')?.focus(); }
function textSummary(e) {
  if (e.type !== 'text') return { image: '画像', rect: '四角形', ellipse: '円・楕円', line: '線' }[e.type];
  const walk = node => node.type === 'text' ? node.text : (node.content || []).map(walk).join('');
  return walk(e.content).slice(0, 40) || 'テキスト';
}
function renderLayers() {
  $('layers').replaceChildren();
  [...currentSlide().elements].reverse().forEach(e => {
    const button = document.createElement('button'); button.className = `layer${selected.has(e.id) ? ' active' : ''}`;
    const icon = document.createElement('small'); icon.textContent = e.type === 'text' ? 'Ｔ' : e.type === 'image' ? '▧' : '◇';
    const name = document.createElement('span'); name.textContent = textSummary(e); button.append(icon, name);
    button.addEventListener('click', event => { finishEditing(); choose([e.id], event.shiftKey); });
    $('layers').append(button);
  });
  if (!currentSlide().elements.length) $('layers').textContent = 'テキストや画像を挿入できます';
}
function updateHistory() {
  document.querySelectorAll('[data-action="undo"]').forEach(n => { n.disabled = !history?.canUndo; });
  document.querySelectorAll('[data-action="redo"]').forEach(n => { n.disabled = !history?.canRedo; });
}
function updateProperties() {
  const items = selection(), first = items[0];
  $('element-properties').disabled = !first;
  $('element-options').disabled = !first && !clipboard;
  $('selection-heading').textContent = first ? (items.length === 1 ? textSummary(first).slice(0, 15) : '複数の要素') : 'スライドの設定';
  $('selection-count').textContent = first ? `${items.length}個を選択中${first.group ? ' · グループ' : ''}` : '要素を選択してください';
  const geometry = items.length > 1 ? { ...first, ...bounds(items) } : first;
  for (const prop of ['x', 'y', 'width', 'height', 'rotation', 'opacity', 'lineHeight']) $('prop-' + prop).value = geometry ? Math.round(geometry[prop] * 100) / 100 : '';
  const shape = items.find(e => C.isTextShape(e.type));
  const filled = items.find(e => C.isTextShape(e.type) || e.type === 'line');
  const text = items.find(e => C.supportsText(e.type));
  const image = items.find(e => e.type === 'image');
  $('shape-fill').closest('label').hidden = !filled;
  $('shape-outline').hidden = !shape;
  $('vertical-align').closest('label').hidden = !text;
  $('prop-lineHeight').closest('label').hidden = !text;
  $('image-fit').closest('label').hidden = !image;
  if (filled) $('shape-fill').value = filled.fill;
  if (shape) {
    $('shape-stroke').value = shape.stroke;
    $('shape-stroke-width').value = shape.strokeWidth;
    $('shape-no-fill').checked = shape.noFill;
    $('shape-no-fill').indeterminate = items.some(e => C.isTextShape(e.type) && e.noFill !== shape.noFill);
  }
  if (text) {
    $('vertical-align').value = text.verticalAlign;
    $('prop-lineHeight').value = text.lineHeight;
    if (!editor) {
      $('font-size').value = text.fontSize;
      $('font-family').value = text.fontFamily;
      $('text-color').value = text.color;
    }
  }
  if (image) $('image-fit').value = image.fit;
  $('slide-name').value = currentSlide().name;
  $('background-color').value = currentSlide().background;
  $('current-slide-name').textContent = currentSlide().name;
  document.querySelectorAll('[data-action="delete"], [data-action="duplicate"]').forEach(n => { n.disabled = !first; });
}
function updateSelection() {
  Array.from(canvas.children).forEach(node => { if (node.dataset.elementId) node.classList.toggle('selected', selected.has(node.dataset.elementId)); });
  const targets = [...selected].map(nodeFor).filter(Boolean);
  moveable.target = editor ? null : targets.length === 1 ? targets[0] : targets;
  selecto.setSelectedTargets(targets);
  moveable.elementGuidelines = currentSlide().elements.filter(e => !selected.has(e.id)).map(e => nodeFor(e.id));
  moveable.updateRect(); updateProperties(); renderLayers();
}
function choose(ids, toggle = false) {
  const expanded = new Set(ids);
  ids.forEach(id => { const e = currentSlide().elements.find(item => item.id === id); if (e?.group) currentSlide().elements.filter(item => item.group === e.group).forEach(item => expanded.add(item.id)); });
  if (toggle) expanded.forEach(id => { if (selected.has(id)) selected.delete(id); else selected.add(id); });
  else selected = expanded;
  updateSelection();
}
function render() {
  current = Math.min(Math.max(0, current), deck.slides.length - 1);
  selected = new Set([...selected].filter(id => currentSlide().elements.some(e => e.id === id)));
  // Moveable's controls live outside the document canvas and survive this redraw.
  C.renderSlide(currentSlide(), canvas);
  $('deck-name').value = deck.name; $('speaker-notes').value = currentSlide().notes;
  renderRail(); updateSelection(); updateHistory(); fit();
}
function selectSlide(index) { finishEditing(); current = index; selected.clear(); render(); }
function startEditing(id) {
  const data = currentSlide().elements.find(e => e.id === id);
  if (!data || !C.supportsText(data.type) || editingId === id) return;
  finishEditing(); selected = new Set([id]); editingId = id;
  const node = nodeFor(id); node.classList.add('editing'); node.replaceChildren();
  editor = new Editor({
    element: node,
    extensions: [StarterKit.configure({ undoRedo: false, heading: false, blockquote: false, codeBlock: false, code: false, horizontalRule: false, link: false, dropcursor: false, gapcursor: false, trailingNode: false }), TextStyle, Color, FontFamily, FontSize, TextAlign.configure({ types: ['paragraph'] })],
    content: data.content,
    editorProps: { attributes: { 'aria-label': 'テキスト編集', spellcheck: 'false' }, handleKeyDown: (_view, event) => {
      if (event.isComposing || _view.composing) return false;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(event.shiftKey); return true; }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finishEditing(); canvas.focus(); return true; }
      return false;
    } },
    onUpdate: ({ editor: instance }) => {
      data.content = C.cleanDoc(instance.getJSON());
      clearTimeout(textTimer); textTimer = setTimeout(flushText, 500);
      // Flag the draft immediately; do not lose the final keystrokes on close.
      $('save-status').textContent = '編集中…';
    },
    onSelectionUpdate: updateTextToolbar
  });
  updateSelection();
  editor.commands.setTextSelection(Math.max(1, editor.state.doc.content.size - 1));
  editor.view.focus(); updateTextToolbar();
}
function updateTextToolbar() {
  if (!editor) return;
  const attrs = editor.getAttributes('textStyle'), e = selection()[0];
  $('font-size').value = parseFloat(attrs.fontSize) || e.fontSize;
  $('font-family').value = attrs.fontFamily || e.fontFamily;
  $('text-color').value = C.color(attrs.color, e.color);
  ['bold', 'italic', 'underline'].forEach(type => document.querySelector(`[data-action="${type}"]`).setAttribute('aria-pressed', String(editor.isActive(type))));
}
function format(command, value) {
  if (editor) {
    const chain = editor.chain();
    const methods = { bold: 'toggleBold', italic: 'toggleItalic', underline: 'toggleUnderline', bullet: 'toggleBulletList', color: 'setColor', fontFamily: 'setFontFamily', fontSize: 'setFontSize', textAlign: 'setTextAlign' };
    chain[methods[command]](command === 'fontSize' ? `${value}px` : value).run(); editor.view.focus(); updateTextToolbar(); return;
  }
  const text = selection().filter(e => C.supportsText(e.type));
  if (!text.length) { notify('テキストを選択してください。部分書式はダブルクリックして文字を選択します。'); return; }
  commit(() => text.forEach(e => {
    if (['fontSize', 'fontFamily', 'color'].includes(command)) {
      const applied = command === 'fontSize' ? `${value}px` : value;
      e[command] = value;
      const walk = node => { if (node.type === 'text') { node.marks ||= []; let mark = node.marks.find(m => m.type === 'textStyle'); if (!mark) { mark = { type: 'textStyle', attrs: {} }; node.marks.push(mark); } mark.attrs[command] = applied; } (node.content || []).forEach(walk); };
      walk(e.content);
    } else if (command === 'textAlign') {
      const walk = node => { if (node.type === 'paragraph') node.attrs = { ...node.attrs, textAlign: value }; (node.content || []).forEach(walk); }; walk(e.content);
    } else {
      // Use the same ProseMirror commands for whole-box formatting and partial text.
      const temp = new Editor({ extensions: [StarterKit.configure({ undoRedo: false, link: false }), TextStyle, Color, FontFamily, FontSize, TextAlign.configure({ types: ['paragraph'] })], content: e.content });
      temp.commands.selectAll(); temp.commands[{ bold: 'toggleBold', italic: 'toggleItalic', underline: 'toggleUnderline', bullet: 'toggleBulletList' }[command]]();
      e.content = C.cleanDoc(temp.getJSON()); temp.destroy();
    }
  }));
}
function undo(redo = false) {
  finishEditing(); const slideId = currentSlide().id;
  deck = redo ? history.redo() : history.undo();
  current = Math.max(0, deck.slides.findIndex(s => s.id === slideId)); selected.clear(); changed(); render();
}
function addElements(elements) {
  if (currentSlide().elements.length + elements.length > 200) { notify('1枚のスライドに配置できる要素は200個までです。', true); return; }
  commit(() => { currentSlide().elements.push(...elements); selected = new Set(elements.map(e => e.id)); });
}
function template(kind) {
  const s = C.slide({ title: 'タイトル', body: '見出しと本文', bilingual: '日中対訳', blank: '白紙' }[kind] || 'スライド');
  const text = (value, options) => C.element('text', { content: C.textDoc(value), ...options });
  if (kind === 'title') s.elements = [text('ここにタイトルを入力', { x: 110, y: 225, width: 1060, height: 150, fontSize: 68 }), text('サブタイトル', { x: 115, y: 405, width: 1000, height: 90, fontSize: 30, color: '#657c83' })];
  if (kind === 'body' || kind === 'bilingual') s.elements.push(text('ここに見出しを入力', { x: 90, y: 65, width: 1100, height: 100, fontSize: 52 }));
  if (kind === 'body') s.elements.push(text('ここに本文を入力\n伝えたいことを、わかりやすく。', { x: 100, y: 210, width: 1080, height: 420, fontSize: 36 }));
  if (kind === 'bilingual') s.elements.push(C.element('rect', { x: 630, y: 215, width: 2, height: 380, fill: '#d4e0da' }), text('日本語の本文', { x: 90, y: 215, width: 490, height: 390, fontSize: 36 }), text('中文内容', { x: 690, y: 215, width: 490, height: 390, fontSize: 36 }));
  return s;
}
function addSlide(s = C.slide()) {
  if (deck.slides.length >= 500) return notify('スライドは500枚までです。', true);
  commit(() => { deck.slides.splice(current + 1, 0, s); current++; selected.clear(); });
}
function insertCopies(source) {
  if (!source?.length) return;
  const items = C.clone(source), groups = new Map();
  for (const item of items) {
    item.id = C.id();
    item.x += 24;
    item.y += 24;
    if (item.group) {
      if (!groups.has(item.group)) groups.set(item.group, C.id());
      item.group = groups.get(item.group);
    }
  }
  addElements(items);
}
function copySelection() {
  if (!selected.size) return;
  finishEditing();
  clipboard = C.clone(selection());
}
function styleKeys(type) {
  const keys = ['opacity'];
  if (C.supportsText(type)) keys.push('fontSize', 'fontFamily', 'color', 'verticalAlign', 'lineHeight');
  if (C.isTextShape(type) || type === 'line') keys.push('fill');
  if (C.isTextShape(type)) keys.push('noFill', 'stroke', 'strokeWidth');
  if (type === 'image') keys.push('fit');
  return keys;
}
function visitContent(node, visit) {
  visit(node);
  for (const child of node.content || []) visitContent(child, visit);
}
function copyStyle() {
  if (selected.size !== 1) return;
  finishEditing();
  const [source] = selection();
  const properties = Object.fromEntries(styleKeys(source.type).map(key => [key, source[key]]));
  copiedStyle = { properties };
  if (source.content) {
    visitContent(source.content, node => {
      if (node.type === 'paragraph') copiedStyle.align ??= node.attrs?.textAlign || 'left';
      if (node.type === 'text') copiedStyle.marks ??= C.clone(node.marks || []);
    });
  }
  notify('書式をコピーしました。適用先で「書式を貼り付け」を選んでください。');
}
function pasteStyle() {
  if (!copiedStyle || !selected.size) return;
  commit(() => {
    for (const target of selection()) {
      for (const key of styleKeys(target.type)) {
        if (key in copiedStyle.properties) target[key] = copiedStyle.properties[key];
      }
      if (target.content && copiedStyle.align) {
        visitContent(target.content, node => {
          if (node.type === 'paragraph') node.attrs = { ...node.attrs, textAlign: copiedStyle.align };
          if (node.type === 'text') node.marks = C.clone(copiedStyle.marks || []);
        });
      }
    }
  });
}
function moveOneLayer(direction) {
  const order = [...currentSlide().elements];
  // Work from the leading edge so adjacent selected items move as a block.
  let moved = false;
  for (let i = direction > 0 ? order.length - 2 : 1; i >= 0 && i < order.length; i -= direction) {
    const next = i + direction;
    if (selected.has(order[i].id) && !selected.has(order[next].id)) {
      [order[i], order[next]] = [order[next], order[i]];
      moved = true;
    }
  }
  if (moved) commit(() => { currentSlide().elements = order; });
}
function align(direction) {
  const items = units(selection()); if (!items.length) return;
  const frame = items.length === 1 ? { x: 0, y: 0, width: C.WIDTH, height: C.HEIGHT } : bounds(items);
  commit(() => items.forEach(unit => {
    let dx = 0, dy = 0;
    if (direction === 'left') dx = frame.x - unit.x;
    if (direction === 'center') dx = frame.x + (frame.width - unit.width) / 2 - unit.x;
    if (direction === 'right') dx = frame.x + frame.width - unit.width - unit.x;
    if (direction === 'top') dy = frame.y - unit.y;
    if (direction === 'middle') dy = frame.y + (frame.height - unit.height) / 2 - unit.y;
    if (direction === 'bottom') dy = frame.y + frame.height - unit.height - unit.y;
    unit.elements.forEach(e => { e.x += dx; e.y += dy; });
  }));
}
function distribute(axis) {
  const items = units(selection()).sort((a, b) => a[axis] - b[axis]);
  if (items.length < 3) return notify('等間隔に配置する要素を3個以上選択してください。');
  const size = axis === 'x' ? 'width' : 'height';
  commit(() => { const start = items[0][axis], end = items.at(-1)[axis] + items.at(-1)[size]; const gap = (end - start - items.reduce((sum, e) => sum + e[size], 0)) / (items.length - 1); let position = start; items.forEach(unit => { const delta = position - unit[axis]; unit.elements.forEach(e => { e[axis] += delta; }); position += unit[size] + gap; }); });
}
async function readImage(file) {
  if (!file || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) throw new Error('PNG・JPEG・GIF・WebP の画像（12MB以下）を選択してください。');
  const src = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
  C.image(src);
  const img = new Image(); img.src = src; await img.decode();
  return { src, width: img.naturalWidth, height: img.naturalHeight };
}
async function insertImage(file, purpose = 'element') {
  // Image decoding is asynchronous: retain the slide where the action began.
  const targetId = currentSlide().id;
  const data = await readImage(file);
  if (currentSlide().id !== targetId) throw new Error('スライドが切り替わりました。挿入先で画像を選び直してください。');
  if (purpose === 'background') commit(() => { currentSlide().backgroundImage = data.src; });
  else { const ratio = Math.min(800 / data.width, 500 / data.height, 1); const width = Math.max(20, data.width * ratio), height = Math.max(8, data.height * ratio); addElements([C.element('image', { src: data.src, fit: 'contain', width, height, x: (C.WIDTH - width) / 2, y: (C.HEIGHT - height) / 2 })]); }
}
function exportDeck() {
  finishEditing();
  const clean = C.validate(deck);
  const blob = new Blob([JSON.stringify(clean)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url;
  link.download = `${deck.name.replace(/[\\/:*?"<>|]/g, '_') || 'スライド'}.assembly-slides.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000); notify('画像を含む編集可能な資料ファイルを保存しました。');
}
function replaceDeck(value) {
  finishEditing(); deck = value; current = 0; selected.clear(); history = new C.History(deck); changed(); render();
}
async function importDeck(file) {
  if (!file) return;
  if (file.size > 40 * 1024 * 1024) throw new Error('読み込める資料ファイルは40MBまでです。');
  // Validate before replacing the current draft. Invalid files never modify it.
  const value = C.validate(JSON.parse(await file.text()));
  if (!confirm('現在の資料を読み込んだ資料に置き換えます。必要な場合は先に「資料を保存」で保存してください。')) return;
  replaceDeck(value); await save(); notify('資料を読み込みました。');
}
function present() {
  finishEditing(); published = { deck: C.validate(deck), index: current };
  const host = bridge();
  if (host) { host.receive(published); $('projection-state').textContent = `${current + 1}枚目を投影へ反映しました`; return; }
  if (!standaloneWindow || standaloneWindow.closed) {
    standaloneWindow = window.open('./present.html?v=2', 'assembly-slides-projector', 'width=1280,height=720,resizable=yes');
    if (!standaloneWindow) return notify('投影画面を開けません。ポップアップを許可してください。', true);
    standaloneWindow.focus();
    standaloneWindow.addEventListener('load', () => { standaloneWindow.SlideShow?.apply(published); });
  } else standaloneWindow.SlideShow?.apply(published);
  $('projection-state').textContent = `${current + 1}枚目を投影へ反映しました`;
}
function navigate(delta, output = false) {
  const next = Math.max(0, Math.min(deck.slides.length - 1, current + delta));
  if (next !== current) selectSlide(next);
  if (output) present();
}
function getCurrentBible() {
  const data = bridge()?.getContext();
  if (!data?.bible) { notify('集会管理で聖句を選択してから、もう一度取得してください。', true); return; }
  $('bible-reference').value = data.bible.reference || ''; $('bible-japanese').value = data.bible.japanese || ''; $('bible-chinese').value = data.bible.chinese || '';
}
function insertBible() {
  const reference = $('bible-reference').value.trim(), jp = $('bible-japanese').value.trim(), ch = $('bible-chinese').value.trim();
  if (!jp && !ch) return notify('聖句本文を入力してください。', true);
  const s = template(jp && ch ? 'bilingual' : 'body'); s.name = reference || '聖句';
  s.elements.filter(e => e.type === 'text')[0].content = C.textDoc(reference || '聖句');
  const texts = s.elements.filter(e => e.type === 'text'); texts[1].content = C.textDoc(jp || ch);
  if (jp && ch) texts[2].content = C.textDoc(ch);
  texts.slice(1).forEach(e => { e.fontSize = 32; }); addSlide(s); $('bible-dialog').close();
}
function meetingCover() {
  const data = bridge()?.getContext()?.info;
  if (!data) return notify('集会管理の「スライド編集」から開くと集会情報を取り込めます。', true);
  const s = template('title'); s.name = data.jtitle || data.worship || '集会';
  s.elements[0].content = C.textDoc(data.jtitle || data.worship || '集会');
  s.elements[1].content = C.textDoc([data.ctitle, data.worship, data.speecher ? `説教：${data.speecher}` : '', data.translator ? `通訳：${data.translator}` : ''].filter(Boolean).join('\n'));
  s.elements[1].height = 220; s.elements[1].y = 390; addSlide(s);
}
const actions = {
  'new-deck': () => { finishEditing(); $('new-dialog').showModal(); },
  'confirm-new': () => { replaceDeck(C.deck()); $('new-dialog').close(); },
  import: () => { finishEditing(); $('import-file').click(); }, export: exportDeck,
  'add-slide': () => addSlide(),
  'duplicate-slide': () => { const s = C.clone(currentSlide()); s.id = C.id(); s.name += ' のコピー'; const groups = new Map(); s.elements.forEach(e => { e.id = C.id(); if (e.group) { if (!groups.has(e.group)) groups.set(e.group, C.id()); e.group = groups.get(e.group); } }); addSlide(s); },
  'delete-slide': () => {
    const last = deck.slides.length === 1;
    $('delete-description').textContent = `${current + 1} 枚目「${currentSlide().name}」を削除します。${last ? '最後の1枚なので、編集用の白紙を1枚用意します。' : ''}「元に戻す」で復元できます。`;
    $('delete-dialog').dataset.slideId = currentSlide().id;
    $('delete-dialog').showModal();
  },
  'confirm-delete-slide': () => {
    const dialog = $('delete-dialog');
    const index = deck.slides.findIndex(s => s.id === dialog.dataset.slideId);
    dialog.close();
    if (index < 0) return;
    commit(() => {
      deck.slides.splice(index, 1);
      if (!deck.slides.length) deck.slides.push(C.slide('白紙'));
      current = Math.min(index, deck.slides.length - 1);
      selected.clear();
    });
    focusThumbnail();
  },
  'slide-up': () => { if (current > 0) commit(() => { const [s] = deck.slides.splice(current, 1); deck.slides.splice(--current, 0, s); }); },
  'slide-down': () => { if (current < deck.slides.length - 1) commit(() => { const [s] = deck.slides.splice(current, 1); deck.slides.splice(++current, 0, s); }); },
  'add-text': () => { const e = C.element('text', { content: C.textDoc('テキストを入力') }); addElements([e]); startEditing(e.id); editor?.commands.selectAll(); },
  'add-image': () => { imagePurpose = 'element'; $('image-file').click(); },
  'background-image': () => { imagePurpose = 'background'; $('image-file').click(); },
  'clear-background': () => commit(() => { delete currentSlide().backgroundImage; }),
  'add-rect': () => addElements([C.element('rect')]), 'add-ellipse': () => addElements([C.element('ellipse')]), 'add-line': () => addElements([C.element('line', { width: 500, height: 8, fill: '#15574b' })]),
  duplicate: () => { finishEditing(); insertCopies(selection()); },
  copy: () => { copySelection(); notify('要素をコピーしました。'); },
  cut: () => { copySelection(); actions.delete(); },
  paste: () => insertCopies(clipboard),
  'copy-style': copyStyle, 'paste-style': pasteStyle,
  delete: () => { if (selected.size) commit(() => { currentSlide().elements = currentSlide().elements.filter(e => !selected.has(e.id)); selected.clear(); }); },
  bold: () => format('bold'), italic: () => format('italic'), underline: () => format('underline'), bullet: () => format('bullet'),
  'align-text-left': () => format('textAlign', 'left'), 'align-text-center': () => format('textAlign', 'center'), 'align-text-right': () => format('textAlign', 'right'),
  'align-left': () => align('left'), 'align-center': () => align('center'), 'align-right': () => align('right'), 'align-top': () => align('top'), 'align-middle': () => align('middle'), 'align-bottom': () => align('bottom'),
  'distribute-x': () => distribute('x'), 'distribute-y': () => distribute('y'),
  forward: () => moveOneLayer(1), backward: () => moveOneLayer(-1),
  front: () => commit(() => { const chosen = selection(); currentSlide().elements = [...currentSlide().elements.filter(e => !selected.has(e.id)), ...chosen]; }),
  back: () => commit(() => { const chosen = selection(); currentSlide().elements = [...chosen, ...currentSlide().elements.filter(e => !selected.has(e.id))]; }),
  group: () => { if (selected.size < 2) return notify('2個以上の要素を選択してください。'); commit(() => { const group = C.id(); selection().forEach(e => { e.group = group; }); }); },
  ungroup: () => commit(() => selection().forEach(e => { delete e.group; })),
  undo: () => undo(), redo: () => undo(true), present, previous: () => navigate(-1, true), next: () => navigate(1, true),
  blackout: () => { if (bridge()) bridge().blackout(); else if (standaloneWindow && !standaloneWindow.closed) standaloneWindow.SlideShow?.blackout(); else notify('先にスライドを投影してください。'); },
  'zoom-in': () => zoom(0.1), 'zoom-out': () => zoom(-0.1),
  'insert-bible': () => { finishEditing(); $('bible-dialog').showModal(); }, 'get-current-bible': getCurrentBible, 'confirm-bible': insertBible, 'meeting-cover': meetingCover
};
function zoom(delta) {
  const value = Math.max(.15, Math.min(2, Math.round((scale + delta) * 100) / 100));
  let option = Array.from($('zoom').options).find(o => Number(o.value) === value);
  if (!option) { option = new Option(`${Math.round(value * 100)}%`, String(value)); $('zoom').add(option); }
  $('zoom').value = String(value); fit();
}

// Keep manipulation controls outside the canvas so they cannot enter a projection.
const moveable = new Moveable(space, {
  container: space, target: [], draggable: false, passDragArea: true, resizable: true, rotatable: true, origin: false,
  snappable: true, snapThreshold: 6, snapDirections: { top: true, left: true, right: true, bottom: true, center: true, middle: true },
  elementSnapDirections: { top: true, left: true, right: true, bottom: true, center: true, middle: true },
  verticalGuidelines: [0, 640, 1280], horizontalGuidelines: [0, 360, 720], snapContainer: canvas,
  throttleDrag: 1, throttleResize: 1, throttleRotate: 1, checkInput: true,
  keepRatio: false, useResizeObserver: true, useMutationObserver: true
});
const selecto = new Selecto({ container: space, dragContainer: canvas, selectableTargets: ['#canvas > .slide-element'], selectByClick: false, selectFromInside: false, toggleContinueSelect: ['shift'], hitRate: 0, checkInput: true });
selecto.on('dragStart', event => { if (editor || gesture || event.inputEvent.target.closest('.moveable-control-box')) event.stop(); });
selecto.on('selectEnd', event => { if (event.isDragStartEnd || event.isClick || editor || gesture) return; choose(event.selected.map(n => n.dataset.elementId)); });
const gestureStart = event => {
  if (editor) { event.stop?.(); return; }
  gesture = true;
  const events = event.events || [event];
  for (const item of events) {
    const data = currentSlide().elements.find(e => e.id === item.target.dataset.elementId);
    item.datas.start = { x: data.x, y: data.y, width: data.width, height: data.height, rotation: data.rotation };
    if (item.set) {
      if (event.type?.startsWith('rotate') || 'setRotation' in item) item.set(data.rotation);
    }
    item.dragStart?.set([0, 0]);
  }
};
function resize(event) {
  const start = event.datas.start;
  if (!start) return;
  const text = event.target.classList.contains('slide-text');
  event.target.style.width = `${Math.max(text ? 20 : 1, event.width)}px`; event.target.style.height = `${Math.max(text ? 8 : 1, event.height)}px`;
  const translation = event.drag?.beforeTranslate || [0, 0];
  event.target.style.left = `${start.x + translation[0]}px`; event.target.style.top = `${start.y + translation[1]}px`;
}
function rotate(event) {
  if (!event.datas.start) return;
  event.target.style.transform = `rotate(${event.beforeRotate ?? event.rotate}deg)`;
  const translation = event.drag?.beforeTranslate || [0, 0];
  event.target.style.left = `${event.datas.start.x + translation[0]}px`; event.target.style.top = `${event.datas.start.y + translation[1]}px`;
}
function gestureEnd(event) {
  if (!gesture) return;
  gesture = false;
  const targets = event.targets || (event.target ? [event.target] : []);
  let modified = false;
  targets.forEach(node => {
    const data = currentSlide().elements.find(e => e.id === node.dataset.elementId); if (!data) return;
    const rotation = /rotate\(([-\d.]+)deg\)/.exec(node.style.transform);
    const values = { x: parseFloat(node.style.left), y: parseFloat(node.style.top), width: parseFloat(node.style.width), height: parseFloat(node.style.height), rotation: rotation ? Number(rotation[1]) : data.rotation };
    for (const [key, value] of Object.entries(values)) if (Number.isFinite(value) && Math.abs(data[key] - value) > .01) { data[key] = value; modified = true; }
  });
  if (modified) { history.push(deck); changed(); renderRail(); updateProperties(); updateHistory(); }
  moveable.updateRect();
}
moveable.on('resizeStart', gestureStart).on('rotateStart', event => { gestureStart(event); event.set(selection()[0]?.rotation || 0); });
moveable.on('resize', resize).on('rotate', rotate);
moveable.on('resizeEnd', gestureEnd).on('rotateEnd', gestureEnd);
moveable.on('resizeGroupStart', gestureStart).on('rotateGroupStart', gestureStart);
moveable.on('resizeGroup', e => e.events.forEach(resize)).on('rotateGroup', e => e.events.forEach(rotate));
moveable.on('resizeGroupEnd', gestureEnd).on('rotateGroupEnd', gestureEnd);

let pointerMove = null;
function snapMove(items, dx, dy) {
  canvas.querySelectorAll('.snap-guide').forEach(n => n.remove());
  if (!$('snap').checked) return [dx, dy];
  const x = Math.min(...items.map(e => e.x)), right = Math.max(...items.map(e => e.x + e.width));
  const y = Math.min(...items.map(e => e.y)), bottom = Math.max(...items.map(e => e.y + e.height));
  const others = currentSlide().elements.filter(e => !selected.has(e.id));
  const axes = [
    { values: [x + dx, (x + right) / 2 + dx, right + dx], guides: [0, 640, 1280, ...others.flatMap(e => [e.x, e.x + e.width / 2, e.x + e.width])], axis: 'x' },
    { values: [y + dy, (y + bottom) / 2 + dy, bottom + dy], guides: [0, 360, 720, ...others.flatMap(e => [e.y, e.y + e.height / 2, e.y + e.height])], axis: 'y' }
  ];
  return axes.map((axis, index) => {
    let nearest = 6 / scale, adjustment = 0, line = null;
    for (const anchor of axis.values) for (const guide of axis.guides) if (Math.abs(guide - anchor) < nearest) { nearest = Math.abs(guide - anchor); adjustment = guide - anchor; line = guide; }
    if (line !== null) {
      const guide = document.createElement('div'); guide.className = 'snap-guide';
      Object.assign(guide.style, { position: 'absolute', background: '#de6e9d', pointerEvents: 'none', zIndex: 30, ...(axis.axis === 'x' ? { left: `${line}px`, top: 0, width: `${1 / scale}px`, height: '720px' } : { top: `${line}px`, left: 0, height: `${1 / scale}px`, width: '1280px' }) }); canvas.append(guide);
    }
    return [dx, dy][index] + adjustment;
  });
}
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0 || event.target.closest('.moveable-control-box')) return;
  const node = event.target.closest('.slide-element');
  if (editor && node?.dataset.elementId === editingId) return;
  // Commit focused property fields before taking a pointer gesture snapshot.
  if (document.activeElement?.matches('input, textarea, select')) document.activeElement.blur();
  finishEditing();
  if (node) {
    const id = node.dataset.elementId;
    if (event.shiftKey) { choose([id], true); return; }
    if (!selected.has(id)) choose([id]);
    canvas.focus({ preventScroll: true });
    event.preventDefault(); event.stopPropagation();
    pointerMove = { id: event.pointerId, x: event.clientX, y: event.clientY, items: selection().map(e => ({ id: e.id, x: e.x, y: e.y, width: e.width, height: e.height })) };
    gesture = true;
  } else if (!event.shiftKey) choose([]);
});
document.addEventListener('pointermove', event => {
  if (!pointerMove || pointerMove.id !== event.pointerId) return;
  if (Math.hypot(event.clientX - pointerMove.x, event.clientY - pointerMove.y) < 3 && !canvas.hasPointerCapture(event.pointerId)) return;
  if (!canvas.hasPointerCapture(event.pointerId)) canvas.setPointerCapture(event.pointerId);
  const [dx, dy] = snapMove(pointerMove.items, (event.clientX - pointerMove.x) / scale, (event.clientY - pointerMove.y) / scale);
  for (const start of pointerMove.items) {
    const node = nodeFor(start.id); if (!node) continue;
    node.style.left = `${start.x + dx}px`; node.style.top = `${start.y + dy}px`;
  }
  moveable.updateRect();
});
function endPointerMove(event, cancel = false) {
  if (!pointerMove || pointerMove.id !== event.pointerId) return;
  if (cancel) for (const start of pointerMove.items) { const node = nodeFor(start.id); if (node) { node.style.left = `${start.x}px`; node.style.top = `${start.y}px`; } }
  const targets = pointerMove.items.map(e => nodeFor(e.id)).filter(Boolean);
  pointerMove = null; canvas.querySelectorAll('.snap-guide').forEach(n => n.remove());
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  gestureEnd({ targets });
}
document.addEventListener('pointerup', event => endPointerMove(event));
document.addEventListener('pointercancel', event => endPointerMove(event, true));
canvas.addEventListener('dblclick', event => { const node = event.target.closest('.slide-element'); if (node) startEditing(node.dataset.elementId); });
stage.addEventListener('pointerdown', event => { if (event.target === stage || event.target === space) { finishEditing(); choose([]); } });
document.addEventListener('pointerdown', event => { if (editor && !event.target.closest('.ribbon, .ribbon-tabs, #element-properties, .editing')) finishEditing(); });
// Toolbar buttons must retain the text selection until their command runs.
document.querySelectorAll('.ribbon button, .history-actions button').forEach(button => button.addEventListener('mousedown', event => event.preventDefault()));
document.addEventListener('click', event => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action) { if (!ready) return; try { const result = actions[action]?.(); if (result?.catch) result.catch(e => notify(e.message, true)); } catch (e) { notify(e.message, true); } }
  const tab = event.target.closest('[data-tab]')?.dataset.tab;
  if (tab) {
    document.querySelectorAll('[data-tab]').forEach(n => { n.setAttribute('aria-selected', String(n.dataset.tab === tab)); n.tabIndex = n.dataset.tab === tab ? 0 : -1; });
    document.querySelectorAll('.ribbon').forEach(n => { n.hidden = n.id !== `panel-${tab}`; });
  }
  const theme = event.target.closest('[data-theme]')?.dataset.theme;
  if (theme && ready) {
    const colors = { light: ['#ffffff', '#172b36'], forest: ['#15574b', '#ffffff'], night: ['#162632', '#e7efea'], warm: ['#f6f0e3', '#534a3a'] }[theme];
    commit(() => { currentSlide().background = colors[0]; currentSlide().elements.filter(e => e.type === 'text').forEach(e => { e.color = colors[1]; const walk = node => { (node.marks || []).filter(m => m.type === 'textStyle').forEach(m => { delete m.attrs.color; }); (node.content || []).forEach(walk); }; walk(e.content); }); });
  }
  const layout = event.target.closest('[data-template]')?.dataset.template;
  if (layout && ready) addSlide(template(layout));
});
const elementMenu = $('element-menu');
const optionsButton = $('element-options');
let menuTrigger = canvas;
function closeElementMenu(restoreFocus = false) {
  if (elementMenu.hidden) return;
  elementMenu.hidden = true;
  optionsButton.setAttribute('aria-expanded', 'false');
  if (restoreFocus) menuTrigger.focus({ preventScroll: true });
}
function openElementMenu(x, y, trigger) {
  finishEditing();
  menuTrigger = trigger;
  const count = selected.size;
  const enabled = {
    paste: !!clipboard, 'copy-style': count === 1, 'paste-style': count > 0 && !!copiedStyle,
    group: units(selection()).length > 1, ungroup: selection().some(e => e.group)
  };
  for (const button of elementMenu.querySelectorAll('button')) {
    button.disabled = !(enabled[button.dataset.action] ?? (count > 0));
  }
  elementMenu.hidden = false;
  optionsButton.setAttribute('aria-expanded', 'true');
  elementMenu.style.left = Math.max(4, Math.min(x, innerWidth - elementMenu.offsetWidth - 4)) + 'px';
  elementMenu.style.top = Math.max(4, Math.min(y, innerHeight - elementMenu.offsetHeight - 4)) + 'px';
  elementMenu.querySelector('button:enabled')?.focus();
}
optionsButton.addEventListener('click', () => {
  if (!elementMenu.hidden) return closeElementMenu(true);
  const box = optionsButton.getBoundingClientRect();
  openElementMenu(box.left, box.bottom, optionsButton);
});
canvas.addEventListener('contextmenu', event => {
  if (event.target.closest('.editing') || gesture) return;
  const node = event.target.closest('.slide-element');
  if (!node && !clipboard) return;
  event.preventDefault();
  finishEditing();
  if (!node) choose([]);
  else if (!selected.has(node.dataset.elementId)) choose([node.dataset.elementId]);
  openElementMenu(event.clientX, event.clientY, canvas);
});
canvas.addEventListener('keydown', event => {
  if (event.target !== canvas || !selected.size || !(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) return;
  event.preventDefault();
  const rect = nodeFor(selection()[0].id).getBoundingClientRect();
  openElementMenu(rect.left, rect.top, canvas);
});
elementMenu.addEventListener('keydown', event => {
  event.stopPropagation();
  if (event.key === 'Escape') { event.preventDefault(); closeElementMenu(true); return; }
  if (event.key === 'Tab') { closeElementMenu(true); return; }
  const buttons = [...elementMenu.querySelectorAll('button:enabled')];
  const index = buttons.indexOf(document.activeElement);
  const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: buttons.length - 1 }[event.key];
  if (next !== undefined && buttons.length) {
    event.preventDefault(); buttons[(next + buttons.length) % buttons.length].focus();
  }
});
elementMenu.addEventListener('click', event => { if (event.target.closest('button:enabled')) closeElementMenu(true); });
document.addEventListener('pointerdown', event => {
  if (!elementMenu.contains(event.target) && !optionsButton.contains(event.target)) closeElementMenu();
});
window.addEventListener('blur', () => closeElementMenu());
window.addEventListener('resize', () => closeElementMenu());
document.querySelector('[role=tablist]').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = Array.from(document.querySelectorAll('[data-tab]')), index = tabs.indexOf(document.activeElement);
  if (index < 0) return; event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].click(); tabs[next].focus();
});
$('font-family').addEventListener('change', () => format('fontFamily', $('font-family').value));
$('font-size').addEventListener('change', () => format('fontSize', C.number($('font-size').value, 44, 8, 240)));
$('text-color').addEventListener('input', () => format('color', $('text-color').value));
$('background-color').addEventListener('change', () => { const value = $('background-color').value; commit(() => { currentSlide().background = value; }); });
$('shape-fill').addEventListener('change', () => { const value = $('shape-fill').value; commit(() => selection().filter(e => !['text', 'image'].includes(e.type)).forEach(e => { e.fill = value; if (C.isTextShape(e.type)) e.noFill = false; })); });
for (const [id, prop] of [['shape-stroke', 'stroke'], ['shape-stroke-width', 'strokeWidth'], ['shape-no-fill', 'noFill'], ['vertical-align', 'verticalAlign']]) {
  $(id).addEventListener('change', () => {
    const input = $(id);
    const value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? C.number(input.value, 0, 0, 24) : input.value;
    const targets = selection().filter(e => prop === 'verticalAlign' ? C.supportsText(e.type) : C.isTextShape(e.type));
    if (targets.length) commit(() => targets.forEach(e => {
      e[prop] = value;
      if (prop === 'stroke' && !e.strokeWidth) e.strokeWidth = 1;
    }));
  });
}
$('image-fit').addEventListener('change', () => { const value = $('image-fit').value; commit(() => selection().filter(e => e.type === 'image').forEach(e => { e.fit = value; })); });
document.querySelectorAll('[data-prop]').forEach(input => input.addEventListener('change', () => {
  const value = C.number(input.value, 0, Number(input.min), Number(input.max));
  commit(() => {
    const items = selection(), prop = input.dataset.prop;
    if (items.length < 2 || !['x', 'y', 'width', 'height', 'rotation'].includes(prop)) { items.forEach(e => { e[prop] = value; }); return; }
    const frame = bounds(items);
    if (prop === 'x' || prop === 'y') items.forEach(e => { e[prop] += value - frame[prop]; });
    else if (prop === 'width' || prop === 'height') {
      const axis = prop === 'width' ? 'x' : 'y', ratio = value / frame[prop];
      items.forEach(e => { e[axis] = frame[axis] + (e[axis] - frame[axis]) * ratio; e[prop] *= ratio; });
    } else {
      const delta = value - items[0].rotation, angle = delta * Math.PI / 180, cx = frame.x + frame.width / 2, cy = frame.y + frame.height / 2;
      items.forEach(e => { const x = e.x + e.width / 2 - cx, y = e.y + e.height / 2 - cy; e.x = cx + x * Math.cos(angle) - y * Math.sin(angle) - e.width / 2; e.y = cy + x * Math.sin(angle) + y * Math.cos(angle) - e.height / 2; e.rotation += delta; });
    }
  }, { keepEditing: !!editor });
  selection().forEach(e => { const node = nodeFor(e.id); if (node) C.styleElement(node, e); });
  moveable.updateRect();
}));
$('deck-name').addEventListener('change', () => commit(() => { deck.name = $('deck-name').value.trim() || '無題'; }));
$('slide-name').addEventListener('change', () => { const value = $('slide-name').value.trim() || 'スライド'; commit(() => { currentSlide().name = value; }); });
$('speaker-notes').addEventListener('input', () => {
  currentSlide().notes = $('speaker-notes').value;
  clearTimeout(textTimer); textTimer = setTimeout(flushText, 500);
  $('save-status').textContent = '編集中…';
});
$('zoom').addEventListener('change', fit);
$('snap').addEventListener('change', () => { moveable.snappable = $('snap').checked; });
$('import-file').addEventListener('change', async () => { try { await importDeck($('import-file').files[0]); } catch (e) { notify(`資料を読み込めません。${e.message}`, true); } finally { $('import-file').value = ''; } });
$('image-file').addEventListener('change', async () => { try { if ($('image-file').files[0]) await insertImage($('image-file').files[0], imagePurpose); } catch (e) { notify(e.message, true); } finally { $('image-file').value = ''; } });
canvas.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
canvas.addEventListener('drop', async e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); try { await insertImage(e.dataTransfer.files[0]); } catch (error) { notify(error.message, true); } });
document.addEventListener('paste', async event => {
  if (editor || event.target.closest('input, textarea, [contenteditable=true]')) return;
  const image = Array.from(event.clipboardData?.files || []).find(f => f.type.startsWith('image/'));
  if (image) { event.preventDefault(); try { await insertImage(image); } catch (e) { notify(e.message, true); } }
});
document.addEventListener('keydown', event => {
  if (!ready || event.isComposing || document.querySelector('dialog[open]')) return;
  if (gesture) {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (pointerMove) endPointerMove({ pointerId: pointerMove.id }, true);
      else { moveable.stopDrag(); gesture = false; render(); }
    }
    return;
  }
  if (event.key === 'Shift') moveable.keepRatio = true;
  const input = event.target.closest('input, textarea, select, [contenteditable=true]');
  if (event.key === 'Escape') { finishEditing(); choose([]); return; }
  const mod = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
  if (mod && key === 's') { event.preventDefault(); exportDeck(); return; }
  if (input) return;
  if (event.key === 'F2' && selected.size === 1 && C.supportsText(selection()[0].type)) {
    event.preventDefault(); startEditing(selection()[0].id); return;
  }
  if (mod && key === 'z') { event.preventDefault(); undo(event.shiftKey); }
  else if (mod && key === 'y') { event.preventDefault(); undo(true); }
  else if (mod && key === 'a') { event.preventDefault(); choose(currentSlide().elements.map(e => e.id)); }
  else if (mod && key === 'd') { event.preventDefault(); actions.duplicate(); }
  else if (mod && (key === 'c' || key === 'x') && selected.size) { event.preventDefault(); actions[key === 'c' ? 'copy' : 'cut'](); }
  else if (mod && key === 'v' && clipboard) { event.preventDefault(); actions.paste(); }
  else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); actions.delete(); }
  else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && selected.size) { event.preventDefault(); const step = event.shiftKey ? 10 : 1; commit(() => selection().forEach(e => { if (event.key === 'ArrowLeft') e.x -= step; if (event.key === 'ArrowRight') e.x += step; if (event.key === 'ArrowUp') e.y -= step; if (event.key === 'ArrowDown') e.y += step; })); }
  else if (event.key === 'PageDown') { event.preventDefault(); navigate(1); }
  else if (event.key === 'PageUp') { event.preventDefault(); navigate(-1); }
  else if (event.key === 'F5') { event.preventDefault(); present(); }
});
document.addEventListener('keyup', event => { if (event.key === 'Shift') moveable.keepRatio = false; });
window.addEventListener('blur', () => { moveable.keepRatio = false; });
window.addEventListener('beforeunload', event => {
  flushText();
  if (revision !== savedRevision) { save(); event.preventDefault(); event.returnValue = ''; }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && ready) { flushText(); save(); } });
new ResizeObserver(() => { if (ready) { fit(); renderRail(); } }).observe(stage);
// Used only by the same-origin projection window; never exposes mutable draft data.
window.SlideStudio = { navigate: delta => navigate(delta, true) };
async function init() {
  try {
    storage = await openStorage(); const saved = await storage.load();
    if (saved) deck = C.validate(saved);
    savedRevision = revision; $('save-status').textContent = 'この端末に保存済み';
  } catch (e) {
    storage = null; $('save-status').textContent = '自動保存できません';
    notify(`自動保存を利用できません。元の保存データは上書きしません。「資料を保存」をご利用ください。${e.message || ''}`, true);
  }
  history = new C.History(deck); ready = true; document.body.inert = false; $('workspace').inert = false; render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('../service-worker.js').catch(() => {});
}
init();
