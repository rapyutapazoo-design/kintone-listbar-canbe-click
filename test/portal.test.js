'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const portal = require('../customize/portal-row-click.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'customize', 'portal-row-click.js'), 'utf8');
const ORIGIN = 'https://example.cybozu.com';

const HTML = `
<div id="space"></div>
<div id="list">
  <table>
    <thead><tr id="head"><th id="h1"><a href="/k/5/show#record=1">h</a></th></tr><tr id="head2"><th id="h2">a</th><th>b</th></tr></thead>
    <tbody>
      <tr id="r1"><td id="c1">hello <span id="sp">s</span></td><td><a id="lnk" href="/k/5/show#record=12">12</a></td>
        <td><button id="btn">b</button></td><td><input id="inp"></td><td><label id="lbl">l</label></td>
        <td><span id="rb" role="button">rb</span></td><td><div id="ce" contenteditable="true">e</div></td>
        <td><span id="rl" role="link">x</span></td><td><span id="rc" role="checkbox">x</span></td><td><span id="rm" role="menuitem">x</span></td>
        <td><span id="rt" role="tab">x</span></td><td><span id="ti" tabindex="0">x</span></td><td><details><summary id="sm">x</summary></details></td>
        <td><span id="ce2" contenteditable="">x</span></td><td><span id="ti2" tabindex="-1">x</span></td></tr>
      <tr id="r2"><td id="c2">two</td><td><a href="/k/5/show#record=1">1</a><a href="/k/6/show#record=2">2</a></td></tr>
      <tr id="r3"><td id="c3">none</td><td><a href="/k/5/show">no record</a></td></tr>
      <tr id="r5"><th id="th5">only th</th><th>x<a href="/k/5/show#record=5">5</a></th></tr>
      <tr id="r6"><td id="c6">rel</td><td><a href="5/show#record=6">6</a></td></tr>
      <tr id="r7"><td id="c7">evil1</td><td><a href="//evil.example.org/k/5/show#record=1">e</a></td></tr>
      <tr id="r8"><td id="c8">evil2</td><td><a href="/\\evil.example.org/k/5/show#record=1">e</a></td></tr>
      <tr id="r9"><td id="c9">http</td><td><a href="http://example.cybozu.com/k/5/show#record=1">e</a></td></tr>
      <tr id="r10"><td id="c10">data</td><td><a href="data:text/html,x">e</a></td></tr>
      <tr id="r4"><td id="c4">dup</td><td><a href="/k/5/show#record=7">7</a><a href="/k/5/show?record=7">7</a></td></tr>
    </tbody>
  </table>
  <ul><li id="li1"><span id="lis">item</span><a href="/k/m/8/show#record=3">3</a></li></ul>
  <div role="row" id="dr"><span id="drs">cell</span><a href="/k/guest/4/5/show#record=9">9</a></div>
</div>`;

function setup(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!DOCTYPE html><body>' + (opts.html || HTML) + '</body>', {
    url: ORIGIN + (opts.path || '/k/'),
    runScripts: 'outside-only'
  });
  const w = dom.window;
  const handlers = {};
  w.kintone = {
    events: { on: (name, fn) => { (Array.isArray(name) ? name : [name]).forEach((n) => { handlers[n] = fn; }); } },
    portal: { getContentSpaceElement: () => w.document.getElementById('space') }
  };
  const clock = { now: 1000000 };
  w.Date.now = () => clock.now;
  w.eval(SRC);
  const calls = [];
  w.KintoneRowClick.portal.nav.open = (url, newTab) => calls.push({ url, newTab });
  const fire = (name) => handlers[name || 'app.portal.show']({ type: name || 'app.portal.show' });
  const ev = (id, init) => {
    const el = w.document.getElementById(id);
    const e = new w.MouseEvent((init && init.type) || 'click', Object.assign({ bubbles: true, cancelable: true }, init));
    el.dispatchEvent(e);
    return e;
  };
  return { w, calls, handlers, fire, ev, clock };
}

