'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const core = require('../plugin/js/core.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'plugin', f), 'utf8');
const SRC = { core: read('js/core.js'), api: read('js/kintone-api.js'), desktop: read('js/desktop.js'), config: read('js/config.js') };

const TABLE_HTML = `
<table><tbody>
  <tr id="r1">
    <td id="chk"><input type="checkbox"></td>
    <td id="std"><a id="stdlink" href="/k/5/show#record=12&amp;l.view=1">12</a></td>
    <td id="text">hello</td>
    <td id="lnk"><a id="extlink" href="https://ext.example.org/">ext</a></td>
    <td id="tbl"><span id="tblspan">sub</span></td>
    <td id="btn"><button id="editbtn">edit</button></td>
  </tr>
</tbody></table>
<div id="outside">outside</div>`;

function setup(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!DOCTYPE html><body>' + (opts.html || TABLE_HTML) + '</body>', {
    url: 'https://example.cybozu.com/k/5/',
    runScripts: 'outside-only'
  });
  const w = dom.window;
  const handlers = {};
  const cfg = opts.config || core.DEFAULT_CONFIG();
  const apiImpl = opts.api || (() => Promise.reject(new Error('no api')));
  const api = (...a) => apiImpl(...a);
  api.url = (p) => '/k' + p;
  w.kintone = {
    $PLUGIN_ID: 'plugin-id',
    events: { on: (name, fn) => { handlers[name] = fn; } },
    app: {
      getId: () => 5,
      getFieldElements: (code) => {
        const d = w.document;
        const map = opts.fieldMap || { text: ['text'], lnk: ['lnk'] };
        return map[code] ? map[code].map((id) => d.getElementById(id)) : null;
      }
    },
    plugin: { app: { getConfig: () => core.serializeConfig(cfg) } },
    getLoginUser: () => ({ code: 'user1' }),
    api
  };
  w.eval(SRC.core);
  w.eval(SRC.api);
  w.eval(SRC.desktop);
  const calls = [];
  w.KintoneRowClick.desktop.nav.open = (url, newTab) => calls.push({ url, newTab });
  const records = opts.records || [{
    $id: { type: '__ID__', value: '12' },
    text: { type: 'SINGLE_LINE_TEXT', value: 'hello' },
    lnk: { type: 'LINK', value: 'https://ext.example.org/' },
    tbl: { type: 'SUBTABLE', value: [] }
  }];
  const show = (viewType) => handlers['app.record.index.show']({ viewType: viewType || 'list', viewId: 100, records });
  const click = (id, init) => {
    const el = w.document.getElementById(id);
    const ev = new w.MouseEvent((init && init.type) || 'click', Object.assign({ bubbles: true, cancelable: true }, init));
    el.dispatchEvent(ev);
    return ev;
  };
  return { w, calls, show, click, handlers };
}

const tick = () => new Promise((r) => setTimeout(r, 10));

