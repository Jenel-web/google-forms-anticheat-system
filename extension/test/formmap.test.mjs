import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// formmap.js is a classic content script (no exports): evaluate it in a plain context and take EG_FORM.
const EG_FORM = vm.runInNewContext(readFileSync(new URL('../src/content/formmap.js', import.meta.url), 'utf8') + '\n;EG_FORM', {});

// The shape of a real published form: 5 questions across 3 pages (two section breaks). Titles hold brackets, quotes and
// semicolons on purpose; types: 0 short text, 2 multiple choice, 6 description, 8 section break, 11 image.
const SCRIPT = `var FB_PUBLIC_LOAD_DATA_ = [null,[null,[
  [1328757188,"Name [first; last]",null,0,[[1,1,0]]],
  [670323779,"Pick \\"one\\"",null,2,[[2,[["a]"],["b["]],0]]],
  [555,"About this exam",null,6],
  [448919392,"City",null,0,[[3,1,0]]],
  [314181226,"Untitled Section",null,8],
  [805618049,"Page 2 question",null,0],
  [777,"A picture",null,11],
  [1476633774,"Untitled Section",null,8],
  [679758098,"Last one",null,0]
],null,null,null,null,null,"Test Form 2"],null,"Test Form 2"];`;

test('reads the whole form: only questions are counted, in order, across pages', () => {
  const order = EG_FORM.parseOrder(SCRIPT);
  assert.deepEqual([...order], [1328757188, 670323779, 448919392, 805618049, 679758098]); // no description, sections or image
  assert.equal(order.length, 5);
});

test('brackets and quotes inside titles do not confuse the reader, and code after the data is ignored', () => {
  assert.equal(EG_FORM.parseOrder(SCRIPT + '\nwindow.something = [1,2,3]; var x = "]";').length, 5);
});

test('a question on page 2 is numbered 4 of 5, not 1 of 1', () => {
  const order = EG_FORM.parseOrder(SCRIPT);
  assert.equal(EG_FORM.numberFor(order, 1328757188), 1);
  assert.equal(EG_FORM.numberFor(order, 448919392), 3);
  assert.equal(EG_FORM.numberFor(order, 805618049), 4);
  assert.equal(EG_FORM.numberFor(order, 679758098), 5);
});

test('items that are not questions, or unknown ids, have no number', () => {
  const order = EG_FORM.parseOrder(SCRIPT);
  assert.equal(EG_FORM.numberFor(order, 555), 0); // description
  assert.equal(EG_FORM.numberFor(order, 123), 0);
  assert.equal(EG_FORM.numberFor(order, null), 0);
  assert.equal(EG_FORM.numberFor(null, 1328757188), 0);
});

test('reads the item id out of data-params, and nothing else', () => {
  assert.equal(EG_FORM.idFromParams('%.@.[1328757188,"Name",null,0,[[1,1,0]]]'), 1328757188);
  assert.equal(EG_FORM.idFromParams('%.@.[12,"x"'), 12);
  assert.equal(EG_FORM.idFromParams('something else'), null);
  assert.equal(EG_FORM.idFromParams(''), null);
  assert.equal(EG_FORM.idFromParams(null), null);
});

test('fails soft: other scripts, broken data and a changed layout give null, never an error', () => {
  assert.equal(EG_FORM.parseOrder('var x = 1;'), null);
  assert.equal(EG_FORM.parseOrder('var FB_PUBLIC_LOAD_DATA_ = [null,'), null); // cut off
  assert.equal(EG_FORM.parseOrder('var FB_PUBLIC_LOAD_DATA_ = {"a":1};'), null);
  assert.equal(EG_FORM.parseOrder('var FB_PUBLIC_LOAD_DATA_ = [null,[null,"not a list"]];'), null);
  assert.equal(EG_FORM.parseOrder('var FB_PUBLIC_LOAD_DATA_ = [null,[null,[[1,"Only a section",null,8]]]];'), null);
  assert.equal(EG_FORM.orderFromScripts(['var a = 1', SCRIPT, 'var b = 2']).length, 5);
  assert.equal(EG_FORM.orderFromScripts(['var a = 1', undefined, 5]), null);
});

test('a 50-question exam over 5 pages numbers question 11 as 11 of 50', () => {
  const items = [];
  for (let page = 0; page < 5; page++) {
    for (let k = 0; k < 10; k++) items.push(`[${1000 + page * 10 + k},"q",null,0]`);
    if (page < 4) items.push(`[${9000 + page},"section",null,8]`);
  }
  const order = EG_FORM.parseOrder(`var FB_PUBLIC_LOAD_DATA_ = [null,[null,[${items.join(',')}]]];`);
  assert.equal(order.length, 50);
  assert.equal(EG_FORM.numberFor(order, 1010), 11); // first question of page 2
  assert.equal(EG_FORM.numberFor(order, 1049), 50);
});