describe('parseRecordHref', () => {
  const p = (h) => portal.parseRecordHref(h, ORIGIN);
  it('PC / PCゲスト', () => {
    assert.deepEqual(p('/k/5/show#record=12&l.view=1'), { appId: '5', guestSpaceId: null, mobile: false, recordId: '12' });
    assert.equal(p('/k/guest/3/5/show#record=12').guestSpaceId, '3');
    assert.equal(p(ORIGIN + '/k/5/show?record=12').recordId, '12');
  });
  it('モバイル（?record / #record / ゲスト両並び）', () => {
    assert.equal(p('/k/m/5/show?record=2').mobile, true);
    assert.equal(p('/k/m/5/show#record=2').recordId, '2');
    const a = p('/k/guest/3/m/5/show#record=2');
    const b = p('/k/m/guest/3/5/show#record=2');
    assert.deepEqual([a.guestSpaceId, a.appId], ['3', '5']);
    assert.deepEqual([b.guestSpaceId, b.appId], ['3', '5']);
  });
  it('拒否', () => {
    assert.equal(p('https://evil.example.org/k/5/show#record=1'), null);
    assert.equal(p('javascript:alert(1)'), null);
    assert.equal(p('//evil.example.org/k/5/show#record=1'), null);
    assert.equal(p('/\\evil.example.org/k/5/show#record=1'), null);
    assert.equal(p('http://example.cybozu.com/k/5/show#record=1'), null);
    assert.equal(p('data:text/html,x'), null);
    assert.equal(p('/k/5/show'), null);
    assert.equal(p('/k/5/show#record=abc'), null);
    assert.equal(p('/k/5/show#record=0'), null);
    assert.equal(p('/k/5/edit#record=1'), null);
    assert.equal(p('http://'), null);
    assert.equal(p(null), null);
    assert.equal(portal.parseRecordHref('/k/5/show#record=1', 'not a url'), null);
  });
});

describe('resolveRowTarget', () => {
  it('件数別', () => {
    const t = setup();
    const d = t.w.document;
    const r = (id) => portal.resolveRowTarget(d.getElementById(id), ORIGIN);
    assert.equal(r('r1'), ORIGIN + '/k/5/show#record=12');
    assert.equal(r('r4'), ORIGIN + '/k/5/show#record=7');
    assert.equal(r('r2'), null);
    assert.equal(r('r3'), null);
  });
});

