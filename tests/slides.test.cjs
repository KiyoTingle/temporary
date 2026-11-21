const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../slides/core.js');

test('editable document roundtrip preserves rich text, layout, grouping and embedded images', () => {
  const deck = C.deck('日本語と中文');
  const text = deck.slides[0].elements[0];
  text.content = { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: '愛と盼望', marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { color: '#aabbcc', fontSize: '72px', fontFamily: 'Yu Mincho' } }] }] }] };
  text.rotation = 15; text.group = 'group-1';
  deck.slides[0].elements.push(C.element('image', { src: 'data:image/png;base64,iVBORw0KGgo=', fit: 'cover' }));
  const value = C.validate(JSON.parse(JSON.stringify(deck)));
  assert.deepEqual(value.slides[0].elements[0].content, text.content);
  assert.equal(value.slides[0].elements[0].rotation, 15);
  assert.equal(value.slides[0].elements[0].group, 'group-1');
  assert.equal(value.slides[0].elements[2].src, 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(value.slides[0].elements[2].fit, 'cover');
});

test('untrusted imported documents cannot introduce HTML, scripts, URL images or arbitrary CSS', () => {
  const deck = C.deck(); const e = deck.slides[0].elements[0];
  e.content.content[0].content = [{ type: 'text', text: '<img onerror=alert(1)>', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }, { type: 'textStyle', attrs: { color: 'url(https://evil)', fontSize: 'expression(1)', fontFamily: 'x; background:url(https://evil)' } }] }, { type: 'script', content: [] }];
  e.x = Infinity; e.width = -20; e.rotation = 'not-a-number';
  const result = C.validate(deck).slides[0].elements[0];
  assert.equal(result.content.content[0].content[0].text, '<img onerror=alert(1)>');
  assert.deepEqual(result.content.content[0].content[0].marks, [{ type: 'textStyle', attrs: {} }]);
  assert.equal(result.content.content[0].content.length, 1);
  assert.equal(result.x, 100); assert.equal(result.width, 20); assert.equal(result.rotation, 0);
  for (const src of ['https://evil.test/image.png', 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,PHNjcmlwdD4=']) {
    deck.slides[0].elements.push(C.element('image', { src }));
    assert.throws(() => C.validate(deck), /画像/); deck.slides[0].elements.pop();
  }
});

test('import validates version, slide and element limits before replacing any current draft', () => {
  assert.throws(() => C.validate({}), /対応する/);
  const deck = C.deck(); deck.version = 2; assert.throws(() => C.validate(deck), /対応する/);
  deck.version = 1; deck.slides = []; assert.throws(() => C.validate(deck), /対応する/);
  deck.slides = Array.from({ length: 501 }, () => C.slide()); assert.throws(() => C.validate(deck), /対応する/);
  deck.slides = [C.slide()]; deck.slides[0].elements = Array.from({ length: 201 }, () => C.element('rect'));
  assert.throws(() => C.validate(deck), /200/);
});

test('duplicate IDs are repaired, and imported objects never retain references to source data', () => {
  const deck = C.deck(); deck.slides[0].elements[1].id = deck.slides[0].elements[0].id;
  const value = C.validate(deck);
  assert.notEqual(value.slides[0].elements[0].id, value.slides[0].elements[1].id);
  value.slides[0].elements[0].content.content[0].content[0].text = 'changed';
  assert.notEqual(deck.slides[0].elements[0].content.content[0].content[0].text, 'changed');
});

test('invalid rich text structure is rejected, and empty documents remain editable', () => {
  assert.throws(() => C.cleanDoc({ type: 'doc', content: [{ type: 'text', text: 'invalid' }] }), /段落構造/);
  assert.throws(() => C.cleanDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'doc', content: [] }] }] }), /段落構造/);
  assert.equal(C.cleanDoc({ type: 'doc', content: [] }).content[0].type, 'paragraph');
  const deck = C.deck(); deck.slides[0].elements.push(C.element('rect', { width: 2, height: 380 }));
  assert.equal(C.validate(deck).slides[0].elements.at(-1).width, 2, 'thin dividers must not widen when published');
});

test('undo and redo isolate all nested edits, truncate the redo branch and retain bounded history', () => {
  const deck = C.deck(); const history = new C.History(deck);
  deck.slides[0].elements[0].x = 500; history.push(deck);
  const previous = history.undo(); assert.equal(previous.slides[0].elements[0].x, 110);
  previous.slides[0].elements[0].content.content[0].content[0].text = 'mutate';
  assert.equal(history.redo().slides[0].elements[0].x, 500);
  history.undo(); history.push(C.deck('branch')); assert.equal(history.canRedo, false);
  for (let i = 0; i < 70; i++) history.push(deck);
  assert.equal(history.entries.length, 60);
});

test('shared renderer escapes text, strips marks on validation, and preserves paragraph style', () => {
  class Node {
    constructor(tag, ownerDocument, text = '') { this.tag = tag; this.ownerDocument = ownerDocument; this.text = text; this.childNodes = []; this.style = {}; }
    append(node) { this.childNodes.push(node); }
    replaceChildren() { this.childNodes = []; }
  }
  const doc = { createElement: tag => new Node(tag, doc), createTextNode: text => new Node('#text', doc, text) };
  const host = new Node('div', doc);
  const input = C.cleanDoc({ type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'right' }, content: [{ type: 'text', text: '<script>alert(1)</script>', marks: [{ type: 'bold' }] }] }] });
  C.renderText(input, host);
  assert.equal(host.childNodes[0].tag, 'p'); assert.equal(host.childNodes[0].style.textAlign, 'right');
  assert.equal(host.childNodes[0].childNodes[0].tag, 'strong');
  assert.equal(host.childNodes[0].childNodes[0].childNodes[0].tag, '#text');
  assert.equal(host.childNodes[0].childNodes[0].childNodes[0].text, '<script>alert(1)</script>');
});

test('legacy shapes gain editable text while imported shape styles are bounded', () => {
  const deck = C.deck();
  deck.slides[0].elements = [
    { type: 'rect', fill: '#123456' },
    { type: 'ellipse', strokeWidth: 200, stroke: 'invalid', verticalAlign: 'bottom', content: C.textDoc('集会') }
  ];
  const [rect, ellipse] = C.validate(deck).slides[0].elements;
  assert.equal(rect.strokeWidth, 0);
  assert.equal(rect.noFill, false);
  assert.equal(rect.fill, '#123456');
  assert.equal(rect.content.content[0].attrs.textAlign, 'center');
  assert.equal(ellipse.strokeWidth, 24);
  assert.equal(ellipse.stroke, '#15574b');
  assert.equal(ellipse.verticalAlign, 'bottom');
  assert.equal(ellipse.content.content[0].content[0].text, '集会');
});
