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
  const clock = { now: 1000000 };
  w.Date.now = () => clock.now;
  w.eval(SRC);
  const calls = [];
  w.KintoneRowClick.portal.nav.open = (url, newTab) => calls.push({ url, newTab });
  const ev = (id, init) => {
    const el = w.document.getElementById(id);
    const e = new w.MouseEvent((init && init.type) || 'click', Object.assign({ bubbles: true, cancelable: true }, init));
    el.dispatchEvent(e);
    return e;
  };
  return { w, calls, ev, clock };
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
    ['lnk', 'btn', 'inp', 'lbl', 'rb', 'ce', 'h1', 'h2', 'c2', 'c3', 'th5', 'c7', 'c8', 'c9', 'c10',
      'rl', 'rc', 'rm', 'rt', 'ti', 'sm', 'ce2'].forEach((id) => t.ev(id));
    assert.equal(t.calls.length, 0);
  });
  it('修飾キー・中クリック', () => {
    const t = setup();
    t.ev('c1', { ctrlKey: true });
    assert.equal(t.calls[0].newTab, true);
    assert.equal(t.calls[0].url, ORIGIN + '/k/5/show#record=12');
    const t2 = setup();
    t2.ev('c1', { metaKey: true });
    assert.equal(t2.calls[0].newTab, true);
    assert.equal(t2.calls[0].url, ORIGIN + '/k/5/show#record=12');
    const t3 = setup();
    t3.ev('c1', { type: 'auxclick', button: 1 });
    assert.equal(t3.calls.length, 1);
    assert.equal(t3.calls[0].newTab, true);
    assert.equal(t3.calls[0].url, ORIGIN + '/k/5/show#record=12');
    const t4 = setup();
    t4.ev('c1', { type: 'auxclick', button: 2 });
    t4.ev('c1', { type: 'click', button: 1 });
    assert.equal(t4.calls.length, 0);
  });
  it('Shift＋クリックは新規タブ', () => {
    const t = setup();
    const e = t.ev('c1', { shiftKey: true });
    assert.equal(t.calls.length, 1);
    assert.equal(t.calls[0].newTab, true);
    assert.equal(t.calls[0].url, ORIGIN + '/k/5/show#record=12');
    assert.equal(e.defaultPrevented, true);
  });
  it('tabindex=-1 の要素は除外しない', () => {
    const t = setup();
    t.ev('ti2');
    assert.equal(t.calls.length, 1);
    assert.equal(t.calls[0].url, ORIGIN + '/k/5/show#record=12');
  });
  it('相対 href は document.baseURI 基準で解決', () => {
    const t = setup();
    t.ev('c6');
    assert.equal(t.calls[0].url, ORIGIN + '/k/5/show#record=6');
  });
  it('一覧がコンテンツスペース外でも委譲される（document 委譲）', () => {
    const t = setup();
    t.w.kintone = { portal: { getContentSpaceElement: () => t.w.document.getElementById('space') } };
    assert.equal(t.w.document.getElementById('space').contains(t.w.document.getElementById('c1')), false);
    t.ev('c1');
    assert.equal(t.calls.length, 1);
  });
  it('ポータル以外の画面では何もしない', () => {
    const a = setup({ path: '/k/5/' });
    a.ev('c1');
    assert.equal(a.calls.length, 0);
  });
  it('ポータル上では読み込み直後（イベント発火なし）から遷移する', () => {
    const b = setup();
    b.ev('c1');
    assert.equal(b.calls.length, 1);
  });
  it('SPA遷移でポータルから離れると何もしない', () => {
    const c = setup();
    c.w.history.pushState({}, '', '/k/5/');
    c.ev('c1');
    assert.equal(c.calls.length, 0);
    c.w.history.pushState({}, '', '/k/#/portal');
    c.clock.now += 600;
    c.ev('c1');
    assert.equal(c.calls.length, 1);
  });
  it('ポータル外で読み込み後、SPA遷移でポータルに入ると遷移できる', () => {
    const t = setup({ path: '/k/5/' });
    t.ev('c1');
    assert.equal(t.calls.length, 0);
    t.w.history.pushState({}, '', '/k/#/portal');
    t.clock.now += 600;
    t.ev('c1');
    assert.equal(t.calls.length, 1);
    assert.equal(t.calls[0].url, ORIGIN + '/k/5/show#record=12');
  });
  it('ポータル外では mouseover しても pointer が付かない', () => {
    const t = setup({ path: '/k/5/' });
    t.ev('c1', { type: 'mouseover' });
    assert.notEqual(t.w.document.getElementById('r1').style.cursor, 'pointer');
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
    assert.equal(f('/k/m/', '#/portal'), true);
    assert.equal(f('/k/', '#/portal?x=1'), true);
    assert.equal(f('/k/', '#/ntf/list'), false);
  });
  it('行自身・外枠が tabindex/role を持っていても遷移する', () => {
    const html = `<div id="outer" tabindex="0"><div role="tab" id="tabw"><table><tbody>
      <tr id="rw" tabindex="0"><td id="x1">a</td><td><a href="/k/5/show#record=1">1</a></td></tr>
      <tr id="rx"><td id="x2">b<span id="in" tabindex="0">i</span></td><td><a href="/k/5/show#record=2">2</a></td></tr>
    </tbody></table></div></div>
    <ul id="ul" role="link"><li id="lw" role="button"><span id="x3">c</span><a href="/k/5/show#record=3">3</a></li></ul>`;
    const t = setup({ html });
    t.ev('x1');
    assert.equal(t.calls.length, 1);
    t.clock.now += 600;
    t.ev('x2');
    assert.equal(t.calls.length, 2);
    t.clock.now += 600;
    t.ev('in');
    assert.equal(t.calls.length, 2);
    t.ev('x3');
    assert.equal(t.calls.length, 3);
  });
  it('Shift＋クリックは選択中でも新規タブ、通常クリックは選択中不遷移', () => {
    const t = setup();
    const d = t.w.document;
    const range = d.createRange();
    range.selectNodeContents(d.getElementById('c1'));
    const sel = t.w.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    t.ev('c1');
    assert.equal(t.calls.length, 0);
    t.ev('c1', { shiftKey: true });
    assert.equal(t.calls.length, 1);
    assert.equal(t.calls[0].newTab, true);
    assert.equal(sel.isCollapsed, true);
  });
  it('mouseover: 遷移できる行だけ pointer、同一行はスキップ', () => {
    const t = setup();
    t.ev('c1', { type: 'mouseover' });
    assert.equal(t.w.document.getElementById('r1').style.cursor, 'pointer');
    t.ev('c3', { type: 'mouseover' });
    assert.equal(t.w.document.getElementById('r3').style.cursor, '');
  });
  it('同一行 mouseover は再判定されない（スキップ）', () => {
    const t = setup();
    const r1 = t.w.document.getElementById('r1');
    t.ev('c1', { type: 'mouseover' });
    assert.equal(r1.style.cursor, 'pointer');
    r1.style.cursor = 'help';
    t.ev('sp', { type: 'mouseover' });
    assert.equal(r1.style.cursor, 'help');
  });
  it('行外に出て戻ると再判定される', () => {
    const t = setup();
    const r1 = t.w.document.getElementById('r1');
    t.ev('c1', { type: 'mouseover' });
    r1.style.cursor = 'help';
    t.ev('space', { type: 'mouseover' });
    t.ev('c1', { type: 'mouseover' });
    assert.equal(r1.style.cursor, 'pointer');
  });
  it('pointer が戻るのは自分が付けた行だけ', () => {
    const t = setup();
    const d = t.w.document;
    const r1 = d.getElementById('r1');
    const r3 = d.getElementById('r3');
    r3.style.cursor = 'pointer';
    t.ev('c3', { type: 'mouseover' });
    assert.equal(r3.style.cursor, 'pointer');
    t.ev('c1', { type: 'mouseover' });
    assert.equal(r1.style.cursor, 'pointer');
    assert.equal(r1.getAttribute('data-krc-cursor'), '1');
    // 行内容が変わりリンクが無くなったら戻る
    r1.querySelectorAll('a').forEach((a) => a.remove());
    t.ev('space', { type: 'mouseover' });
    t.ev('c1', { type: 'mouseover' });
    assert.equal(r1.style.cursor, '');
    assert.equal(r1.hasAttribute('data-krc-cursor'), false);
  });
  it('Shift＋ドラッグ（座標移動あり）は不遷移、動かない Shift＋クリックは新規タブ', () => {
    const t = setup();
    t.ev('c1', { type: 'mousedown', shiftKey: true, clientX: 0, clientY: 0 });
    t.ev('c1', { shiftKey: true, clientX: 50, clientY: 0, detail: 1 });
    assert.equal(t.calls.length, 0);
    t.ev('c1', { type: 'mousedown', shiftKey: true, clientX: 5, clientY: 5 });
    t.ev('c1', { shiftKey: true, clientX: 8, clientY: 6, detail: 1 });
    assert.equal(t.calls.length, 1);
    assert.equal(t.calls[0].newTab, true);
    assert.equal(t.calls[0].url, ORIGIN + '/k/5/show#record=12');
  });
  it('Shiftなし: mousedown→click が同座標なら同一タブ遷移、10px超なら不遷移', () => {
    const t = setup();
    t.ev('c1', { type: 'mousedown', clientX: 3, clientY: 3 });
    t.ev('c1', { clientX: 3, clientY: 3, detail: 1 });
    assert.equal(t.calls.length, 1);
    assert.equal(t.calls[0].newTab, false);
    t.ev('c1', { type: 'mousedown', clientX: 0, clientY: 0 });
    t.ev('c1', { clientX: 40, clientY: 0, detail: 1 });
    assert.equal(t.calls.length, 1);
  });
  it('detail===0（キーボード・合成）の click は残った mousedown 座標と比較しない', () => {
    const t = setup();
    t.ev('c1', { type: 'mousedown', clientX: 0, clientY: 0 });
    t.ev('c1', { clientX: 90, clientY: 90, detail: 0 });
    assert.equal(t.calls.length, 1);
  });
  it('中ボタンの mousedown→auxclick が同座標なら新規タブ、10px超なら不遷移', () => {
    const t = setup();
    t.ev('c1', { type: 'mousedown', button: 1, clientX: 1, clientY: 1 });
    t.ev('c1', { type: 'auxclick', button: 1, clientX: 1, clientY: 1, detail: 1 });
    assert.equal(t.calls.length, 1);
    assert.equal(t.calls[0].newTab, true);
  });
  it('NAV_GUARD で弾いた Shift＋クリックでも選択が解除される', () => {
    const t = setup();
    t.ev('c1');
    const d = t.w.document;
    const range = d.createRange();
    range.selectNodeContents(d.getElementById('c1'));
    const sel = t.w.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    t.ev('c1', { shiftKey: true });
    assert.equal(t.calls.length, 1);
    assert.equal(sel.isCollapsed, true);
  });
  it('500ms 経過後は再遷移できる', () => {
    const t = setup();
    t.ev('c1');
    t.clock.now += 499;
    t.ev('c1');
    assert.equal(t.calls.length, 1);
    t.clock.now += 2;
    t.ev('c1');
    assert.equal(t.calls.length, 2);
  });
  it('テキスト選択中・先行キャプチャリスナーが preventDefault 済みは不遷移', () => {
    const t = setup();
    const d = t.w.document;
    const range = d.createRange();
    range.selectNodeContents(d.getElementById('c1'));
    const sel = t.w.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    t.ev('c1');
    assert.equal(t.calls.length, 0);
    sel.removeAllRanges();
    t.w.addEventListener('click', (e) => e.preventDefault(), true);
    t.ev('c1');
    assert.equal(t.calls.length, 0);
  });
  it('二重登録されない（同一windowで SRC を2回 eval しても遷移1回）', () => {
    const t = setup();
    t.w.eval(SRC);
    t.w.eval(SRC);
    t.ev('c1');
    assert.equal(t.calls.length, 1);
    assert.equal(t.w.document.documentElement.getAttribute('data-krc-portal-bound'), '1');
  });
  it('body が無い時点で評価しても後から生成された行で遷移する', () => {
    const dom = new JSDOM('<!DOCTYPE html><html><head></head></html>', { url: ORIGIN + '/k/', runScripts: 'outside-only' });
    const w = dom.window;
    w.document.body.remove();
    assert.equal(w.document.body, null);
    w.eval(SRC);
    const calls = [];
    w.KintoneRowClick.portal.nav.open = (url, newTab) => calls.push({ url, newTab });
    const body = w.document.createElement('body');
    body.innerHTML = '<table><tbody><tr><td id="z">a</td><td><a href="/k/5/show#record=3">3</a></td></tr></tbody></table>';
    w.document.documentElement.appendChild(body);
    w.document.getElementById('z').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, ORIGIN + '/k/5/show#record=3');
  });
  it('documentElement に印が付き、body にも診断用の印が付く', () => {
    const t = setup();
    assert.equal(t.w.document.documentElement.hasAttribute('data-krc-portal-bound'), true);
    assert.equal(t.w.document.body.getAttribute('data-krc-bound'), '1');
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
    touch(a, 'touchstart', 0, 0);
    touch(a, 'touchmove', 0, 30);
    touch(a, 'touchend', 0, 30);
    a.ev('c1');
    assert.equal(a.calls.length, 0);
    const b = setup();
    touch(b, 'touchstart', 0, 0);
    touch(b, 'touchend', 3, 4);
    b.ev('c1');
    assert.equal(b.calls.length, 1);
    // moved は click 判定後に戻る（次の touchstart でもリセット）
    a.clock.now += 600;
    a.ev('c1');
    assert.equal(a.calls.length, 1);
    const c = setup();
    touch(c, 'touchstart', 0, 0);
    touch(c, 'touchmove', 0, 30);
    touch(c, 'touchstart', 0, 0);
    c.ev('c1');
    assert.equal(c.calls.length, 1);
  });
  it('cursor:pointer は遷移可能行のみ', () => {
    const t = setup();
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
    t.ev('c1');
    t.ev('c1');
    assert.equal(t.calls.length, 1);
  });
});