describe('desktop.js', () => {
  it('セルのクリックで正しい URL へ1回遷移（標準リンクの href を使う）', () => {
    const t = setup();
    t.show();
    const ev = t.click('text');
    assert.equal(t.calls.length, 1);
    assert.equal(t.calls[0].url, 'https://example.cybozu.com/k/5/show#record=12&l.view=1');
    assert.equal(t.calls[0].newTab, false);
    assert.equal(ev.defaultPrevented, true);
  });

  it('標準リンクが無い行は record 配列の $id から組み立てる', () => {
    const t = setup({ html: TABLE_HTML.replace(/<a id="stdlink"[^>]*>12<\/a>/, '12') });
    t.show();
    t.click('text');
    assert.deepEqual(t.calls.map((c) => c.url), ['https://example.cybozu.com/k/5/show#record=12']);
  });

  it('別オリジンの偽リンクは無視され、組み立てた URL が使われる', () => {
    const t = setup({ html: TABLE_HTML.replace('/k/5/show#record=12&amp;l.view=1', 'https://evil.example.com/k/5/show#record=99') });
    t.show();
    t.click('text');
    assert.equal(t.calls.length, 1);
    assert.equal(t.calls[0].url, 'https://example.cybozu.com/k/5/show#record=12');
  });

  it('calendar では何も起きない', () => {
    const t = setup();
    t.show('calendar');
    t.click('text');
    assert.equal(t.calls.length, 0);
  });

  it('show を2回発火しても遷移は1回', () => {
    const t = setup();
    t.show();
    t.show();
    t.click('text');
    assert.equal(t.calls.length, 1);
  });

  it('チェックボックス・行末ボタン・標準リンク列は遷移しない', () => {
    const t = setup();
    t.show();
    t.click('chk');
    t.click('editbtn');
    t.click('btn');
    t.click('stdlink');
    t.click('std');
    assert.equal(t.calls.length, 0);
  });

  it('行の外は遷移しない', () => {
    const t = setup();
    t.show();
    t.click('outside');
    assert.equal(t.calls.length, 0);
  });

  it('リンク型セル内の a は link 優先なら遷移せず、detail 優先なら遷移する', () => {
    const t1 = setup();
    t1.show();
    const ev = t1.click('extlink');
    assert.equal(t1.calls.length, 0);
    assert.equal(ev.defaultPrevented, false);

    const c = core.DEFAULT_CONFIG();
    c.priorities.link = 'detail';
    const t2 = setup({ config: c });
    t2.show();
    t2.click('extlink');
    assert.equal(t2.calls.length, 1);
  });

  it('テーブル列(getFieldElements が null)は row 範囲ならテーブル種別として扱う', () => {
    const t = setup();
    t.show();
    t.click('tblspan');
    assert.equal(t.calls.length, 1);

    const c = core.DEFAULT_CONFIG();
    c.range = { mode: 'fields', fieldCodes: ['text'] };
    const t2 = setup({ config: c });
    t2.show();
    t2.click('tblspan');
    assert.equal(t2.calls.length, 0);
    t2.click('lnk');
    assert.equal(t2.calls.length, 0);
    t2.click('text');
    assert.equal(t2.calls.length, 1);
  });

  it('インライン編集中の行は遷移しない', () => {
    const html = TABLE_HTML.replace('<td id="text">hello</td>', '<td id="text"><input type="text" value="hello"></td>');
    const t = setup({ html });
    t.show();
    t.click('text');
    assert.equal(t.calls.length, 0);
  });

  it('文字列選択中は遷移しない', () => {
    const t = setup();
    t.show();
    const range = t.w.document.createRange();
    range.selectNodeContents(t.w.document.getElementById('text'));
    const sel = t.w.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    t.click('text');
    assert.equal(t.calls.length, 0);
    sel.removeAllRanges();
    t.click('text');
    assert.equal(t.calls.length, 1);
  });

  it('Ctrl クリックと中クリックで newTab', () => {
    const t = setup();
    t.show();
    t.click('text', { ctrlKey: true });
    t.click('text', { type: 'auxclick', button: 1 });
    t.click('text', { type: 'auxclick', button: 2 });
    assert.deepEqual(t.calls.map((c) => c.newTab), [true, true]);
  });

  it('対象者が指定で affiliation 取得に失敗すると遷移しない', async () => {
    const c = core.DEFAULT_CONFIG();
    c.target = { mode: 'specified', organizations: ['o1'], groups: [], includeChildOrgs: false };
    const t = setup({ config: c });
    t.show();
    await tick();
    t.click('text');
    assert.equal(t.calls.length, 0);
  });

  it('対象者が指定で所属が一致すると遷移する', async () => {
    const c = core.DEFAULT_CONFIG();
    c.target = { mode: 'specified', organizations: ['o1'], groups: [], includeChildOrgs: false };
    const api = (path) => Promise.resolve(
      path.includes('user/organizations')
        ? { organizationTitles: [{ organization: { code: 'o1' } }] }
        : { groups: [] });
    const t = setup({ config: c, api });
    t.show();
    t.click('text');
    assert.equal(t.calls.length, 0); // 判定完了前は標準動作
    await tick();
    t.click('text');
    assert.equal(t.calls.length, 1);
  });

  it('records が空でもエラーにならず、遷移は0件', () => {
    const t = setup({ records: [] });
    assert.doesNotThrow(() => t.show());
    assert.doesNotThrow(() => t.click('text'));
    assert.doesNotThrow(() => t.click('stdlink'));
    assert.equal(t.calls.length, 0);
  });

  it('中クリックは auxclick の1回だけ遷移し、click(button 1) では二重にならない', () => {
    const t = setup();
    t.show();
    t.click('text', { type: 'click', button: 1 });
    assert.equal(t.calls.length, 0);
    t.click('text', { type: 'auxclick', button: 1 });
    assert.equal(t.calls.length, 1);
    assert.equal(t.calls[0].newTab, true);
  });

  it('遷移しないときは defaultPrevented が false、遷移するときは true', () => {
    const t = setup();
    t.show();
    assert.equal(t.click('chk').defaultPrevented, false);
    assert.equal(t.click('editbtn').defaultPrevented, false);
    assert.equal(t.click('outside').defaultPrevented, false);
    assert.equal(t.click('text', { button: 2 }).defaultPrevented, false);
    assert.equal(t.calls.length, 0);
    assert.equal(t.click('text').defaultPrevented, true);
  });

  it('他のハンドラーが preventDefault 済みのクリックには重ねて遷移しない', () => {
    const t = setup();
    t.show();
    t.w.document.addEventListener('click', (e) => e.preventDefault(), true);
    t.click('text');
    assert.equal(t.calls.length, 0);
  });

  it('Shift クリックは遷移せず標準動作に任せる', () => {
    const t = setup();
    t.show();
    const ev = t.click('text', { shiftKey: true });
    assert.equal(t.calls.length, 0);
    assert.equal(ev.defaultPrevented, false);
  });

  it('対応済みセル内の同アプリ別レコードへのリンクがあっても、行のレコードへ遷移する', () => {
    const html = TABLE_HTML
      .replace(/<a id="stdlink"[^>]*>12<\/a>/, '12')
      .replace('https://ext.example.org/', '/k/5/show#record=99');
    const t = setup({ html });
    t.show();
    t.click('text');
    assert.deepEqual(t.calls.map((c) => c.url), ['https://example.cybozu.com/k/5/show#record=12']);
    // そのリンクを押しても標準リンク扱いにならず、リンク優先なので遷移しない
    t.click('extlink');
    assert.equal(t.calls.length, 1);
  });

  it('標準リンクの ID が行のレコードと違うときは遷移しない（標準動作のまま）', () => {
    const html = TABLE_HTML.replace('record=12&amp;l.view=1', 'record=99');
    const t = setup({ html });
    t.show();
    const ev = t.click('text');
    assert.equal(t.calls.length, 0);
    assert.equal(ev.defaultPrevented, false);
  });

  it('records に $id が無いときは標準リンクの ID で遷移する', () => {
    const records = [{
      text: { type: 'SINGLE_LINE_TEXT', value: 'hello' },
      lnk: { type: 'LINK', value: 'https://ext.example.org/' },
      tbl: { type: 'SUBTABLE', value: [] }
    }];
    const t = setup({ records });
    t.show();
    t.click('text');
    assert.deepEqual(t.calls.map((c) => c.url), ['https://example.cybozu.com/k/5/show#record=12&l.view=1']);
  });

  it('レコード番号列($id)のセル内の a は標準リンクとして扱い、押しても遷移しない', () => {
    const t = setup({ fieldMap: { text: ['text'], lnk: ['lnk'], $id: ['std'] } });
    t.show();
    t.click('stdlink');
    assert.equal(t.calls.length, 0);
    // 行の他のセルは、この標準リンク(ID 12)で遷移する
    t.click('text');
    assert.deepEqual(t.calls.map((c) => c.url), ['https://example.cybozu.com/k/5/show#record=12&l.view=1']);
  });

  it('一覧の表の外の tr は無視する', () => {
    const html = TABLE_HTML + '<table><tbody><tr id="r2"><td id="o1"><a href="/k/5/show#record=7">7</a></td><td id="o2">x</td></tr></tbody></table>';
    const t = setup({ html });
    t.show();
    t.click('o2');
    t.click('o1');
    assert.equal(t.calls.length, 0);
  });

  it('SUBTABLE 型フィールドが無いときは、対応外の列で遷移しない', () => {
    const records = [{
      $id: { type: '__ID__', value: '12' },
      text: { type: 'SINGLE_LINE_TEXT', value: 'hello' },
      lnk: { type: 'LINK', value: 'https://ext.example.org/' }
    }];
    const t = setup({ records });
    t.show();
    t.click('tblspan');
    assert.equal(t.calls.length, 0);
    t.click('text');
    assert.equal(t.calls.length, 1);
  });

  describe('cursor', () => {
    const cursorOf = (t, id) => t.w.document.getElementById(id).style.cursor;

    it('対象者が全員なら範囲内のセルだけ pointer', () => {
      const t = setup();
      t.show();
      assert.equal(cursorOf(t, 'text'), 'pointer');
      assert.equal(cursorOf(t, 'lnk'), 'pointer');
      assert.equal(cursorOf(t, 'btn'), '');
    });

    it('範囲が指定フィールドなら範囲外のセルには付けない', () => {
      const c = core.DEFAULT_CONFIG();
      c.range = { mode: 'fields', fieldCodes: ['text'] };
      const t = setup({ config: c });
      t.show();
      assert.equal(cursorOf(t, 'text'), 'pointer');
      assert.equal(cursorOf(t, 'lnk'), '');
    });

    it('対象者が指定で対象外のユーザーでは、判定待ち・判定後ともに空', async () => {
      const c = core.DEFAULT_CONFIG();
      c.target = { mode: 'specified', organizations: ['o1'], groups: [], includeChildOrgs: false };
      const api = (path) => Promise.resolve(
        path.includes('user/organizations')
          ? { organizationTitles: [{ organization: { code: 'other' } }] }
          : { groups: [] });
      const t = setup({ config: c, api });
      t.show();
      assert.equal(cursorOf(t, 'text'), '');
      await tick();
      assert.equal(cursorOf(t, 'text'), '');
      assert.equal(cursorOf(t, 'lnk'), '');
    });

    it('対象者が指定で取得に失敗したときも空', async () => {
      const c = core.DEFAULT_CONFIG();
      c.target = { mode: 'specified', organizations: ['o1'], groups: [], includeChildOrgs: false };
      const t = setup({ config: c });
      t.show();
      await tick();
      assert.equal(cursorOf(t, 'text'), '');
    });

    it('対象ユーザーでは判定後に pointer（判定待ちの間は空）', async () => {
      const c = core.DEFAULT_CONFIG();
      c.target = { mode: 'specified', organizations: ['o1'], groups: [], includeChildOrgs: false };
      const api = (path) => Promise.resolve(
        path.includes('user/organizations')
          ? { organizationTitles: [{ organization: { code: 'o1' } }] }
          : { groups: [] });
      const t = setup({ config: c, api });
      t.show();
      assert.equal(cursorOf(t, 'text'), '');
      await tick();
      assert.equal(cursorOf(t, 'text'), 'pointer');
      assert.equal(cursorOf(t, 'lnk'), 'pointer');
    });

    it('テーブル扱いになる td にもカーソルが付く（除外領域の列には付かない）', () => {
      const t = setup();
      t.show();
      assert.equal(cursorOf(t, 'tbl'), 'pointer');
      assert.equal(cursorOf(t, 'chk'), '');
      assert.equal(cursorOf(t, 'std'), '');
      assert.equal(cursorOf(t, 'btn'), '');
    });

    it('テーブル列のカーソルは、SUBTABLE が無い・範囲が指定フィールドのときは付かず、対象外ユーザーでも付かない', async () => {
      const records = [{
        $id: { type: '__ID__', value: '12' },
        text: { type: 'SINGLE_LINE_TEXT', value: 'hello' },
        lnk: { type: 'LINK', value: 'https://ext.example.org/' }
      }];
      const t1 = setup({ records });
      t1.show();
      assert.equal(cursorOf(t1, 'tbl'), '');
      const c = core.DEFAULT_CONFIG();
      c.range = { mode: 'fields', fieldCodes: ['text'] };
      const t2 = setup({ config: c });
      t2.show();
      assert.equal(cursorOf(t2, 'tbl'), '');
      const c3 = core.DEFAULT_CONFIG();
      c3.target = { mode: 'specified', organizations: ['o1'], groups: [], includeChildOrgs: false };
      const t3 = setup({ config: c3 });
      t3.show();
      await tick();
      assert.equal(cursorOf(t3, 'tbl'), '');
    });

    it('元のインライン cursor は戻される', () => {
      const t = setup();
      t.w.document.getElementById('text').style.cursor = 'help';
      t.show();
      assert.equal(cursorOf(t, 'text'), 'pointer');
      t.show('calendar');
      assert.equal(cursorOf(t, 'text'), 'help');
      t.show();
      t.show();
      assert.equal(cursorOf(t, 'text'), 'pointer');
      t.show('calendar');
      assert.equal(cursorOf(t, 'text'), 'help');
    });

    it('一覧が対象外の表示に切り替わると前回のカーソルが残らない', () => {
      const t = setup();
      t.show();
      assert.equal(cursorOf(t, 'text'), 'pointer');
      t.show('calendar');
      assert.equal(cursorOf(t, 'text'), '');
      t.show();
      assert.equal(cursorOf(t, 'text'), 'pointer');
    });
  });
});