describe('portal-row-click DOM', () => {
  it('tr / li / div role=row の各行で同一タブ遷移', () => {
    const t = setup();
    t.fire();
    const e = t.ev('c1');
    assert.equal(t.calls[0].url, ORIGIN + '/k/5/show#record=12');
    assert.equal(t.calls[0].newTab, false);
    assert.equal(e.defaultPrevented, true);
    t.clock.now += 520;
    t.ev('lis');
    assert.equal(t.calls[1].url, ORIGIN + '/k/m/8/show#record=3');
    t.clock.now += 520;
    t.ev('drs');
    assert.equal(t.calls[2].url, ORIGIN + '/k/guest/4/5/show#record=9');
  });
  it('除外要素・thead・コンテナ外・リンク不明確行は不遷移', () => {
    const t = setup();
    t.fire();
    ['lnk', 'btn', 'inp', 'lbl', 'rb', 'ce', 'h1', 'h2', 'c2', 'c3', 'th5', 'c7', 'c8', 'c9', 'c10',
      'rl', 'rc', 'rm', 'rt', 'ti', 'sm', 'ce2'].forEach((id) => t.ev(id));
    assert.equal(t.calls.length, 0);
  });
  it('修飾キー・中クリック', () => {
    const t = setup();
    t.fire();
    t.ev('c1', { ctrlKey: true });
    assert.equal(t.calls[0].newTab, true);
    const t2 = setup();
    t2.fire();
    t2.ev('c1', { metaKey: true });
    assert.equal(t2.calls[0].newTab, true);
    const t3 = setup();
    t3.fire();
    t3.ev('c1', { type: 'auxclick', button: 1 });
    assert.equal(t3.calls.length, 1);
    assert.equal(t3.calls[0].newTab, true);
    const t4 = setup();
    t4.fire();
    t4.ev('c1', { type: 'auxclick', button: 2 });
    t4.ev('c1', { type: 'click', button: 1 });
    assert.equal(t4.calls.length, 0);
  });
  it('Shift＋クリックは新規タブ', () => {
    const t = setup();
    t.fire();
    const e = t.ev('c1', { shiftKey: true });
    assert.equal(t.calls.length, 1);
    assert.equal(t.calls[0].newTab, true);
    assert.equal(e.defaultPrevented, true);
  });
  it('tabindex=-1 の要素は除外しない', () => {
    const t = setup();
    t.fire();
    t.ev('ti2');
    assert.equal(t.calls.length, 1);
  });
  it('相対 href は document.baseURI 基準で解決', () => {
    const t = setup();
    t.fire();
    t.ev('c6');
    assert.equal(t.calls[0].url, ORIGIN + '/k/5/show#record=6');
  });
  it('一覧がコンテンツスペース外でも委譲される（body 委譲）', () => {
    const t = setup();
    t.fire();
    assert.equal(t.w.document.getElementById('space').contains(t.w.document.getElementById('c1')), false);
    t.ev('c1');
    assert.equal(t.calls.length, 1);
  });
  it('ポータル以外の画面・SPA遷移後・未発火では何もしない', () => {
    const a = setup({ path: '/k/5/' });
    a.fire();
    a.ev('c1');
    assert.equal(a.calls.length, 0);
    const b = setup();
    b.ev('c1');
    assert.equal(b.calls.length, 0);
    const c = setup();
    c.fire();
    c.w.history.pushState({}, '', '/k/5/');
    c.ev('c1');
    assert.equal(c.calls.length, 0);
    c.w.history.pushState({}, '', '/k/#/portal');
    c.clock.now += 600;
    c.ev('c1');
    assert.equal(c.calls.length, 1);
  });
  it('isPortalLocation', () => {
    const f = (pathname, hash) => portal.isPortalLocation({ pathname, hash });
    assert.equal(f('/k/', ''), true);
    assert.equal(f('/k/', '#/portal'), true);
    assert.equal(f('/k/m/', ''), true);
    assert.equal(f('/k/guest/3/', ''), true);
    assert.equal(f('/k/5/', ''), false);
    assert.equal(f('/k/', '#/space/1'), false);
    assert.equal(f('/k/5/show', ''), false);
  });
  it('500ms 経過後は再遷移できる', () => {
    const t = setup();
    t.fire();
    t.ev('c1');
    t.clock.now += 499;
    t.ev('c1');
    assert.equal(t.calls.length, 1);
    t.clock.now += 2;
    t.ev('c1');
    assert.equal(t.calls.length, 2);
  });
  it('テキスト選択中・defaultPrevented 済みは不遷移', () => {
    const t = setup();
    t.fire();
    const d = t.w.document;
    const range = d.createRange();
    range.selectNodeContents(d.getElementById('c1'));
    const sel = t.w.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    t.ev('c1');
    assert.equal(t.calls.length, 0);
    sel.removeAllRanges();
    d.getElementById('c1').addEventListener('click', (e) => e.preventDefault());
    t.ev('c1');
    assert.equal(t.calls.length, 0);
  });
  it('二重登録されない（両イベント・複数回）', () => {
    const t = setup();
    t.fire('app.portal.show');
    t.fire('app.portal.show');
    t.fire('mobile.app.portal.show');
    t.ev('c1');
    assert.equal(t.calls.length, 1);
  });
  it('両イベントを登録し event を返す', () => {
    const t = setup();
    assert.equal(typeof t.handlers['app.portal.show'], 'function');
    assert.equal(typeof t.handlers['mobile.app.portal.show'], 'function');
    const ev = { a: 1 };
    assert.equal(t.handlers['app.portal.show'](ev), ev);
    assert.equal(t.handlers['mobile.app.portal.show'](ev), ev);
  });
  it('モバイル: 10px 超移動後の click は不遷移、以内は遷移', () => {
    const touch = (t, type, x, y) => {
      const e = new t.w.Event(type, { bubbles: true, cancelable: true });
      const pt = { clientX: x, clientY: y };
      e.touches = [pt];
      e.changedTouches = [pt];
      t.w.document.getElementById('c1').dispatchEvent(e);
    };
    const a = setup();
    a.fire('mobile.app.portal.show');
    touch(a, 'touchstart', 0, 0);
    touch(a, 'touchmove', 0, 30);
    touch(a, 'touchend', 0, 30);
    a.ev('c1');
    assert.equal(a.calls.length, 0);
    const b = setup();
    b.fire('mobile.app.portal.show');
    touch(b, 'touchstart', 0, 0);
    touch(b, 'touchend', 3, 4);
    b.ev('c1');
    assert.equal(b.calls.length, 1);
    // moved は click 判定後に戻る（次の touchstart でもリセット）
    a.clock.now += 600;
    a.ev('c1');
    assert.equal(a.calls.length, 1);
    const c = setup();
    c.fire('mobile.app.portal.show');
    touch(c, 'touchstart', 0, 0);
    touch(c, 'touchmove', 0, 30);
    touch(c, 'touchstart', 0, 0);
    c.ev('c1');
    assert.equal(c.calls.length, 1);
  });
  it('cursor:pointer は遷移可能行のみ', () => {
    const t = setup();
    t.fire();
    const d = t.w.document;
    assert.equal(d.getElementById('r1').style.cursor, '');
    t.ev('c1', { type: 'mouseover' });
    t.ev('c2', { type: 'mouseover' });
    t.ev('c3', { type: 'mouseover' });
    assert.equal(d.getElementById('r1').style.cursor, 'pointer');
    assert.equal(d.getElementById('r2').style.cursor, '');
    assert.equal(d.getElementById('r3').style.cursor, '');
  });
  it('短時間の二重 click は1回のみ遷移', () => {
    const t = setup();
    t.fire();
    t.ev('c1');
    t.ev('c1');
    assert.equal(t.calls.length, 1);
  });
});