describe('config.js', () => {
  it('組織名の HTML は文字列として表示され要素にならない', () => {
    const dom = new JSDOM('<!DOCTYPE html><body><div id="c"></div></body>', { runScripts: 'outside-only' });
    const w = dom.window;
    w.kintone = { $PLUGIN_ID: 'plugin-id', app: {}, plugin: { app: { getConfig: () => ({}) } } };
    w.eval(SRC.core);
    w.eval(SRC.config);
    const c = w.document.getElementById('c');
    const name = '<img src=x onerror=alert(1)>';
    w.KintoneRowClick.config.renderCheckboxList(c, [{ value: '"><img src=x>', label: name + ' (code)' }], []);
    assert.equal(c.querySelector('img'), null);
    assert.ok(c.textContent.includes(name));
    assert.equal(c.querySelector('input').value, '"><img src=x>');
  });

  it('検証: 指定なのに空ならエラー文言を返す', () => {
    const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only' });
    const w = dom.window;
    w.kintone = { $PLUGIN_ID: 'plugin-id', app: {}, plugin: { app: { getConfig: () => ({}) } } };
    w.eval(SRC.core);
    w.eval(SRC.config);
    const cfg = core.DEFAULT_CONFIG();
    assert.equal(w.KintoneRowClick.config.validate(cfg), '');
    cfg.views.mode = 'specified';
    assert.notEqual(w.KintoneRowClick.config.validate(cfg), '');
  });
});
